import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { sendChatRequest } from '../services/openai';
import { loadFsm } from '../utils/storage';

/**
 * FsmAgent: Finite State Machine based terminal agent.
 *
 * Prompt architecture (system + user split):
 *   System prompt: defines the agent role (return Linux commands),
 *     includes current terminal path, file names in current directory, and user task.
 *   User prompt: tells the model to explore the state graph,
 *     provides current state node info, available commands / transitions.
 *
 * Flow (no multi-turn conversation passed to model):
 * 1. User enters a task
 * 2. Model selects next state (user confirms)
 * 3. In new state: model generates terminal command (user confirms)
 * 4. Execute command, model checks result
 * 5. Model selects next state transition
 *
 * Key: Each model call is independent (no multi-turn history).
 */

// Phase of the FSM agent execution cycle
const PHASES = {
  IDLE: 'idle',              // Waiting for task input
  SELECT_TRANSITION: 'select_transition', // Model selecting next state
  CONFIRM_TRANSITION: 'confirm_transition', // User confirming state transition
  SELECT_COMMAND: 'select_command', // Model selecting which command to use from available commands
  CONFIRM_COMMAND_SELECTION: 'confirm_command_selection', // User confirming selected command
  GENERATE_PARAMS: 'generate_params', // Model generating parameters for the selected command
  CONFIRM_COMMAND: 'confirm_command', // User confirming full command execution
  CHECK_RESULT: 'check_result', // Model checking execution result
  COMPLETED: 'completed',    // Task completed
};

// Common terminal commands for fallback command parsing
const KNOWN_COMMANDS = [
  // File & directory
  'cd', 'ls', 'pwd', 'mkdir', 'rmdir', 'touch', 'cp', 'mv', 'rm',
  'cat', 'head', 'tail', 'echo', 'tee', 'sed', 'wc',
  'find', 'grep', 'du', 'chmod', 'chown',
  'tar', 'zip', 'unzip',
  // System & process
  'uname', 'df', 'free', 'ps', 'kill', 'top', 'history',
  // Network
  'curl', 'ping', 'wget',
  // Environment & packages
  'export', 'which', 'npm', 'pip', 'apt',
  // Dev tools
  'python', 'node', 'git',
];

// Pre-built regex for matching lines starting with known commands
const KNOWN_COMMANDS_REGEX = new RegExp(`^(${KNOWN_COMMANDS.join('|')})(\\s|$)`);

// Delay after executing a command before checking the result
const COMMAND_EXECUTION_DELAY_MS = 2000;

// Server URL helper (reuse same logic as FileExplorer)
const ADB_URL_STORAGE_KEY = 'agent-chat-adb-url';
const DEFAULT_ADB_URL = 'http://localhost:8080';
function getServerUrl() {
  try {
    return localStorage.getItem(ADB_URL_STORAGE_KEY) || DEFAULT_ADB_URL;
  } catch {
    return DEFAULT_ADB_URL;
  }
}

// Fetch file names in the given directory (best-effort, returns empty string on failure)
async function fetchFileList(dirPath) {
  if (!dirPath) return '';
  try {
    const resp = await fetch(`${getServerUrl()}/api/fs/list?path=${encodeURIComponent(dirPath)}`);
    if (!resp.ok) return '';
    const data = await resp.json();
    const items = data.items || data.files || data;
    if (!Array.isArray(items) || items.length === 0) return '';
    const names = items.map((f) => (typeof f === 'string' ? f : f.name)).filter(Boolean);
    return names.join(', ');
  } catch {
    return '';
  }
}

export default function FsmAgent({
  settings,
  terminalCwd,
  terminalRef,
  onClose,
  onActiveStateChange,
}) {
  const [fsm] = useState(() => loadFsm());
  const [task, setTask] = useState('');
  const [currentStateId, setCurrentStateId] = useState('start');
  const [phase, setPhase] = useState(PHASES.IDLE);
  const [steps, setSteps] = useState([]);
  const [pendingTransition, setPendingTransition] = useState(null);
  const [pendingCommand, setPendingCommand] = useState(null);
  const [pendingSelectedCommand, setPendingSelectedCommand] = useState(null); // The command type selected by model
  const [isThinking, setIsThinking] = useState(false);
  const abortRef = useRef(null);
  const stepsEndRef = useRef(null);

  const currentState = fsm.states.find((s) => s.id === currentStateId);

  // Pre-sort states by name length (longest first) for fallback matching
  const sortedNonStartStates = useMemo(
    () => fsm.states.filter((s) => s.type !== 'start').sort((a, b) => b.name.length - a.name.length),
    [fsm.states]
  );

  // Auto-scroll
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps]);

  // Notify parent of active state changes
  useEffect(() => {
    if (onActiveStateChange) {
      onActiveStateChange(phase !== PHASES.IDLE && phase !== PHASES.COMPLETED ? currentStateId : null);
    }
  }, [currentStateId, phase, onActiveStateChange]);

  const addStep = useCallback((type, content) => {
    setSteps((prev) => [...prev, { type, content, timestamp: Date.now() }]);
  }, []);

  // Build system prompt: agent role, terminal path, file names, user task
  const buildSystemPrompt = useCallback((taskDesc, fileNames) => {
    return `你是一个有限状态机终端Agent。你的职责是根据状态图选择合适的状态转换或生成可直接在Linux终端执行的Shell指令。

【环境信息】
当前终端路径：${terminalCwd || '未知'}
当前路径下的文件：${fileNames || '（未获取）'}
用户任务：${taskDesc}

【回复规范 - 必须使用JSON格式】
- 当需要选择状态转换时，严格按以下JSON格式回复：
{"type":"transition","target":"目标状态名称","reason":"简要说明"}

- 当需要选择指令时，严格按以下JSON格式回复：
{"type":"select","command":"指令名称","reason":"简要说明"}

- 当需要生成指令时，严格按以下JSON格式回复：
{"type":"command","command":"完整的Shell命令","reason":"这条命令的作用"}

【禁止】
- 禁止输出 run-command,command:xxx 格式
- 禁止输出代码块标记
- 只输出JSON，不要输出其他内容`;
  }, [terminalCwd]);

  // Build user prompt for state transition selection
  const buildTransitionUserPrompt = useCallback((stateId, executionContext) => {
    const state = fsm.states.find((s) => s.id === stateId);
    if (!state) return '';

    const resolvedTransitions = state.transitions.map((t) => {
      const target = fsm.states.find((s) => s.id === t.to);
      const targetName = target?.name || t.to;
      return { targetName, condition: t.condition };
    });

    const transitionsDesc = resolvedTransitions.map((t) =>
      `  - 「${t.targetName}」: ${t.condition}`
    ).join('\n');

    const exampleTarget = resolvedTransitions[0]?.targetName || '目标状态';

    return `你正在状态图中探索，请根据当前状态节点信息选择下一个状态。

【当前状态节点】「${state.name}」
${executionContext ? `【执行情况】${executionContext}\n` : ''}
【可切换的状态】
${transitionsDesc || '  （无可用转换）'}

请从上面的可选状态中选择一个，严格按JSON格式回复：
{"type":"transition","target":"目标状态名称","reason":"简要说明"}

示例回复：
{"type":"transition","target":"${exampleTarget}","reason":"需要进行该操作来完成任务"}`;
  }, [fsm.states]);

  // Build user prompt for command SELECTION (step 1: model picks which command to use)
  const buildCommandSelectionPrompt = useCallback((stateId) => {
    const state = fsm.states.find((s) => s.id === stateId);
    if (!state) return '';

    const commandsDesc = state.commands.map((cmd, i) => {
      const param = cmd.paramName ? ` ${cmd.paramName}` : '';
      return `  ${i + 1}. ${cmd.type}${param}：${cmd.description}`;
    }).join('\n');

    return `你正在状态图中探索，当前状态节点有以下可执行的指令，请选择一个最适合完成任务的指令。

【当前状态节点】「${state.name}」
【可选指令列表】
${commandsDesc || '  （无可执行指令）'}

请从上面的指令列表中选择一个，严格按JSON格式回复：
{"type":"select","command":"指令名称","reason":"简要说明为什么选择这个指令"}

示例回复：
{"type":"select","command":"${state.commands[0]?.type || 'ls'}","reason":"需要查看目录内容"}`;
  }, [fsm.states]);

  // Build user prompt for parameter GENERATION (step 2: model generates params for selected command)
  const buildParamsGenerationPrompt = useCallback((stateId, selectedCommand) => {
    const state = fsm.states.find((s) => s.id === stateId);
    if (!state) return '';

    const cmdInfo = state.commands.find((c) => c.type === selectedCommand);
    const cmdDesc = cmdInfo ? `${cmdInfo.type}${cmdInfo.paramName ? ' ' + cmdInfo.paramName : ''}：${cmdInfo.description}` : selectedCommand;

    return `你正在状态图中探索，已选择要执行的指令，现在需要为该指令生成具体的参数。

【当前状态节点】「${state.name}」
【已选择的指令】${cmdDesc}
【用户任务目标】${task}

请根据用户任务目标，为已选择的指令"${selectedCommand}"生成完整的可执行Shell命令（包含具体参数），严格按JSON格式回复：
{"type":"command","command":"完整的Shell命令","reason":"这条命令的作用"}

示例回复（如果选择的是mkdir）：
{"type":"command","command":"mkdir -p /home/user/project","reason":"创建项目目录"}

示例回复（如果选择的是cat）：
{"type":"command","command":"cat package.json","reason":"查看package.json文件内容"}`;
  }, [fsm.states, task]);

  // Build user prompt for checking execution result
  const buildCheckUserPrompt = useCallback((stateId, command, result) => {
    const state = fsm.states.find((s) => s.id === stateId);
    if (!state) return '';

    const resolvedTransitions = state.transitions.map((t) => {
      const target = fsm.states.find((s) => s.id === t.to);
      const targetName = target?.name || t.to;
      return { targetName, condition: t.condition };
    });

    const transitionsDesc = resolvedTransitions.map((t) =>
      `  - 「${t.targetName}」: ${t.condition}`
    ).join('\n');

    const exampleTarget = resolvedTransitions[0]?.targetName || '目标状态';

    return `你正在状态图中探索，请检查刚执行的命令结果并选择下一个状态。

【当前状态节点】「${state.name}」
【已执行命令】${command}
【执行结果】
${result}

【可切换的状态】
${transitionsDesc || '  （无可用转换）'}

请从上面的可选状态中选择一个，严格按JSON格式回复：
{"type":"transition","target":"目标状态名称","reason":"简要说明"}

示例回复：
{"type":"transition","target":"${exampleTarget}","reason":"命令执行成功，进入下一步操作"}`;
  }, [fsm.states]);

  // Call model (single-turn, no history) – API calls now captured by global fetch interceptor
  const callModel = useCallback(async (systemPrompt, userPrompt) => {
    setIsThinking(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      let response = '';
      await sendChatRequest(
        messages,
        { ...settings, stream: true },
        (chunk, isDone) => {
          if (!isDone) {
            response += chunk;
          }
        },
        abortController.signal
      );

      return response;
    } catch (err) {
      if (err.name !== 'AbortError') {
        addStep('error', `模型调用失败: ${err.message}`);
      }
      return null;
    } finally {
      setIsThinking(false);
      abortRef.current = null;
    }
  }, [settings, addStep]);

  // Parse state name from model response (JSON format with text fallback)
  const parseStateName = useCallback((response) => {
    if (!response) return null;

    // 1. Try JSON parsing first
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.target) {
          const name = parsed.target.trim();
          const state = fsm.states.find((s) => s.name === name || s.id === name);
          if (state) return state;
        }
      }
    } catch {
      // JSON parse failed, fall through to text patterns
    }

    // 2. Standard text format fallback: 状态：xxx or 状态:xxx
    const match = response.match(/状态[：:]\s*[「"'【]?([^"'」】\n：:]+)/);
    if (match) {
      const name = match[1].trim().replace(/[「」"'【】]/g, '');
      const state = fsm.states.find((s) => s.name === name || s.id === name);
      if (state) return state;
    }

    // 3. Alternative patterns: 转换到/选择/进入 + state name
    const altPatterns = [
      /(?:转换到|选择|进入|下一步)[：:\s]*[「"'【]?([^"'」】\n：:，,。.]+)/,
      /目标状态[：:\s]*[「"'【]?([^"'」】\n：:，,。.]+)/,
    ];
    for (const pattern of altPatterns) {
      const altMatch = response.match(pattern);
      if (altMatch) {
        const name = altMatch[1].trim().replace(/[「」"'【】]/g, '');
        const state = fsm.states.find((s) => s.name === name || s.id === name);
        if (state) return state;
      }
    }

    // 4. Fallback: find any state name that appears in the response
    // Uses pre-sorted list (longest names first) to avoid partial matches
    for (const state of sortedNonStartStates) {
      if (response.includes(state.name)) {
        return state;
      }
    }
    return null;
  }, [fsm.states, sortedNonStartStates]);

  // Parse selected command from model response (JSON format with text fallback)
  const parseSelectedCommand = useCallback((response, stateId) => {
    if (!response) return null;
    const state = fsm.states.find((s) => s.id === stateId);
    if (!state) return null;
    const availableCommands = state.commands.map((c) => c.type);

    // 1. Try JSON parsing first
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.command) {
          const selected = parsed.command.trim();
          const found = availableCommands.find((c) => c === selected || selected.startsWith(c));
          if (found) return found;
        }
      }
    } catch {
      // JSON parse failed, fall through to text patterns
    }

    // 2. Standard text format fallback: 选择：xxx or 选择:xxx
    const match = response.match(/选择[：:]\s*`?([^`\n：:]+)`?/);
    if (match) {
      const selected = match[1].trim();
      const found = availableCommands.find((c) => c === selected || selected.startsWith(c));
      if (found) return found;
    }

    // 3. Fallback: find any available command name in the response
    for (const cmd of availableCommands) {
      if (response.includes(cmd)) return cmd;
    }

    // 4. If only one command available, default to it
    if (availableCommands.length === 1) return availableCommands[0];

    return null;
  }, [fsm.states]);

  // Parse command from model response (JSON format with text fallback)
  const parseCommand = useCallback((response) => {
    if (!response) return null;

    // 1. Try JSON parsing first
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.type === 'command' && parsed.command) {
          let cmd = parsed.command.trim();
          cmd = cmd.replace(/^[\w-]*command[,:\s]+/i, '').trim();
          if (cmd) return cmd;
        }
      }
    } catch {
      // JSON parse failed, fall through to text patterns
    }

    // 2. Standard text format fallback: 指令：xxx or 指令:xxx
    const match = response.match(/指令[：:]\s*`?([^`\n]+)`?/);
    if (match) {
      let cmd = match[1].trim();
      // Strip common malformed prefixes like "run-command,command:" or "run-command:"
      cmd = cmd.replace(/^[\w-]*command[,:\s]+/i, '').trim();
      if (cmd) return cmd;
    }

    // 3. Match content inside code blocks (```...```)
    const codeBlockMatch = response.match(/```(?:bash|sh|shell)?\s*\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      const cmd = codeBlockMatch[1].trim();
      if (cmd) return cmd;
    }

    // 4. Strip malformed skill-like prefix patterns: "run-command,command:xxx" → "xxx"
    const malformedMatch = response.match(/[\w-]*command[,:\s]+(.+)/i);
    if (malformedMatch) {
      const cmd = malformedMatch[1].trim();
      if (cmd) return cmd;
    }

    // 5. Match command after 命令/执行/$ prefix
    const altPatterns = [
      /命令[：:]\s*`?([^`\n]+)`?/,
      /执行[：:]\s*`?([^`\n]+)`?/,
      /\$\s+(.+)/,
    ];
    for (const pattern of altPatterns) {
      const altMatch = response.match(pattern);
      if (altMatch) {
        const cmd = altMatch[1].trim();
        if (cmd) return cmd;
      }
    }

    // 6. Fallback: look for lines starting with common terminal commands
    const lines = response.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && KNOWN_COMMANDS_REGEX.test(trimmed)) {
        return trimmed;
      }
    }
    return null;
  }, []);

  // Start the FSM agent with a task
  const handleStart = useCallback(async () => {
    if (!task.trim()) return;

    addStep('task', `任务: ${task.trim()}`);
    setCurrentStateId('start');
    setPhase(PHASES.SELECT_TRANSITION);

    // Fetch file listing for context
    const fileNames = await fetchFileList(terminalCwd);

    // First step: select transition from start state
    const systemPrompt = buildSystemPrompt(task.trim(), fileNames);
    const userPrompt = buildTransitionUserPrompt('start', null);
    addStep('thinking', '🤔 分析任务，选择初始状态转换...');
    const response = await callModel(systemPrompt, userPrompt);

    if (response) {
      const targetState = parseStateName(response);
      if (targetState) {
        setPendingTransition(targetState);
        setPhase(PHASES.CONFIRM_TRANSITION);
        addStep('transition', `模型建议转换到: 「${targetState.name}」`);
        addStep('model', response);
      } else {
        addStep('error', '无法解析模型建议的状态转换');
        setPhase(PHASES.IDLE);
      }
    }
  }, [task, terminalCwd, buildSystemPrompt, buildTransitionUserPrompt, callModel, parseStateName, addStep]);

  // User confirms state transition
  const handleConfirmTransition = useCallback(async () => {
    if (!pendingTransition) return;

    const targetState = pendingTransition;
    setCurrentStateId(targetState.id);
    setPendingTransition(null);
    addStep('confirmed', `✅ 已转换到: 「${targetState.name}」`);

    // If end state, complete
    if (targetState.type === 'end') {
      setPhase(PHASES.COMPLETED);
      addStep('complete', '🎉 任务完成');
      return;
    }

    // Fetch file listing for context
    const fileNames = await fetchFileList(terminalCwd);

    // If the state has commands, first let model SELECT which command to use
    if (targetState.commands && targetState.commands.length > 0) {
      setPhase(PHASES.SELECT_COMMAND);
      addStep('thinking', '🤔 选择要执行的指令...');
      const systemPrompt = buildSystemPrompt(task, fileNames);
      const userPrompt = buildCommandSelectionPrompt(targetState.id);
      const response = await callModel(systemPrompt, userPrompt);

      if (response) {
        const selectedCmd = parseSelectedCommand(response, targetState.id);
        if (selectedCmd) {
          setPendingSelectedCommand(selectedCmd);
          setPhase(PHASES.CONFIRM_COMMAND_SELECTION);
          addStep('command', `模型选择指令: ${selectedCmd}`);
          addStep('model', response);
        } else {
          addStep('error', '无法解析模型选择的指令');
          setPhase(PHASES.SELECT_TRANSITION);
        }
      }
    } else {
      // State has no commands, go directly to transition selection
      setPhase(PHASES.SELECT_TRANSITION);
      const systemPrompt = buildSystemPrompt(task, fileNames);
      const userPrompt = buildTransitionUserPrompt(targetState.id, null);
      addStep('thinking', '🤔 选择下一步状态转换...');
      const response = await callModel(systemPrompt, userPrompt);

      if (response) {
        const nextState = parseStateName(response);
        if (nextState) {
          setPendingTransition(nextState);
          setPhase(PHASES.CONFIRM_TRANSITION);
          addStep('transition', `模型建议转换到: 「${nextState.name}」`);
          addStep('model', response);
        }
      }
    }
  }, [pendingTransition, task, terminalCwd, buildSystemPrompt, buildCommandSelectionPrompt, buildTransitionUserPrompt, callModel, parseSelectedCommand, parseStateName, addStep]);

  // User confirms command selection, then model generates parameters
  const handleConfirmCommandSelection = useCallback(async () => {
    if (!pendingSelectedCommand) return;

    const selectedCmd = pendingSelectedCommand;
    setPendingSelectedCommand(null);
    addStep('confirmed', `✅ 已确认选择指令: ${selectedCmd}`);

    // Fetch file listing for context
    const fileNames = await fetchFileList(terminalCwd);

    // Now let model generate parameters for the selected command
    setPhase(PHASES.GENERATE_PARAMS);
    addStep('thinking', `🤔 为指令 "${selectedCmd}" 生成参数...`);
    const systemPrompt = buildSystemPrompt(task, fileNames);
    const userPrompt = buildParamsGenerationPrompt(currentStateId, selectedCmd);
    const response = await callModel(systemPrompt, userPrompt);

    if (response) {
      const command = parseCommand(response);
      if (command) {
        setPendingCommand(command);
        setPhase(PHASES.CONFIRM_COMMAND);
        addStep('command', `模型生成完整指令: ${command}`);
        addStep('model', response);
      } else {
        addStep('error', '无法解析模型生成的指令参数');
        setPhase(PHASES.SELECT_TRANSITION);
      }
    }
  }, [pendingSelectedCommand, task, terminalCwd, currentStateId, buildSystemPrompt, buildParamsGenerationPrompt, callModel, parseCommand, addStep]);

  // User rejects command selection
  const handleRejectCommandSelection = useCallback(() => {
    setPendingSelectedCommand(null);
    addStep('rejected', '❌ 用户拒绝指令选择');
    setPhase(PHASES.SELECT_TRANSITION);
  }, [addStep]);

  // User rejects state transition
  const handleRejectTransition = useCallback(() => {
    setPendingTransition(null);
    addStep('rejected', '❌ 用户拒绝状态转换');
    setPhase(PHASES.IDLE);
  }, [addStep]);

  // User confirms command execution
  const handleConfirmCommand = useCallback(async () => {
    if (!pendingCommand) return;

    const command = pendingCommand;
    setPendingCommand(null);

    // Execute in terminal
    if (terminalRef?.current?.sendCommand(command)) {
      addStep('executed', `✅ 已执行: ${command}`);

      // Start capturing terminal output before execution delay
      terminalRef.current.startCapture?.();

      // Wait for terminal to process the command
      await new Promise((r) => setTimeout(r, COMMAND_EXECUTION_DELAY_MS));

      // Retrieve captured terminal output
      const capturedOutput = terminalRef.current.stopCapture?.() || '';
      const trimmedOutput = capturedOutput.trim();
      const resultInfo = trimmedOutput
        ? `终端输出:\n${trimmedOutput}`
        : '命令已发送到终端执行（无捕获输出）';

      if (trimmedOutput) {
        addStep('output', `📋 终端输出: ${trimmedOutput.slice(0, 200)}${trimmedOutput.length > 200 ? '...' : ''}`);
      }

      // Fetch file listing for context
      const fileNames = await fetchFileList(terminalCwd);

      setPhase(PHASES.CHECK_RESULT);
      addStep('thinking', '🤔 检查执行结果，决定下一步...');
      const systemPrompt = buildSystemPrompt(task, fileNames);
      const userPrompt = buildCheckUserPrompt(currentStateId, command, resultInfo);
      const response = await callModel(systemPrompt, userPrompt);

      if (response) {
        const nextState = parseStateName(response);
        if (nextState) {
          setPendingTransition(nextState);
          setPhase(PHASES.CONFIRM_TRANSITION);
          addStep('transition', `模型建议转换到: 「${nextState.name}」`);
          addStep('model', response);
        } else {
          addStep('error', '无法解析模型建议的状态转换');
          setPhase(PHASES.IDLE);
        }
      }
    } else {
      addStep('error', '❌ 终端未连接，无法执行');
      setPhase(PHASES.IDLE);
    }
  }, [pendingCommand, terminalRef, task, terminalCwd, currentStateId, buildSystemPrompt, buildCheckUserPrompt, callModel, parseStateName, addStep]);

  // User rejects command
  const handleRejectCommand = useCallback(() => {
    setPendingCommand(null);
    addStep('rejected', '❌ 用户拒绝执行指令');
    // Go back to transition selection
    setPhase(PHASES.SELECT_TRANSITION);
  }, [addStep]);

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setIsThinking(false);
    setPhase(PHASES.IDLE);
    addStep('stopped', '⏹ 用户停止');
  }, [addStep]);

  const handleReset = useCallback(() => {
    setSteps([]);
    setCurrentStateId('start');
    setPhase(PHASES.IDLE);
    setPendingTransition(null);
    setPendingCommand(null);
    setPendingSelectedCommand(null);
    if (onActiveStateChange) onActiveStateChange(null);
  }, [onActiveStateChange]);

  return (
    <div className="fsm-agent">
      <div className="fsm-agent-header">
        <h3>🔄 有限状态机Agent</h3>
        <div className="fsm-agent-info">
          <span className="fsm-agent-cwd" title={terminalCwd || '未连接'}>
            📂 {terminalCwd || '未连接终端'}
          </span>
          <span className="fsm-agent-state">
            📍 {currentState?.name || '未知'}
          </span>
        </div>
        <div className="fsm-agent-actions">
          <button className="btn-icon" onClick={handleReset} title="重置">🔄</button>
          <button className="btn-icon" onClick={onClose} title="关闭">✕</button>
        </div>
      </div>

      {/* Task input */}
      {phase === PHASES.IDLE && (
        <div className="fsm-agent-task-input">
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="描述你想要完成的任务..."
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleStart();
              }
            }}
          />
          <button
            className="btn-primary"
            onClick={handleStart}
            disabled={!task.trim() || isThinking}
          >
            🚀 开始执行
          </button>
        </div>
      )}

      {/* Current phase indicator */}
      {phase !== PHASES.IDLE && (
        <div className="fsm-phase-indicator">
          <span className={`fsm-phase-badge phase-${phase}`}>
            {phase === PHASES.SELECT_TRANSITION && '🔀 选择转换'}
            {phase === PHASES.CONFIRM_TRANSITION && '⏳ 确认转换'}
            {phase === PHASES.SELECT_COMMAND && '🔍 选择指令'}
            {phase === PHASES.CONFIRM_COMMAND_SELECTION && '⏳ 确认指令选择'}
            {phase === PHASES.GENERATE_PARAMS && '⚡ 生成参数'}
            {phase === PHASES.CONFIRM_COMMAND && '⏳ 确认执行'}
            {phase === PHASES.CHECK_RESULT && '🔍 检查结果'}
            {phase === PHASES.COMPLETED && '✅ 已完成'}
          </span>
          {isThinking && <span className="fsm-thinking-dot">●</span>}
        </div>
      )}

      {/* Action buttons for user confirmation */}
      {phase === PHASES.CONFIRM_TRANSITION && pendingTransition && (
        <div className="fsm-confirm-panel">
          <div className="fsm-confirm-info">
            转换到状态: <strong>「{pendingTransition.name}」</strong>
          </div>
          <div className="fsm-confirm-buttons">
            <button className="btn-confirm" onClick={handleConfirmTransition} disabled={isThinking}>
              ✅ 确认转换
            </button>
            <button className="btn-reject" onClick={handleRejectTransition}>
              ❌ 拒绝
            </button>
          </div>
        </div>
      )}

      {phase === PHASES.CONFIRM_COMMAND_SELECTION && pendingSelectedCommand && (
        <div className="fsm-confirm-panel">
          <div className="fsm-confirm-info">
            选择指令: <strong>{pendingSelectedCommand}</strong>
          </div>
          <div className="fsm-confirm-buttons">
            <button className="btn-confirm" onClick={handleConfirmCommandSelection} disabled={isThinking}>
              ✅ 确认选择
            </button>
            <button className="btn-reject" onClick={handleRejectCommandSelection}>
              ❌ 拒绝
            </button>
          </div>
        </div>
      )}

      {phase === PHASES.CONFIRM_COMMAND && pendingCommand && (
        <div className="fsm-confirm-panel">
          <div className="fsm-confirm-info">
            执行指令: <code>{pendingCommand}</code>
          </div>
          <div className="fsm-confirm-buttons">
            <button className="btn-confirm" onClick={handleConfirmCommand} disabled={isThinking}>
              ✅ 确认执行
            </button>
            <button className="btn-reject" onClick={handleRejectCommand}>
              ❌ 跳过
            </button>
          </div>
        </div>
      )}

      {/* Execution steps log */}
      <div className="fsm-agent-steps">
        {steps.map((step, i) => (
          <div key={i} className={`fsm-step fsm-step-${step.type}`}>
            {step.type === 'task' && <span>🎯 {step.content}</span>}
            {step.type === 'thinking' && <span className="fsm-step-thinking">{step.content}</span>}
            {step.type === 'transition' && <span>🔀 {step.content}</span>}
            {step.type === 'confirmed' && <span>{step.content}</span>}
            {step.type === 'command' && <span>⚡ {step.content}</span>}
            {step.type === 'executed' && <span>{step.content}</span>}
            {step.type === 'output' && (
              <details className="fsm-step-output-detail">
                <summary>📋 终端输出</summary>
                <pre>{step.content.replace('📋 终端输出: ', '')}</pre>
              </details>
            )}
            {step.type === 'model' && (
              <details className="fsm-step-model-detail">
                <summary>📋 模型原始回复</summary>
                <pre>{step.content}</pre>
              </details>
            )}
            {step.type === 'error' && <span className="fsm-step-error">❌ {step.content}</span>}
            {step.type === 'rejected' && <span>{step.content}</span>}
            {step.type === 'stopped' && <span>{step.content}</span>}
            {step.type === 'complete' && <span>{step.content}</span>}
          </div>
        ))}
        <div ref={stepsEndRef} />
      </div>

      {/* Bottom controls */}
      <div className="fsm-agent-controls">
        {isThinking && (
          <button className="btn-stop" onClick={handleStop}>⏹ 停止</button>
        )}
        {phase === PHASES.COMPLETED && (
          <button className="btn-primary" onClick={handleReset}>🔄 新任务</button>
        )}
      </div>
    </div>
  );
}
