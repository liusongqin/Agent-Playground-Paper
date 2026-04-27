import { useState, useCallback } from 'react';
import {
  adbScreenshot,
  adbClick,
  adbInputText,
  adbSwipe,
  adbKeyEvent,
  adbDevices,
  parseBboxFromResponse,
  calcBboxCenter,
  normalizedToPixel,
  adbKeyboardInput,
} from '../services/adb';
import { sendChatRequest } from '../services/openai';

const DEFAULT_ADB_URL = 'http://localhost:8080';
const ADB_URL_STORAGE_KEY = 'agent-chat-adb-url';
// Delay before auto-screenshot after an ADB action (ms)
const AUTO_SCREENSHOT_DELAY_MS = 1000;
// Prompt template for the vision model element detection (Chinese works best with Qwen models)
const DETECT_PROMPT_TEMPLATE = (target) => `图片上${target}的坐标`;

function loadAdbUrl() {
  try {
    return localStorage.getItem(ADB_URL_STORAGE_KEY) || DEFAULT_ADB_URL;
  } catch {
    return DEFAULT_ADB_URL;
  }
}

export default function WorkflowEditor({ settings }) {
  const [adbUrl, setAdbUrl] = useState(loadAdbUrl);
  const [adbUrlInput, setAdbUrlInput] = useState(loadAdbUrl);
  const [showConfig, setShowConfig] = useState(false);
  const [screenshot, setScreenshot] = useState(null); // base64 image
  const [imgDimensions, setImgDimensions] = useState(null); // {width, height}
  const [targetText, setTargetText] = useState('');
  const [detectedElements, setDetectedElements] = useState([]);
  const [modelResponse, setModelResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const [operationLog, setOperationLog] = useState([]);
  const [devices, setDevices] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [textInputMethod, setTextInputMethod] = useState('adb'); // 'adb' or 'keyboard'

  const addLog = useCallback((msg, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    setOperationLog((prev) => [...prev, { time, msg, type }].slice(-50));
  }, []);

  const handleSaveConfig = () => {
    const url = adbUrlInput.trim() || DEFAULT_ADB_URL;
    setAdbUrl(url);
    try {
      localStorage.setItem(ADB_URL_STORAGE_KEY, url);
    } catch {
      // ignore
    }
    setShowConfig(false);
    addLog(`ADB bridge URL set to: ${url}`);
  };

  const handleCheckDevices = async () => {
    setError('');
    try {
      const result = await adbDevices(adbUrl);
      setDevices(result.devices || []);
      addLog(`Found ${(result.devices || []).length} device(s)`);
    } catch (err) {
      const hint = err.message.includes('Failed to fetch')
        ? 'Cannot reach the ADB bridge server. Make sure the server is running: cd server && python server.py'
        : err.message;
      setError(`Device check failed: ${hint}`);
      addLog(`Device check failed: ${hint}`, 'error');
    }
  };

  const handleScreenshot = async () => {
    setError('');
    setLoading(true);
    setStatusMsg('Taking screenshot...');
    try {
      const base64Img = await adbScreenshot(adbUrl);
      setScreenshot(base64Img);
      setDetectedElements([]);
      setModelResponse('');

      // Get image dimensions
      const img = new Image();
      img.onload = () => {
        setImgDimensions({ width: img.width, height: img.height });
      };
      img.src = `data:image/png;base64,${base64Img}`;

      addLog('Screenshot captured successfully');
      setStatusMsg('Screenshot ready');
    } catch (err) {
      setError(`Screenshot failed: ${err.message}`);
      addLog(`Screenshot failed: ${err.message}`, 'error');
      setStatusMsg('');
    } finally {
      setLoading(false);
    }
  };

  const handleDetect = async () => {
    if (!screenshot || !targetText.trim()) return;
    if (!settings?.apiKey) {
      setError('API Key required. Please configure in Settings.');
      return;
    }

    setError('');
    setLoading(true);
    setStatusMsg(`Detecting: ${targetText}...`);
    setDetectedElements([]);
    setModelResponse('');

    try {
      const messages = [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${screenshot}` },
            },
            {
              type: 'text',
              text: DETECT_PROMPT_TEMPLATE(targetText.trim()),
            },
          ],
        },
      ];

      const detectSettings = {
        ...settings,
        temperature: 0.1,
        stream: false,
      };

      const result = await sendChatRequest(
        messages,
        detectSettings,
        () => {},
        null
      );

      const responseContent = result.content || '';
      setModelResponse(responseContent);
      addLog(`Model response received`);

      try {
        const elements = parseBboxFromResponse(responseContent);
        setDetectedElements(elements);
        addLog(`Detected ${elements.length} element(s)`);
        setStatusMsg(`Found ${elements.length} element(s)`);
      } catch (parseErr) {
        setError(`Failed to parse coordinates: ${parseErr.message}`);
        addLog(`Parse failed: ${parseErr.message}`, 'error');
        setStatusMsg('');
      }
    } catch (err) {
      setError(`Detection failed: ${err.message}`);
      addLog(`Detection failed: ${err.message}`, 'error');
      setStatusMsg('');
    } finally {
      setLoading(false);
    }
  };

  const handleClickElement = async (element) => {
    if (!imgDimensions) return;

    setError('');
    setLoading(true);
    const { cx, cy } = calcBboxCenter(element.x1, element.y1, element.x2, element.y2);
    const { px, py } = normalizedToPixel(cx, cy, imgDimensions.width, imgDimensions.height);

    setStatusMsg(`Clicking ${element.label} at (${px}, ${py})...`);
    try {
      await adbClick(px, py, adbUrl);
      addLog(`Clicked [${element.label}] at (${px}, ${py})`);
      setStatusMsg(`Clicked ${element.label}`);

      // Auto-screenshot after click (with delay)
      setTimeout(async () => {
        try {
          const base64Img = await adbScreenshot(adbUrl);
          setScreenshot(base64Img);
          setDetectedElements([]);
          setModelResponse('');
          const img = new Image();
          img.onload = () => {
            setImgDimensions({ width: img.width, height: img.height });
          };
          img.src = `data:image/png;base64,${base64Img}`;
          addLog('Auto-screenshot after click');
        } catch {
          // ignore auto-screenshot errors
        }
      }, AUTO_SCREENSHOT_DELAY_MS);
    } catch (err) {
      setError(`Click failed: ${err.message}`);
      addLog(`Click failed: ${err.message}`, 'error');
      setStatusMsg('');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAction = async (action) => {
    setError('');
    setLoading(true);
    setStatusMsg(`Executing ${action}...`);
    // Use actual device dimensions for swipe if available, fallback to common 1080x2400
    const sw = imgDimensions?.width || 1080;
    const sh = imgDimensions?.height || 2400;
    const midX = Math.round(sw / 2);
    const midY = Math.round(sh / 2);
    try {
      switch (action) {
        case 'back':
          await adbKeyEvent(4, adbUrl);
          addLog('Key: Back');
          break;
        case 'home':
          await adbKeyEvent(3, adbUrl);
          addLog('Key: Home');
          break;
        case 'recents':
          await adbKeyEvent(187, adbUrl);
          addLog('Key: Recent Apps');
          break;
        case 'power':
          await adbKeyEvent(26, adbUrl);
          addLog('Key: Power');
          break;
        case 'swipe-up':
          await adbSwipe(midX, Math.round(sh * 0.75), midX, Math.round(sh * 0.25), 300, adbUrl);
          addLog('Swipe: Up');
          break;
        case 'swipe-down':
          await adbSwipe(midX, Math.round(sh * 0.25), midX, Math.round(sh * 0.75), 300, adbUrl);
          addLog('Swipe: Down');
          break;
        case 'swipe-left':
          await adbSwipe(Math.round(sw * 0.8), midY, Math.round(sw * 0.2), midY, 300, adbUrl);
          addLog('Swipe: Left');
          break;
        case 'swipe-right':
          await adbSwipe(Math.round(sw * 0.2), midY, Math.round(sw * 0.8), midY, 300, adbUrl);
          addLog('Swipe: Right');
          break;
        default:
          break;
      }
      setStatusMsg(`${action} done`);

      // Auto-screenshot after action
      setTimeout(async () => {
        try {
          const base64Img = await adbScreenshot(adbUrl);
          setScreenshot(base64Img);
          setDetectedElements([]);
          const img = new Image();
          img.onload = () => {
            setImgDimensions({ width: img.width, height: img.height });
          };
          img.src = `data:image/png;base64,${base64Img}`;
        } catch {
          // ignore
        }
      }, AUTO_SCREENSHOT_DELAY_MS);
    } catch (err) {
      setError(`${action} failed: ${err.message}`);
      addLog(`${action} failed: ${err.message}`, 'error');
      setStatusMsg('');
    } finally {
      setLoading(false);
    }
  };

  const handleInputText = async () => {
    if (!textInput.trim()) return;
    setError('');
    setLoading(true);
    setStatusMsg('Inputting text...');
    try {
      if (textInputMethod === 'keyboard') {
        await adbKeyboardInput(textInput, adbUrl);
        addLog(`Input text (ADB Keyboard): "${textInput}"`);
      } else {
        await adbInputText(textInput, adbUrl);
        addLog(`Input text (Raw ADB): "${textInput}"`);
      }
      setStatusMsg('Text entered');
      setTextInput('');
    } catch (err) {
      setError(`Input text failed: ${err.message}`);
      addLog(`Input text failed: ${err.message}`, 'error');
      setStatusMsg('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="adb-assistant">
      <div className="adb-assistant-header">
        <span className="adb-assistant-title">📱 ADB ASSISTANT</span>
        <button
          className="btn-icon"
          onClick={() => setShowConfig(!showConfig)}
          title="Configure ADB Bridge"
        >
          ⚙️
        </button>
      </div>

      {showConfig && (
        <div className="adb-config">
          <div className="form-group">
            <label>ADB Bridge Server URL</label>
            <input
              type="text"
              value={adbUrlInput}
              onChange={(e) => setAdbUrlInput(e.target.value)}
              placeholder={DEFAULT_ADB_URL}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveConfig()}
            />
            <span className="adb-config-hint">
              This is the URL of the ADB bridge server (e.g. http://localhost:8080), NOT the device IP.
              Start the bridge server first: <code>cd server &amp;&amp; pip install -r requirements.txt &amp;&amp; python server.py</code>
            </span>
          </div>
          <div className="adb-config-actions">
            <button className="btn-secondary" onClick={() => setShowConfig(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSaveConfig}>
              Save
            </button>
          </div>
        </div>
      )}

      <div className="adb-assistant-body">
        {/* Connection & Device Section */}
        <div className="adb-section">
          <div className="adb-section-header">
            <span>🔌 Connection</span>
            <button
              className="btn-icon btn-small"
              onClick={handleCheckDevices}
              title="Check devices"
              disabled={loading}
            >
              🔍
            </button>
          </div>
          <div className="adb-connection-info">
            <span className="adb-url-label">{adbUrl}</span>
            {devices.length > 0 && (
              <div className="adb-devices">
                {devices.map((d, i) => (
                  <span key={i} className="adb-device-badge">
                    📱 {d.id || d.serial || d}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Screenshot Section */}
        <div className="adb-section">
          <div className="adb-section-header">
            <span>📸 Screenshot</span>
            <button
              className="btn-primary btn-small"
              onClick={handleScreenshot}
              disabled={loading}
            >
              {loading && statusMsg.includes('screenshot') ? '...' : 'Capture'}
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
              {/* Overlay detected bboxes */}
              {detectedElements.length > 0 && imgDimensions && (
                <div className="adb-bbox-overlay">
                  {detectedElements.map((el, i) => {
                    const left = (el.x1 / 1000) * 100;
                    const top = (el.y1 / 1000) * 100;
                    const width = ((el.x2 - el.x1) / 1000) * 100;
                    const height = ((el.y2 - el.y1) / 1000) * 100;
                    return (
                      <div
                        key={i}
                        className="adb-bbox-rect"
                        style={{
                          left: `${left}%`,
                          top: `${top}%`,
                          width: `${width}%`,
                          height: `${height}%`,
                        }}
                        onClick={() => handleClickElement(el)}
                        title={`Click: ${el.label}`}
                      >
                        <span className="adb-bbox-label">{el.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Element Detection Section */}
        <div className="adb-section">
          <div className="adb-section-header">
            <span>🎯 Element Detection</span>
          </div>
          <div className="adb-detect-input">
            <input
              type="text"
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
              placeholder="Describe target (e.g. search button, input field)"
              onKeyDown={(e) => e.key === 'Enter' && handleDetect()}
              disabled={loading || !screenshot}
            />
            <button
              className="btn-primary btn-small"
              onClick={handleDetect}
              disabled={loading || !screenshot || !targetText.trim()}
            >
              {loading && statusMsg.includes('Detecting') ? '...' : 'Detect'}
            </button>
          </div>
          {detectedElements.length > 0 && (
            <div className="adb-detected-list">
              {detectedElements.map((el, i) => {
                const { cx, cy } = calcBboxCenter(el.x1, el.y1, el.x2, el.y2);
                const pixel = imgDimensions
                  ? normalizedToPixel(cx, cy, imgDimensions.width, imgDimensions.height)
                  : null;
                return (
                  <div
                    key={i}
                    className="adb-detected-item"
                    onClick={() => handleClickElement(el)}
                    title="Click to tap this element"
                  >
                    <span className="adb-detected-index">{i}</span>
                    <div className="adb-detected-info">
                      <span className="adb-detected-label">{el.label}</span>
                      <span className="adb-detected-coords">
                        bbox({el.x1},{el.y1},{el.x2},{el.y2})
                        {pixel && ` → (${pixel.px}, ${pixel.py})`}
                      </span>
                    </div>
                    <button className="btn-icon btn-small" title="Click this element">
                      👆
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {modelResponse && (
            <details className="adb-model-response">
              <summary>Model Response</summary>
              <pre>{modelResponse}</pre>
            </details>
          )}
        </div>

        {/* Quick Actions Section */}
        <div className="adb-section">
          <div className="adb-section-header">
            <span>⚡ Quick Actions</span>
          </div>
          <div className="adb-quick-actions">
            <button
              className="adb-action-btn"
              onClick={() => handleQuickAction('back')}
              disabled={loading}
              title="Back"
            >
              ◀ Back
            </button>
            <button
              className="adb-action-btn"
              onClick={() => handleQuickAction('home')}
              disabled={loading}
              title="Home"
            >
              ● Home
            </button>
            <button
              className="adb-action-btn"
              onClick={() => handleQuickAction('recents')}
              disabled={loading}
              title="Recent Apps"
            >
              ▢ Recents
            </button>
            <button
              className="adb-action-btn"
              onClick={() => handleQuickAction('power')}
              disabled={loading}
              title="Power"
            >
              ⏻ Power
            </button>
          </div>
          <div className="adb-quick-actions">
            <button
              className="adb-action-btn"
              onClick={() => handleQuickAction('swipe-up')}
              disabled={loading}
              title="Swipe Up"
            >
              ↑ Up
            </button>
            <button
              className="adb-action-btn"
              onClick={() => handleQuickAction('swipe-down')}
              disabled={loading}
              title="Swipe Down"
            >
              ↓ Down
            </button>
            <button
              className="adb-action-btn"
              onClick={() => handleQuickAction('swipe-left')}
              disabled={loading}
              title="Swipe Left"
            >
              ← Left
            </button>
            <button
              className="adb-action-btn"
              onClick={() => handleQuickAction('swipe-right')}
              disabled={loading}
              title="Swipe Right"
            >
              → Right
            </button>
          </div>
        </div>

        {/* Text Input Section */}
        <div className="adb-section">
          <div className="adb-section-header">
            <span>⌨️ Text Input</span>
            <select
              className="adb-input-method-select"
              value={textInputMethod}
              onChange={(e) => setTextInputMethod(e.target.value)}
            >
              <option value="adb">Raw ADB</option>
              <option value="keyboard">ADB Keyboard</option>
            </select>
          </div>
          <div className="adb-text-input">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Enter text to type on device"
              onKeyDown={(e) => e.key === 'Enter' && handleInputText()}
              disabled={loading}
            />
            <button
              className="btn-primary btn-small"
              onClick={handleInputText}
              disabled={loading || !textInput.trim()}
            >
              Send
            </button>
          </div>
        </div>

        {/* Status & Error Display */}
        {error && (
          <div className="adb-error">❌ {error}</div>
        )}
        {statusMsg && !error && (
          <div className="adb-status">{loading ? '⏳' : '✅'} {statusMsg}</div>
        )}

        {/* Operation Log */}
        <div className="adb-section">
          <div className="adb-section-header">
            <span>📋 Operation Log</span>
            <button
              className="btn-icon btn-small"
              onClick={() => setOperationLog([])}
              title="Clear log"
            >
              🗑️
            </button>
          </div>
          <div className="adb-log">
            {operationLog.length === 0 ? (
              <div className="adb-log-empty">No operations yet</div>
            ) : (
              operationLog.map((entry, i) => (
                <div key={i} className={`adb-log-entry adb-log-${entry.type}`}>
                  <span className="adb-log-time">{entry.time}</span>
                  <span className="adb-log-msg">{entry.msg}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
