import { useState, useCallback, useRef, useEffect } from 'react';
import { sendChatRequest } from '../services/openai';
import { BUILT_IN_SKILLS } from '../utils/skills';
import { parseAgentActions, actionToCommand } from '../utils/agentActions';

/**
 * TerminalAgent: Redesigned terminal-operating agent.
 * 
 * Design:
 * - Displays current terminal CWD and available skills (action space)
 * - User enters a task, model returns structured skill parameters
 * - Each step requires user confirmation before execution
 * - Model receives CWD + skills as context, returns structured actions
 */

const TERMINAL_OUTPUT_WAIT_MS = 2000; // Time to wait for terminal output after command execution
const TERMINAL_MAX_CAPTURE_LENGTH = 2000; // Max characters to capture from terminal output

const TERMINAL_AGENT_SYSTEM_PROMPT = `你是终端操作Agent。你根据用户需求，选择合适的技能（skill）并返回结构化参数。

规则：
1. 每次只执行一个操作，等待结果后再决定下一步。
2. 先简要说明意图，然后输出操作：
\`\`\`agent-action
{"action":"技能ID","params":{"参数名":"值"}}
\`\`\`
3. JSON用英文双引号，参数值要完整准确。
4. 观察执行结果后决定是否继续。
5. 任务完成时说明结果。`;

export default function TerminalAgent({
  settings,
  terminalCwd,
  terminalRef,
  agentSkills,
  onClose,
}) {
  const [userInput, setUserInput] = useState('');
  const [steps, setSteps] = useState([]); // Array of { type: 'user'|'thinking'|'action'|'result', content, action?, status? }
  const [isRunning, setIsRunning] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [showPromptEdit, setShowPromptEdit] = useState(false);
  const stepsEndRef = useRef(null);
  const abortRef = useRef(null);
  const stepsRef = useRef(steps);

  // Keep stepsRef in sync
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  // Auto-scroll to bottom
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps]);

  const allSkills = [...BUILT_IN_SKILLS, ...(agentSkills || [])];

  const buildSystemPrompt = useCallback(() => {
    const skills = [...BUILT_IN_SKILLS, ...(agentSkills || [])];
    const skillList = skills.map((s) => {
      const params = (s.params || []).map((p) => `${p.name}(${p.type}): ${p.description}`).join(', ');
      return `  ${s.id}: ${s.description} — 参数: ${params}`;
    }).join('\n');

    const base = (customPrompt && customPrompt.trim()) ? customPrompt.trim() : TERMINAL_AGENT_SYSTEM_PROMPT;
    return `${base}

当前工作目录：${terminalCwd || '(未连接)'}

可用技能（action space）：
${skillList}`;
  }, [customPrompt, terminalCwd, agentSkills]);

  const handleSend = useCallback(async () => {
    if (!userInput.trim() || isRunning) return;

    const newSteps = [...steps, { type: 'user', content: userInput.trim() }];
    setSteps(newSteps);
    setUserInput('');
    setIsRunning(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      // Build messages from conversation history
      const messages = [
        { role: 'system', content: buildSystemPrompt() },
      ];

      for (const step of newSteps) {
        if (step.type === 'user') {
          messages.push({ role: 'user', content: step.content });
        } else if (step.type === 'thinking' || step.type === 'action') {
          messages.push({ role: 'assistant', content: step.content });
        } else if (step.type === 'result') {
          messages.push({ role: 'user', content: `[执行结果]\n${step.content}` });
        }
      }

      let response = '';
      await sendChatRequest(
        messages,
        { ...settings, stream: true },
        (chunk, isDone) => {
          if (!isDone) {
            response += chunk;
            // Update the thinking step in real-time
            setSteps((prev) => {
              const last = prev[prev.length - 1];
              if (last?.type === 'thinking') {
                return [...prev.slice(0, -1), { ...last, content: response }];
              }
              return [...prev, { type: 'thinking', content: response }];
            });
          } else {
            // Parse actions from the response
            const actions = parseAgentActions(response);
            if (actions.length > 0) {
              const action = actions[0]; // One action at a time
              const command = actionToCommand(action, agentSkills);
              setSteps((prev) => {
                // Replace the thinking step with finalized thinking + action
                const filtered = prev.filter((s) => !(s.type === 'thinking' && s === prev[prev.length - 1]));
                return [
                  ...filtered,
                  { type: 'thinking', content: response },
                  {
                    type: 'action',
                    content: command || `未知技能: ${action.action}`,
                    action: action,
                    command: command,
                    status: 'pending',
                  },
                ];
              });
            }
          }
        },
        abortController.signal
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        setSteps((prev) => [...prev, { type: 'result', content: `错误: ${err.message}` }]);
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [userInput, steps, isRunning, settings, agentSkills, buildSystemPrompt]);

  const [canContinue, setCanContinue] = useState(false);

  const handleConfirmAction = useCallback(async (stepIndex) => {
    // Read current step from ref to avoid stale closure
    const currentSteps = stepsRef.current;
    const step = currentSteps[stepIndex];
    if (!step || step.type !== 'action' || step.status !== 'pending') return;

    const command = step.command;
    if (!command) {
      setSteps((prev) => {
        const updated = [...prev];
        updated[stepIndex] = { ...prev[stepIndex], status: 'error' };
        return [...updated, { type: 'result', content: `无法执行：未知技能 ${step.action?.action}` }];
      });
      return;
    }

    // Execute in terminal with output capture
    if (terminalRef?.current?.sendCommand) {
      // Start capturing terminal output
      terminalRef.current.startCapture?.();

      const sent = terminalRef.current.sendCommand(command);
      if (sent) {
        setSteps((prev) => {
          const updated = [...prev];
          updated[stepIndex] = { ...prev[stepIndex], status: 'executed' };
          return [...updated, { type: 'result', content: `✅ 已执行: ${command}\n等待终端输出...` }];
        });

        // Wait for terminal to process the command
        await new Promise((r) => setTimeout(r, TERMINAL_OUTPUT_WAIT_MS));

        // Retrieve captured terminal output
        const capturedOutput = terminalRef.current.stopCapture?.(TERMINAL_MAX_CAPTURE_LENGTH) || '';
        const trimmedOutput = capturedOutput.trim();

        if (trimmedOutput) {
          setSteps((prev) => {
            // Replace the last result with one that includes terminal output
            const lastResultIdx = prev.length - 1;
            if (prev[lastResultIdx]?.type === 'result') {
              const updated = [...prev];
              updated[lastResultIdx] = {
                ...prev[lastResultIdx],
                content: `✅ 已执行: ${command}\n\n📋 终端输出:\n${trimmedOutput}`,
              };
              return updated;
            }
            return [...prev, { type: 'result', content: `📋 终端输出:\n${trimmedOutput}` }];
          });
        }

        setCanContinue(true);
      } else {
        terminalRef.current.stopCapture?.();
        setSteps((prev) => {
          const updated = [...prev];
          updated[stepIndex] = { ...prev[stepIndex], status: 'error' };
          return [...updated, { type: 'result', content: '❌ 终端未连接，无法执行' }];
        });
      }
    } else {
      setSteps((prev) => {
        const updated = [...prev];
        updated[stepIndex] = { ...prev[stepIndex], status: 'error' };
        return [...updated, { type: 'result', content: '❌ 终端未连接，无法执行' }];
      });
    }
  }, [terminalRef]);

  // Auto-continue: ask model for next step after user confirms execution
  const handleContinue = useCallback(async () => {
    if (isRunning) return;
    setCanContinue(false);
    setIsRunning(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const messages = [
        { role: 'system', content: buildSystemPrompt() },
      ];

      // Rebuild conversation from steps
      for (const step of steps) {
        if (step.type === 'user') {
          messages.push({ role: 'user', content: step.content });
        } else if (step.type === 'thinking' || step.type === 'action') {
          messages.push({ role: 'assistant', content: step.content });
        } else if (step.type === 'result') {
          messages.push({ role: 'user', content: `[执行结果]\n${step.content}` });
        }
      }

      // Ask model to continue
      messages.push({ role: 'user', content: '请根据执行结果决定下一步操作。如果任务已完成，请说明结果。' });

      let response = '';
      await sendChatRequest(
        messages,
        { ...settings, stream: true },
        (chunk, isDone) => {
          if (!isDone) {
            response += chunk;
            setSteps((prev) => {
              const last = prev[prev.length - 1];
              if (last?.type === 'thinking' && last?._isContinue) {
                return [...prev.slice(0, -1), { type: 'thinking', content: response, _isContinue: true }];
              }
              return [...prev, { type: 'thinking', content: response, _isContinue: true }];
            });
          } else {
            const actions = parseAgentActions(response);
            if (actions.length > 0) {
              const action = actions[0];
              const command = actionToCommand(action, agentSkills);
              setSteps((prev) => {
                const filtered = prev.filter((s) => !(s.type === 'thinking' && s._isContinue && s === prev[prev.length - 1]));
                return [
                  ...filtered,
                  { type: 'thinking', content: response },
                  {
                    type: 'action',
                    content: command || `未知技能: ${action.action}`,
                    action: action,
                    command: command,
                    status: 'pending',
                  },
                ];
              });
            }
          }
        },
        abortController.signal
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        setSteps((prev) => [...prev, { type: 'result', content: `错误: ${err.message}` }]);
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [steps, isRunning, settings, agentSkills, buildSystemPrompt]);

  const handleRejectAction = useCallback((stepIndex) => {
    setSteps((prev) => {
      const updated = [...prev];
      if (updated[stepIndex]?.type === 'action') {
        updated[stepIndex] = { ...updated[stepIndex], status: 'rejected' };
        return [...updated, { type: 'result', content: '⏭️ 用户已跳过此操作' }];
      }
      return prev;
    });
    setCanContinue(true);
  }, []);

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setIsRunning(false);
    }
  }, []);

  const handleClear = useCallback(() => {
    setSteps([]);
    setCanContinue(false);
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="terminal-agent">
      <div className="terminal-agent-header">
        <h3>⚡ 终端Agent</h3>
        <div className="terminal-agent-info">
          <span className="terminal-agent-cwd" title={terminalCwd || '未连接'}>
            📂 {terminalCwd || '未连接终端'}
          </span>
          <span className="terminal-agent-skills-count">
            🔧 {allSkills.length} 个技能
          </span>
        </div>
        <div className="terminal-agent-actions">
          <button
            className="btn-icon"
            onClick={() => setShowPromptEdit(!showPromptEdit)}
            title="编辑提示词"
          >
            ✏️
          </button>
          <button className="btn-icon" onClick={handleClear} title="清空">🗑️</button>
          <button className="btn-icon" onClick={onClose} title="关闭">✕</button>
        </div>
      </div>

      {showPromptEdit && (
        <div className="terminal-agent-prompt-edit">
          <label>自定义终端Agent提示词（留空使用默认）</label>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            rows={4}
            placeholder={TERMINAL_AGENT_SYSTEM_PROMPT}
          />
        </div>
      )}

      <div className="terminal-agent-skills">
        <details>
          <summary>可用技能 ({allSkills.length})</summary>
          <div className="terminal-agent-skills-list">
            {allSkills.map((s) => (
              <div key={s.id} className="terminal-agent-skill-item">
                <span className="skill-icon">{s.icon}</span>
                <strong>{s.id}</strong>
                <span className="skill-desc">{s.description}</span>
              </div>
            ))}
          </div>
        </details>
      </div>

      <div className="terminal-agent-steps">
        {steps.map((step, i) => (
          <div key={i} className={`terminal-agent-step step-${step.type} ${step.status ? `step-${step.status}` : ''}`}>
            {step.type === 'user' && (
              <div className="step-user">
                <span className="step-label">👤 用户</span>
                <span className="step-content">{step.content}</span>
              </div>
            )}
            {step.type === 'thinking' && (
              <div className="step-thinking">
                <span className="step-label">🤔 思考</span>
                <span className="step-content">{step.content}</span>
              </div>
            )}
            {step.type === 'action' && (
              <div className="step-action">
                <span className="step-label">⚡ 操作</span>
                <code className="step-command">{step.content}</code>
                {step.status === 'pending' && (
                  <div className="step-action-buttons">
                    <button className="btn-confirm" onClick={() => handleConfirmAction(i)}>✅ 确认执行</button>
                    <button className="btn-reject" onClick={() => handleRejectAction(i)}>❌ 跳过</button>
                  </div>
                )}
                {step.status === 'executed' && <span className="step-status-badge executed">已执行</span>}
                {step.status === 'rejected' && <span className="step-status-badge rejected">已跳过</span>}
                {step.status === 'error' && <span className="step-status-badge error">执行失败</span>}
              </div>
            )}
            {step.type === 'result' && (
              <div className="step-result">
                <span className="step-label">📋 结果</span>
                <span className="step-content">{step.content}</span>
              </div>
            )}
          </div>
        ))}
        <div ref={stepsEndRef} />
      </div>

      {/* Continue button for step-by-step execution */}
      {canContinue && !isRunning && (
        <div className="step-continue-section">
          <button className="btn-continue" onClick={handleContinue}>
            ▶️ 继续下一步
          </button>
        </div>
      )}

      <div className="terminal-agent-input">
        <textarea
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述你想要终端执行的任务..."
          rows={2}
          disabled={isRunning}
        />
        <div className="terminal-agent-input-actions">
          {isRunning ? (
            <button className="btn-stop" onClick={handleStop}>⏹ 停止</button>
          ) : (
            <button className="btn-send" onClick={handleSend} disabled={!userInput.trim()}>
              发送 ↵
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
