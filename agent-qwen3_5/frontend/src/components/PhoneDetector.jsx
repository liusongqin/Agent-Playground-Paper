/**
 * PhoneDetector — Real-time phone object detection using multimodal models.
 *
 * Architecture (follows WorldSimulator pattern):
 *   PhoneDetectorProvider  — shared state via React context
 *   PhoneDetectorCanvas    — left editor area: dual phone screens (live + detection)
 *   PhoneDetectorInfo      — right function panel: controls, FPS, recording
 *
 * Backend streams frames via WebSocket (/ws/scrcpy/stream) using scrcpy/adb screencap.
 * Detection uses the same multimodal model + bbox parsing as ADB ASSISTANT.
 */

import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { parseBboxFromResponse } from '../services/adb';
import { sendChatRequest } from '../services/openai';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_ADB_URL = 'http://localhost:8080';
const ADB_URL_STORAGE_KEY = 'agent-chat-adb-url';
const DETECT_PROMPT_TEMPLATE = (target) => `图片上${target}的坐标`;

// Minimum interval between detection requests (ms)
const MIN_DETECT_INTERVAL_MS = 200;
// Max recorded frames to prevent memory exhaustion (~300 frames ≈ 30s at 10fps)
const MAX_RECORD_FRAMES = 300;

function loadAdbUrl() {
  try {
    return localStorage.getItem(ADB_URL_STORAGE_KEY) || DEFAULT_ADB_URL;
  } catch {
    return DEFAULT_ADB_URL;
  }
}

/** Derive WebSocket URL from HTTP base URL */
function wsUrlFromHttp(httpUrl) {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${u.origin}/ws/scrcpy/stream`;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
const PhoneDetectorContext = createContext(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function PhoneDetectorProvider({ children, settings }) {
  const [adbUrl] = useState(loadAdbUrl);

  // Streaming state
  const [streaming, setStreaming] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(null); // base64
  const [fps, setFps] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // disconnected | connecting | connected | error

  // Detection state
  const [targetText, setTargetText] = useState('');
  const [autoDetect, setAutoDetect] = useState(false);
  const [detectedFrame, setDetectedFrame] = useState(null); // base64 of frame used for detection
  const [detectedElements, setDetectedElements] = useState([]);
  const [detecting, setDetecting] = useState(false);
  const [detectFps, setDetectFps] = useState(0);
  const [error, setError] = useState('');

  // Recording state
  const [recording, setRecording] = useState(false);
  const [recordedFrames, setRecordedFrames] = useState([]);
  const [recordStartTime, setRecordStartTime] = useState(null);

  // Screen rotation
  const [screenRotation, setScreenRotation] = useState(0); // 0, 90, 180, 270

  // Refs
  const wsRef = useRef(null);
  const lastDetectTimeRef = useRef(0);
  const detectCountRef = useRef(0);
  const detectFpsTimerRef = useRef(null);
  const detectingRef = useRef(false);
  const streamingRef = useRef(false);
  const autoDetectRef = useRef(false);
  const targetTextRef = useRef('');
  const recordingRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);
  useEffect(() => { autoDetectRef.current = autoDetect; }, [autoDetect]);
  useEffect(() => { targetTextRef.current = targetText; }, [targetText]);
  useEffect(() => { recordingRef.current = recording; }, [recording]);

  // ------ Detection FPS counter ------
  useEffect(() => {
    detectFpsTimerRef.current = setInterval(() => {
      setDetectFps(detectCountRef.current);
      detectCountRef.current = 0;
    }, 1000);
    return () => clearInterval(detectFpsTimerRef.current);
  }, []);

  // ------ Run detection on a single frame ------
  const detectFrame = useCallback(async (frameBase64) => {
    const target = targetTextRef.current.trim();
    if (!target || !frameBase64 || !settings?.apiKey) return;

    // Prevent concurrent detection requests
    if (detectingRef.current) return;

    const now = Date.now();
    if (now - lastDetectTimeRef.current < MIN_DETECT_INTERVAL_MS) return;
    lastDetectTimeRef.current = now;

    detectingRef.current = true;
    setDetecting(true);
    setDetectedFrame(frameBase64);

    try {
      const messages = [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${frameBase64}` },
            },
            {
              type: 'text',
              text: DETECT_PROMPT_TEMPLATE(target),
            },
          ],
        },
      ];

      const detectSettings = {
        ...settings,
        temperature: 0.1,
        stream: false,
      };

      const result = await sendChatRequest(messages, detectSettings, () => {}, null);
      const responseContent = result.content || '';

      try {
        const elements = parseBboxFromResponse(responseContent);
        setDetectedElements(elements);
        detectCountRef.current += 1;
      } catch {
        setDetectedElements([]);
      }
    } catch (err) {
      setError(`Detection error: ${err.message}`);
    } finally {
      detectingRef.current = false;
      setDetecting(false);
    }
  }, [settings]);

  // ------ WebSocket streaming ------
  const startStream = useCallback(() => {
    if (wsRef.current) return;

    setConnectionStatus('connecting');
    setError('');

    const wsUrl = wsUrlFromHttp(adbUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionStatus('connected');
      setStreaming(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.error) {
          setError(data.error);
          return;
        }
        if (data.frame) {
          setCurrentFrame(data.frame);
          setFps(data.fps || 0);

          // Detect screen rotation from dimensions
          if (data.width && data.height) {
            const isLandscape = data.width > data.height;
            setScreenRotation(isLandscape ? 90 : 0);
          }

          // Auto-detect if enabled and not currently detecting
          if (autoDetectRef.current && targetTextRef.current.trim()) {
            detectFrame(data.frame);
          }

          // Record frame if recording (with frame limit)
          if (recordingRef.current) {
            setRecordedFrames((prev) => {
              if (prev.length >= MAX_RECORD_FRAMES) return prev;
              return [...prev, {
                frame: data.frame,
                timestamp: Date.now(),
              }];
            });
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      setConnectionStatus('error');
      setError('WebSocket connection error');
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
      setStreaming(false);
      wsRef.current = null;
    };
  }, [adbUrl, detectFrame]);

  const stopStream = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStreaming(false);
    setConnectionStatus('disconnected');
    setFps(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // ------ Manual detection (single shot) ------
  const detectOnce = useCallback(() => {
    if (currentFrame) {
      detectFrame(currentFrame);
    }
  }, [currentFrame, detectFrame]);

  // ------ Recording controls ------
  const startRecording = useCallback(() => {
    setRecordedFrames([]);
    setRecordStartTime(Date.now());
    setRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    setRecording(false);
    setRecordStartTime(null);
  }, []);

  const saveRecording = useCallback(() => {
    if (recordedFrames.length === 0) return;

    // Build a simple JSON-based recording file
    const recordingData = {
      frames: recordedFrames.map((f) => ({
        timestamp: f.timestamp,
        frame: f.frame,
      })),
      startTime: recordedFrames[0]?.timestamp,
      endTime: recordedFrames[recordedFrames.length - 1]?.timestamp,
      frameCount: recordedFrames.length,
    };

    const blob = new Blob([JSON.stringify(recordingData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `phone-recording-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [recordedFrames]);

  const clearRecording = useCallback(() => {
    setRecordedFrames([]);
    setRecordStartTime(null);
  }, []);

  // ------ Context value ------
  const value = useMemo(() => ({
    // Stream
    streaming,
    currentFrame,
    fps,
    connectionStatus,
    startStream,
    stopStream,
    screenRotation,

    // Detection
    targetText,
    setTargetText,
    autoDetect,
    setAutoDetect,
    detectedFrame,
    detectedElements,
    detecting,
    detectFps,
    detectOnce,

    // Recording
    recording,
    recordedFrames,
    recordStartTime,
    startRecording,
    stopRecording,
    saveRecording,
    clearRecording,

    // Error
    error,
    setError,
  }), [
    streaming, currentFrame, fps, connectionStatus, startStream, stopStream, screenRotation,
    targetText, autoDetect, detectedFrame, detectedElements, detecting, detectFps, detectOnce,
    recording, recordedFrames, recordStartTime, startRecording, stopRecording, saveRecording, clearRecording,
    error,
  ]);

  return (
    <PhoneDetectorContext.Provider value={value}>
      {children}
    </PhoneDetectorContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Canvas — dual phone screens (left area)
// ---------------------------------------------------------------------------
export function PhoneDetectorCanvas() {
  const ctx = useContext(PhoneDetectorContext);
  if (!ctx) return null;

  const {
    currentFrame,
    detectedFrame,
    detectedElements,
    streaming,
    connectionStatus,
    screenRotation,
    fps,
    detectFps,
    detecting,
  } = ctx;

  const isLandscape = screenRotation === 90 || screenRotation === 270;

  return (
    <div className={`phone-detector-canvas ${isLandscape ? 'landscape' : 'portrait'}`}>
      {/* Live Screen */}
      <div className="phone-screen-container">
        <div className="phone-screen-label">
          <span className="phone-screen-dot live" />
          实时画面
          {streaming && <span className="phone-screen-fps">{fps.toFixed(1)} FPS</span>}
        </div>
        <div className={`phone-screen ${isLandscape ? 'landscape' : ''}`}>
          {currentFrame ? (
            <img
              src={`data:image/png;base64,${currentFrame}`}
              alt="Live phone screen"
              draggable={false}
            />
          ) : (
            <div className="phone-screen-placeholder">
              {connectionStatus === 'connecting' ? (
                <span>⏳ 连接中...</span>
              ) : connectionStatus === 'error' ? (
                <span>❌ 连接失败</span>
              ) : (
                <span>📱 点击右侧&quot;开始串流&quot;连接设备</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Detection Screen */}
      <div className="phone-screen-container">
        <div className="phone-screen-label">
          <span className={`phone-screen-dot ${detecting ? 'detecting' : 'detect'}`} />
          检测结果
          {detectFps > 0 && <span className="phone-screen-fps">{detectFps} 检测/s</span>}
        </div>
        <div className={`phone-screen ${isLandscape ? 'landscape' : ''}`}>
          {detectedFrame ? (
            <div className="phone-screen-detect-wrap">
              <img
                src={`data:image/png;base64,${detectedFrame}`}
                alt="Detection result"
                draggable={false}
              />
              {/* Bbox overlays */}
              {detectedElements.length > 0 && (
                <div className="phone-detect-overlay">
                  {detectedElements.map((el, i) => {
                    const left = (el.x1 / 1000) * 100;
                    const top = (el.y1 / 1000) * 100;
                    const width = ((el.x2 - el.x1) / 1000) * 100;
                    const height = ((el.y2 - el.y1) / 1000) * 100;
                    return (
                      <div
                        key={i}
                        className="phone-detect-bbox"
                        style={{
                          left: `${left}%`,
                          top: `${top}%`,
                          width: `${width}%`,
                          height: `${height}%`,
                        }}
                      >
                        <span className="phone-detect-bbox-label">{el.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="phone-screen-placeholder">
              <span>🔍 等待检测结果...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Info — right panel controls
// ---------------------------------------------------------------------------
export function PhoneDetectorInfo() {
  const ctx = useContext(PhoneDetectorContext);

  const [recordDuration, setRecordDuration] = useState(0);

  const recording = ctx?.recording;
  const recordStartTime = ctx?.recordStartTime;

  useEffect(() => {
    if (!recording || !recordStartTime) {
      return;
    }
    const timer = setInterval(() => {
      setRecordDuration(Math.round((Date.now() - recordStartTime) / 1000));
    }, 500);
    return () => clearInterval(timer);
  }, [recording, recordStartTime]);

  if (!ctx) return null;

  const {
    streaming,
    connectionStatus,
    fps,
    startStream,
    stopStream,

    targetText,
    setTargetText,
    autoDetect,
    setAutoDetect,
    detectedElements,
    detecting,
    detectFps,
    detectOnce,

    recordedFrames,
    startRecording,
    stopRecording,
    saveRecording,
    clearRecording,

    error,
    setError,
  } = ctx;

  return (
    <div className="phone-detector-info">
      <h3 className="phone-detector-title">🎯 实时目标检测</h3>

      {/* Connection & Stream */}
      <section className="phone-detector-section">
        <div className="phone-detector-section-title">📡 设备串流</div>
        <div className="phone-detector-row">
          <span className={`phone-detector-status ${connectionStatus}`}>
            {connectionStatus === 'connected' ? '🟢 已连接' :
             connectionStatus === 'connecting' ? '🟡 连接中' :
             connectionStatus === 'error' ? '🔴 错误' :
             '⚪ 未连接'}
          </span>
        </div>
        <div className="phone-detector-row">
          {!streaming ? (
            <button
              className="phone-detector-btn primary"
              onClick={startStream}
              disabled={connectionStatus === 'connecting'}
            >
              ▶ 开始串流
            </button>
          ) : (
            <button
              className="phone-detector-btn danger"
              onClick={stopStream}
            >
              ⏹ 停止串流
            </button>
          )}
        </div>
        {streaming && (
          <div className="phone-detector-stats">
            <span>📊 帧率: <strong>{fps.toFixed(1)}</strong> FPS</span>
          </div>
        )}
      </section>

      {/* Detection target */}
      <section className="phone-detector-section">
        <div className="phone-detector-section-title">🔍 目标检测</div>
        <div className="phone-detector-input-group">
          <input
            type="text"
            className="phone-detector-input"
            placeholder="输入检测目标，如：所有按钮、文字..."
            value={targetText}
            onChange={(e) => setTargetText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !autoDetect) detectOnce();
            }}
          />
        </div>
        <div className="phone-detector-row">
          <button
            className="phone-detector-btn"
            onClick={detectOnce}
            disabled={!targetText.trim() || detecting || !streaming}
          >
            {detecting ? '⏳ 检测中...' : '🔍 单次检测'}
          </button>
          <label className="phone-detector-toggle">
            <input
              type="checkbox"
              checked={autoDetect}
              onChange={(e) => setAutoDetect(e.target.checked)}
              disabled={!streaming}
            />
            <span>自动检测</span>
          </label>
        </div>
        {(detecting || detectFps > 0) && (
          <div className="phone-detector-stats">
            <span>🎯 检测帧率: <strong>{detectFps}</strong> 次/秒</span>
            {detecting && <span className="phone-detector-detecting-dot">检测中</span>}
          </div>
        )}
      </section>

      {/* Detection results */}
      {detectedElements.length > 0 && (
        <section className="phone-detector-section">
          <div className="phone-detector-section-title">
            📋 检测结果 ({detectedElements.length})
          </div>
          <div className="phone-detector-results">
            {detectedElements.map((el, i) => (
              <div key={i} className="phone-detector-result-item">
                <span className="phone-detector-result-index">{i}</span>
                <div className="phone-detector-result-info">
                  <span className="phone-detector-result-label">{el.label}</span>
                  <span className="phone-detector-result-coords">
                    bbox({el.x1},{el.y1},{el.x2},{el.y2})
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recording */}
      <section className="phone-detector-section">
        <div className="phone-detector-section-title">🎬 视频录制</div>
        <div className="phone-detector-row">
          {!recording ? (
            <button
              className="phone-detector-btn record"
              onClick={startRecording}
              disabled={!streaming}
            >
              ⏺ 开始录制
            </button>
          ) : (
            <button
              className="phone-detector-btn danger"
              onClick={stopRecording}
            >
              ⏹ 停止录制 ({recordDuration}s)
            </button>
          )}
        </div>
        {recordedFrames.length > 0 && !recording && (
          <div className="phone-detector-row">
            <button className="phone-detector-btn" onClick={saveRecording}>
              💾 保存录制 ({recordedFrames.length} 帧)
            </button>
            <button className="phone-detector-btn danger-text" onClick={clearRecording}>
              🗑 清除
            </button>
          </div>
        )}
        {recording && (
          <div className="phone-detector-stats">
            <span>📹 已录制: <strong>{recordedFrames.length}</strong> 帧</span>
          </div>
        )}
      </section>

      {/* Error display */}
      {error && (
        <div className="phone-detector-error">
          <span>❌ {error}</span>
          <button className="phone-detector-btn-small" onClick={() => setError('')}>✕</button>
        </div>
      )}
    </div>
  );
}

export default { PhoneDetectorProvider, PhoneDetectorCanvas, PhoneDetectorInfo };
