import { useState, useCallback, useRef } from 'react';
import {
  adbScreenshot,
  adbClick,
  adbInputText,
  adbSwipe,
  adbKeyEvent,
  adbKeyboardInput,
  parseAgentAction,
} from '../services/adb';
import { sendChatRequest } from '../services/openai';

const DEFAULT_ADB_URL = 'http://localhost:8080';
const ADB_URL_STORAGE_KEY = 'agent-chat-adb-url';
const AUTO_SCREENSHOT_DELAY_MS = 1000;
// Coordinate range used by the model (0-1000 normalized)
const MODEL_COORD_RANGE = 1000;
// Default maximum steps for the agent loop
const DEFAULT_MAX_STEPS = 20;
// Delay (ms) between agent steps to allow UI to update
const AGENT_STEP_DELAY_MS = 1500;
// Android KEYCODE_BACK
const KEYCODE_BACK = 4;

// System prompt for the automated agent mode
const AGENT_SYSTEM_PROMPT = `你是一个手机屏幕操作助手 Agent。你的任务是根据用户的指令，分析手机截图，规划并执行操作步骤。

## 你的能力
你可以执行以下操作：
1. **click** - 点击屏幕上的某个元素
2. **input_text** - 在当前激活的输入框中输入文字（需要先点击输入框）
3. **swipe** - 在屏幕上滑动
4. **back** - 按返回键
5. **wait** - 等待页面加载
6. **finish** - 任务已完成

## 输出格式要求（严格遵守）
你必须且只能返回一个 JSON 对象，不要包含任何其他文字、解释或markdown标记。

### click 操作格式：
{"action": "click", "bbox_2d": [x1, y1, x2, y2], "label": "元素描述", "thought": "为什么要点击这个元素"}

### input_text 操作格式：
{"action": "input_text", "text": "要输入的文字", "thought": "为什么要输入这段文字"}

### swipe 操作格式：
{"action": "swipe", "start": [x1, y1], "end": [x2, y2], "thought": "为什么要滑动"}

### back 操作格式：
{"action": "back", "thought": "为什么要返回"}

### wait 操作格式：
{"action": "wait", "duration": 2, "thought": "为什么要等待"}

### finish 操作格式：
{"action": "finish", "thought": "任务完成的原因"}

## 坐标说明
- bbox_2d 坐标格式为 [x1, y1, x2, y2]，表示目标元素的左上角和右下角
- 坐标值范围为 0-1000，表示相对于图片宽高的千分比位置
- swipe 的 start 和 end 坐标格式为 [x, y]，同样是 0-1000 的千分比

## 重要规则
1. 每次只返回一个操作
2. 必须严格按照 JSON 格式返回，不要添加任何额外文字
3. 输入文字前必须先确保输入框已被点击激活
4. 根据当前屏幕状态判断下一步操作
5. 如果任务已完成，返回 finish 操作
6. thought 字段简要说明你的推理过程`;

function loadAdbUrl() {
  try {
    return localStorage.getItem(ADB_URL_STORAGE_KEY) || DEFAULT_ADB_URL;
  } catch {
    return DEFAULT_ADB_URL;
  }
}

/**
 * Get image dimensions from base64 encoded image data.
 */
function getImageDimensions(base64Img) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve(null);
    img.src = `data:image/png;base64,${base64Img}`;
  });
}

/**
 * Normalize a coordinate from model range (0-1000) to pixel range.
 */
function normalizeCoord(coord, dimension) {
  return Math.round((coord / MODEL_COORD_RANGE) * dimension);
}

/**
 * Build the user prompt for the agent including task, step number, and history.
 */
function buildAgentUserPrompt(task, step, history) {
  let historyText = '';
  if (history.length > 0) {
    historyText = '\n\n## 已执行的操作历史：\n';
    for (const h of history) {
      historyText += `步骤${h.step}: ${h.actionType}`;
      if (h.label) historyText += ` - ${h.label}`;
      if (h.text) historyText += ` - 输入: ${h.text}`;
      if (h.thought) historyText += ` (${h.thought})`;
      historyText += '\n';
    }
  }
  return (
    `## 当前任务\n${task}\n` +
    `\n## 当前是第 ${step} 步` +
    `${historyText}\n` +
    `\n## 请求\n` +
    `请分析当前屏幕截图，根据任务目标，决定下一步操作。` +
    `严格按照 JSON 格式返回一个操作。`
  );
}

export default function AdbGuiAgent({ settings, onClose }) {
  const [adbUrl] = useState(loadAdbUrl);
  const [screenshot, setScreenshot] = useState(null);
  const [imgDimensions, setImgDimensions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const [steps, setSteps] = useState([]);
  const abortRef = useRef(null);

  // --- Agent task state ---
  const [taskText, setTaskText] = useState('');
  const [agentRunning, setAgentRunning] = useState(false);
  const [autoMode, setAutoMode] = useState(true);
  const [maxSteps, setMaxSteps] = useState(DEFAULT_MAX_STEPS);
  const [pendingAction, setPendingAction] = useState(null);
  const agentAbortRef = useRef(false);
  // Ref used to resolve the confirmation promise in manual mode
  const confirmResolveRef = useRef(null);

  const addStep = useCallback((type, content) => {
    setSteps((prev) => [...prev, { type, content, timestamp: Date.now() }]);
  }, []);

  // ---- Screenshot helper (returns { base64, dims }) ----
  const captureScreenshot = useCallback(async () => {
    const base64Img = await adbScreenshot(adbUrl);
    const dims = await getImageDimensions(base64Img);
    setScreenshot(base64Img);
    if (dims) setImgDimensions(dims);
    return { base64: base64Img, dims };
  }, [adbUrl]);

  // Take screenshot (manual button)
  const takeScreenshot = useCallback(async () => {
    setError('');
    setLoading(true);
    setStatusMsg('截图中...');
    try {
      const { dims } = await captureScreenshot();
      addStep('screenshot', `截图成功 ${dims ? `(${dims.width}×${dims.height})` : ''}`);
      setStatusMsg('截图完成');
    } catch (err) {
      setError(`截图失败: ${err.message}`);
      addStep('error', `截图失败: ${err.message}`);
      setStatusMsg('');
    } finally {
      setLoading(false);
    }
  }, [captureScreenshot, addStep]);

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    // Also stop the agent loop
    agentAbortRef.current = true;
    setAgentRunning(false);
    setPendingAction(null);
    // Reject pending confirmation if any
    if (confirmResolveRef.current) {
      confirmResolveRef.current('abort');
      confirmResolveRef.current = null;
    }
    setLoading(false);
  }, []);

  // ================================================================
  // Agent Task Mode – automated loop
  // ================================================================

  /**
   * Execute a single parsed action on the device.
   * Returns true if the loop should continue, false if done.
   */
  const executeAgentAction = useCallback(async (action, dims) => {
    const { actionType } = action;

    if (actionType === 'click') {
      const [x1, y1, x2, y2] = action.bbox;
      const cx = Math.round((x1 + x2) / 2);
      const cy = Math.round((y1 + y2) / 2);
      const px = normalizeCoord(cx, dims.width);
      const py = normalizeCoord(cy, dims.height);
      addStep('action', `点击 [${action.label}] 坐标(${px}, ${py})`);
      await adbClick(px, py, adbUrl);
      addStep('success', `✅ 点击完成: ${action.label}`);
      return true;
    }

    if (actionType === 'input_text') {
      addStep('action', `输入文字: "${action.text}"`);
      try {
        await adbKeyboardInput(action.text, adbUrl);
      } catch {
        await adbInputText(action.text, adbUrl);
      }
      addStep('success', '✅ 输入完成');
      return true;
    }

    if (actionType === 'swipe') {
      const [sx, sy] = action.start;
      const [ex, ey] = action.end;
      const px1 = normalizeCoord(sx, dims.width);
      const py1 = normalizeCoord(sy, dims.height);
      const px2 = normalizeCoord(ex, dims.width);
      const py2 = normalizeCoord(ey, dims.height);
      addStep('action', `滑动 (${px1},${py1}) → (${px2},${py2})`);
      await adbSwipe(px1, py1, px2, py2, 300, adbUrl);
      addStep('success', '✅ 滑动完成');
      return true;
    }

    if (actionType === 'back') {
      addStep('action', '按返回键');
      await adbKeyEvent(KEYCODE_BACK, adbUrl);
      addStep('success', '✅ 返回完成');
      return true;
    }

    if (actionType === 'wait') {
      const dur = (action.duration || 2) * 1000;
      addStep('action', `等待 ${action.duration || 2} 秒...`);
      await new Promise((r) => setTimeout(r, dur));
      addStep('success', '✅ 等待完成');
      return true;
    }

    if (actionType === 'finish') {
      addStep('success', `🎉 任务完成: ${action.thought || ''}`);
      return false;
    }

    addStep('error', `未知操作: ${actionType}`);
    return false;
  }, [adbUrl, addStep]);

  /**
   * Wait for user confirmation in manual agent mode.
   * Resolves with 'confirm', 'skip', or 'abort'.
   */
  const waitForConfirmation = useCallback((action) => {
    return new Promise((resolve) => {
      setPendingAction(action);
      confirmResolveRef.current = resolve;
    });
  }, []);

  const handleConfirmAction = useCallback((decision) => {
    setPendingAction(null);
    if (confirmResolveRef.current) {
      confirmResolveRef.current(decision);
      confirmResolveRef.current = null;
    }
  }, []);

  /**
   * Main agent loop: screenshot → model → parse → (confirm) → execute → repeat
   */
  const runAgentTask = useCallback(async (task) => {
    if (!settings?.apiKey) {
      setError('请先在设置中配置API Key');
      return;
    }

    setError('');
    setSteps([]);
    setAgentRunning(true);
    setLoading(true);
    agentAbortRef.current = false;

    addStep('action', `🚀 开始任务: ${task} (最大${maxSteps}步, ${autoMode ? '全自动' : '逐步确认'})`);

    const history = [];

    for (let step = 1; step <= maxSteps; step++) {
      if (agentAbortRef.current) {
        addStep('error', '⏹ 任务被中止');
        break;
      }

      // 1. Take screenshot
      setStatusMsg(`步骤 ${step}: 截图中...`);
      let screenshotData;
      try {
        screenshotData = await captureScreenshot();
        addStep('screenshot', `步骤 ${step}: 截图完成`);
      } catch (err) {
        addStep('error', `截图失败: ${err.message}`);
        break;
      }

      if (agentAbortRef.current) break;

      // 2. Ask model for next action
      setStatusMsg(`步骤 ${step}: 分析屏幕...`);
      const userPrompt = buildAgentUserPrompt(task, step, history);
      const messages = [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${screenshotData.base64}` },
            },
            { type: 'text', text: userPrompt },
          ],
        },
      ];

      const agentSettings = {
        ...settings,
        temperature: 0,
        stream: false,
      };

      let rawResponse;
      try {
        const abortController = new AbortController();
        abortRef.current = abortController;
        const result = await sendChatRequest(
          messages,
          agentSettings,
          () => {},
          abortController.signal
        );
        rawResponse = result.content || '';
        abortRef.current = null;
      } catch (err) {
        if (err.name === 'AbortError') break;
        addStep('error', `模型请求失败: ${err.message}`);
        break;
      }

      addStep('model', `模型返回: ${rawResponse.slice(0, 300)}`);

      if (agentAbortRef.current) break;

      // 3. Parse action
      let action;
      try {
        action = parseAgentAction(rawResponse);
      } catch (err) {
        addStep('error', `解析失败: ${err.message}`);
        break;
      }

      addStep('action', `步骤 ${step}: ${action.actionType.toUpperCase()} — ${action.thought || ''}`);

      // 4. Confirmation in manual mode
      if (!autoMode && action.actionType !== 'finish') {
        const decision = await waitForConfirmation(action);
        if (decision === 'abort') break;
        if (decision === 'skip') {
          addStep('action', '⏭ 跳过此步骤');
          continue;
        }
      }

      if (agentAbortRef.current) break;

      // 5. Execute action
      let shouldContinue;
      try {
        shouldContinue = await executeAgentAction(action, screenshotData.dims);
      } catch (err) {
        addStep('error', `执行失败: ${err.message}`);
        continue;
      }

      // 6. Record history
      const entry = { step, actionType: action.actionType, thought: action.thought };
      if (action.label) entry.label = action.label;
      if (action.text) entry.text = action.text;
      history.push(entry);

      // 7. Check if done
      if (!shouldContinue) break;

      // 8. Wait for screen to settle
      await new Promise((r) => setTimeout(r, AGENT_STEP_DELAY_MS));
    }

    // Summary
    if (history.length > 0) {
      const summary = history
        .map((h) => {
          let s = `步骤${h.step}: ${h.actionType}`;
          if (h.label) s += ` → ${h.label}`;
          if (h.text) s += ` [输入: ${h.text}]`;
          return s;
        })
        .join('\n');
      addStep('success', `操作摘要 (共${history.length}步):\n${summary}`);
    }

    setAgentRunning(false);
    setLoading(false);
    setStatusMsg('');
    setPendingAction(null);
  }, [settings, maxSteps, autoMode, captureScreenshot, addStep, executeAgentAction, waitForConfirmation]);

  const handleStartTask = useCallback(() => {
    if (!taskText.trim()) return;
    runAgentTask(taskText.trim());
  }, [taskText, runAgentTask]);

  return (
    <div className="adb-gui-agent">
      <div className="adb-gui-agent-header">
        <h3>📱 手机GUI助手</h3>
        <button className="btn-icon" onClick={onClose} title="关闭">✕</button>
      </div>

      {/* Agent task section */}
      <div className="adb-gui-section">
        <div className="adb-gui-section-header">
          <span>🤖 自动任务</span>
          <div className="adb-agent-mode-toggle">
            <label title="全自动执行，无需逐步确认">
              <input
                type="checkbox"
                checked={autoMode}
                onChange={(e) => setAutoMode(e.target.checked)}
                disabled={agentRunning}
              />
              <span>自动</span>
            </label>
            <input
              type="number"
              className="adb-agent-max-steps"
              value={maxSteps}
              onChange={(e) => setMaxSteps(Math.max(1, parseInt(e.target.value, 10) || 1))}
              min={1}
              max={50}
              title="最大步数"
              disabled={agentRunning}
            />
            <span className="adb-agent-steps-label">步</span>
          </div>
        </div>
        <div className="adb-gui-detect-input">
          <input
            type="text"
            value={taskText}
            onChange={(e) => setTaskText(e.target.value)}
            placeholder="输入任务 (如: 打开微信发送消息)"
            onKeyDown={(e) => e.key === 'Enter' && !agentRunning && handleStartTask()}
            disabled={agentRunning}
          />
          {!agentRunning ? (
            <button
              className="btn-primary btn-small"
              onClick={handleStartTask}
              disabled={!taskText.trim() || loading}
            >
              ▶ 执行
            </button>
          ) : (
            <button className="btn-stop btn-small" onClick={handleStop}>
              ⏹ 停止
            </button>
          )}
        </div>

        {/* Pending confirmation in manual mode */}
        {pendingAction && (
          <div className="adb-agent-confirm">
            <div className="adb-agent-confirm-info">
              <strong>{pendingAction.actionType.toUpperCase()}</strong>
              {pendingAction.label && <span> — {pendingAction.label}</span>}
              {pendingAction.text && <span> — &quot;{pendingAction.text}&quot;</span>}
              {pendingAction.thought && (
                <div className="adb-agent-confirm-thought">{pendingAction.thought}</div>
              )}
            </div>
            <div className="adb-agent-confirm-btns">
              <button
                className="btn-primary btn-small"
                onClick={() => handleConfirmAction('confirm')}
              >
                ✅ 执行
              </button>
              <button
                className="btn-small"
                onClick={() => handleConfirmAction('skip')}
              >
                ⏭ 跳过
              </button>
              <button
                className="btn-stop btn-small"
                onClick={() => handleConfirmAction('abort')}
              >
                ⏹ 中止
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Screenshot area */}
      <div className="adb-gui-section">
        <div className="adb-gui-section-header">
          <span>📸 设备截图</span>
          <button
            className="btn-primary btn-small"
            onClick={takeScreenshot}
            disabled={loading}
          >
            截图
          </button>
        </div>
        {screenshot && (
          <div className="adb-screenshot-preview">
            <img
              src={`data:image/png;base64,${screenshot}`}
              alt="Device screenshot"
              className="adb-screenshot-img"
            />
            {imgDimensions && (
              <span className="adb-screenshot-size">
                {imgDimensions.width} × {imgDimensions.height}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Status & Error */}
      {error && <div className="adb-error">❌ {error}</div>}
      {statusMsg && !error && (
        <div className="adb-status">{loading ? '⏳' : '✅'} {statusMsg}</div>
      )}

      {/* Steps log */}
      <div className="adb-gui-steps">
        {steps.map((step, i) => (
          <div key={i} className={`adb-gui-step adb-gui-step-${step.type}`}>
            {step.type === 'screenshot' && <span>📸 {step.content}</span>}
            {step.type === 'model' && (
              <details>
                <summary>🤖 模型返回</summary>
                <pre>{step.content.replace('模型返回: ', '')}</pre>
              </details>
            )}
            {step.type === 'detect' && <span>🎯 {step.content}</span>}
            {step.type === 'action' && <span>👆 {step.content}</span>}
            {step.type === 'success' && <span style={{ whiteSpace: 'pre-wrap' }}>✅ {step.content}</span>}
            {step.type === 'error' && <span>❌ {step.content}</span>}
          </div>
        ))}
      </div>

      {/* Bottom controls */}
      <div className="adb-gui-controls">
        {loading && !agentRunning && (
          <button className="btn-stop" onClick={handleStop}>⏹ 停止</button>
        )}
      </div>
    </div>
  );
}
