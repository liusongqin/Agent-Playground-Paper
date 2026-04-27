/**
 * AutoLabeler — Automated screenshot + AI labeling tool (YOLO format).
 *
 * Architecture:
 *   AutoLabelerProvider   — shared state via React context
 *   AutoLabelerPanel      — left sidebar: image directory tree
 *   AutoLabelerWorkspace  — center: interactive bbox editing, right sidebar: settings & controls
 *
 * Three automation flows:
 *   1. Single mode: take one screenshot → model analyze → show results
 *   2. Gallery mode: screenshot → model analyze → auto swipe left → repeat
 *   3. Stream mode: continuous screenshot from video stream → model analyze
 *
 * Each user prompt triggers one model analysis round (prompt sent as-is).
 * Model-returned labels are used as annotation class names (not user input).
 * Annotations are saved in YOLO format: class_id cx cy w h (normalized 0-1).
 * Users can specify a custom save directory on their computer.
 * Users can define a detection region (ROI) before starting gallery/stream.
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
import { parseBboxFromResponse, adbScreenshot, adbSwipe } from '../services/adb';
import { sendChatRequest } from '../services/openai';

// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------
const DEFAULT_ADB_URL = 'http://localhost:8080';
const ADB_URL_STORAGE_KEY = 'agent-chat-adb-url';
const MAX_LOG_ENTRIES = 100;
// Detection prompt is now sent as-is (user controls the full prompt text)
const EDGE_HIT_THRESHOLD_PX = 8;
const MIN_BBOX_SIZE = 20;       // minimum bbox size in 0-1000 space for drawing/resizing
const MIN_CROP_SIZE = 50;       // minimum crop region size in 0-1000 space
const MIN_ANNOTATION_THRESHOLD = 10; // minimum annotation dimension after crop remap
const MIN_ZOOM_LEVEL = 0.5;
const MAX_ZOOM_LEVEL = 5.0;
const MAX_UNDO_HISTORY = 50;
const CLICK_MOVE_THRESHOLD = 3;  // pixels of movement to distinguish click from drag
const REVIEWED_IMAGES_STORAGE_KEY = 'auto-labeler-reviewed-images';

function loadAdbUrl() {
  try {
    return localStorage.getItem(ADB_URL_STORAGE_KEY) || DEFAULT_ADB_URL;
  } catch {
    return DEFAULT_ADB_URL;
  }
}

function getApiUrl(baseUrl, path) {
  return `${(baseUrl || DEFAULT_ADB_URL).replace(/\/+$/, '')}${path}`;
}

function wsUrlFromHttp(httpUrl) {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${u.origin}/ws/scrcpy/stream`;
}

function compressImage(base64Data, maxWidth = 1920, quality = 0.8) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = Math.round((h * maxWidth) / w);
        w = maxWidth;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const b64 = dataUrl.split(',')[1];
      resolve(b64);
    };
    img.onerror = () => resolve(base64Data);
    img.src = `data:image/png;base64,${base64Data}`;
  });
}

/** Crop a base64 image to a region (0-1000 normalized coords). Returns base64 string. */
function cropFrameToRegion(base64Data, region) {
  return new Promise((resolve) => {
    if (!region) { resolve(base64Data); return; }
    const img = new Image();
    img.onload = () => {
      const sx = Math.round((region.x1 / 1000) * img.width);
      const sy = Math.round((region.y1 / 1000) * img.height);
      const sw = Math.round(((region.x2 - region.x1) / 1000) * img.width);
      const sh = Math.round(((region.y2 - region.y1) / 1000) * img.height);
      if (sw < 10 || sh < 10) { resolve(base64Data); return; }
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const b64 = canvas.toDataURL('image/png').split(',')[1];
      resolve(b64);
    };
    img.onerror = () => resolve(base64Data);
    img.src = `data:image/png;base64,${base64Data}`;
  });
}

/** Hit-test a point against an annotation's edges, corners, or interior. */
function hitTestAnnotation(mx, my, ann, threshX, threshY) {
  const x1 = ann.x1 ?? ann.bbox?.[0] ?? 0;
  const y1 = ann.y1 ?? ann.bbox?.[1] ?? 0;
  const x2 = ann.x2 ?? ann.bbox?.[2] ?? 0;
  const y2 = ann.y2 ?? ann.bbox?.[3] ?? 0;
  const nearLeft = Math.abs(mx - x1) < threshX;
  const nearRight = Math.abs(mx - x2) < threshX;
  const nearTop = Math.abs(my - y1) < threshY;
  const nearBottom = Math.abs(my - y2) < threshY;
  const inX = mx >= x1 - threshX && mx <= x2 + threshX;
  const inY = my >= y1 - threshY && my <= y2 + threshY;
  if (nearLeft && nearTop) return 'top-left';
  if (nearRight && nearTop) return 'top-right';
  if (nearLeft && nearBottom) return 'bottom-left';
  if (nearRight && nearBottom) return 'bottom-right';
  if (nearTop && inX) return 'top';
  if (nearBottom && inX) return 'bottom';
  if (nearLeft && inY) return 'left';
  if (nearRight && inY) return 'right';
  if (mx >= x1 && mx <= x2 && my >= y1 && my <= y2) return 'inside';
  return null;
}

function getCursorForHit(hit) {
  switch (hit) {
    case 'top-left': case 'bottom-right': return 'nwse-resize';
    case 'top-right': case 'bottom-left': return 'nesw-resize';
    case 'top': case 'bottom': return 'ns-resize';
    case 'left': case 'right': return 'ew-resize';
    case 'inside': return 'move';
    default: return 'crosshair';
  }
}

/** Extract the network image from a phone screenshot.
 *  Structure top→bottom: notification bar, COLOR BLOCK, image, COLOR BLOCK, browser bar.
 *  We find the two colored bands and crop the content between them.
 *  @param {string} base64Image — base64 encoded image
 *  @param {{ r: number, g: number, b: number } | null} bandColor — target band color (default: black {r:0,g:0,b:0})
 *  @param {number} colorThreshold — max distance from bandColor to count as "band" (default: 30)
 */
function extractNetworkImage(base64Image, bandColor = null, colorThreshold = 30) {
  const targetR = bandColor?.r ?? 0;
  const targetG = bandColor?.g ?? 0;
  const targetB = bandColor?.b ?? 0;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, img.width, img.height);
      const { data, width, height } = imgData;

      // Calculate average color distance from target for a row
      const rowColorDistance = (row) => {
        let sum = 0;
        const offset = row * width * 4;
        for (let x = 0; x < width; x++) {
          const idx = offset + x * 4;
          const dr = data[idx] - targetR;
          const dg = data[idx + 1] - targetG;
          const db = data[idx + 2] - targetB;
          sum += Math.sqrt(dr * dr + dg * dg + db * db);
        }
        return sum / width;
      };

      const MATCH_THRESHOLD = colorThreshold;
      const MIN_BAND_HEIGHT = 5;

      // Mark each row as matching the target band color
      const isMatch = [];
      for (let y = 0; y < height; y++) {
        isMatch.push(rowColorDistance(y) < MATCH_THRESHOLD);
      }

      // Find contiguous matching bands (minimum MIN_BAND_HEIGHT pixels tall)
      const bands = [];
      let bandStart = -1;
      for (let y = 0; y < height; y++) {
        if (isMatch[y]) {
          if (bandStart === -1) bandStart = y;
        } else {
          if (bandStart !== -1 && y - bandStart >= MIN_BAND_HEIGHT) {
            bands.push({ start: bandStart, end: y - 1 });
          }
          bandStart = -1;
        }
      }
      if (bandStart !== -1 && height - bandStart >= MIN_BAND_HEIGHT) {
        bands.push({ start: bandStart, end: height - 1 });
      }

      let topRow = 0;
      let bottomRow = height - 1;

      if (bands.length >= 2) {
        // Image is between the first and last band
        topRow = bands[0].end + 1;
        bottomRow = bands[bands.length - 1].start - 1;
      } else {
        // Fallback: use a looser threshold and trim from edges
        const FALLBACK_THRESHOLD = colorThreshold * 2;
        for (let y = 0; y < height; y++) {
          if (rowColorDistance(y) >= FALLBACK_THRESHOLD) { topRow = y; break; }
        }
        for (let y = height - 1; y >= 0; y--) {
          if (rowColorDistance(y) >= FALLBACK_THRESHOLD) { bottomRow = y; break; }
        }
      }

      if (bottomRow - topRow < 10) { resolve(null); return; }

      const cropH = bottomRow - topRow + 1;
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = width;
      cropCanvas.height = cropH;
      const cctx = cropCanvas.getContext('2d');
      cctx.drawImage(img, 0, topRow, width, cropH, 0, 0, width, cropH);
      const croppedB64 = cropCanvas.toDataURL('image/png').split(',')[1];
      resolve(croppedB64);
    };
    img.onerror = () => resolve(null);
    img.src = `data:image/png;base64,${base64Image}`;
  });
}

/** Pick color from a pixel in a base64 image at given normalized coordinates (0-1000). */
function pickColorFromImage(base64Image, normX, normY) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const px = Math.round((normX / 1000) * img.width);
      const py = Math.round((normY / 1000) * img.height);
      const pixel = ctx.getImageData(
        Math.max(0, Math.min(px, img.width - 1)),
        Math.max(0, Math.min(py, img.height - 1)),
        1, 1
      ).data;
      resolve({ r: pixel[0], g: pixel[1], b: pixel[2] });
    };
    img.onerror = () => resolve({ r: 0, g: 0, b: 0 });
    img.src = `data:image/png;base64,${base64Image}`;
  });
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
const AutoLabelerContext = createContext(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function AutoLabelerProvider({ children, settings }) {
  const [adbUrl] = useState(loadAdbUrl);

  // Mode: 'single' | 'gallery' | 'stream'
  const [mode, setMode] = useState('single');

  // Automation state
  const [running, setRunning] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(null);
  const [currentAnnotations, setCurrentAnnotations] = useState([]);
  const [processedCount, setProcessedCount] = useState(0);
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [log, setLog] = useState([]);

  // Multi-prompt input (list-based)
  const [promptsList, setPromptsList] = useState([]);

  // Swipe delay (ms)
  const [swipeDelay, setSwipeDelay] = useState(2000);

  // Save path
  const [savePath, setSavePath] = useState('');

  // Saved images list
  const [savedImages, setSavedImages] = useState([]);

  // Saved classes from classes.txt (ordered list, index = class id)
  const [savedClasses, setSavedClasses] = useState([]);

  // Workspace state
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedAnnotations, setSelectedAnnotations] = useState([]);
  const [editingLabel, setEditingLabel] = useState(null);

  // Interactive editing state
  const [hoveredAnnotation, setHoveredAnnotation] = useState(null);
  const [imageData, setImageData] = useState(null);

  // Error
  const [error, setError] = useState('');

  // Image extraction toggle for gallery mode
  const [enableImageExtraction, setEnableImageExtraction] = useState(false);

  // Extraction band color for network image extraction (null = default black)
  const [extractionColor, setExtractionColor] = useState(null);

  // Reviewed/approved images set (persisted in localStorage)
  const [reviewedImages, setReviewedImages] = useState(() => {
    try {
      const saved = localStorage.getItem(REVIEWED_IMAGES_STORAGE_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  const toggleReviewed = useCallback((filename) => {
    setReviewedImages((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      try { localStorage.setItem(REVIEWED_IMAGES_STORAGE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Detection region (ROI) for gallery/stream mode — null means full frame
  // Format: { x1, y1, x2, y2 } in 0-1000 normalized space
  const [detectionRegion, setDetectionRegion] = useState(null);

  // Stream mode state
  const [streaming, setStreaming] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [fps, setFps] = useState(0);
  const [screenRotation, setScreenRotation] = useState(0);

  // Refs
  const runningRef = useRef(false);
  const wsRef = useRef(null);
  const streamFrameRef = useRef(null);
  const loadSavedImagesRef = useRef(null);

  useEffect(() => { runningRef.current = running; }, [running]);

  const prompts = useMemo(() => promptsList.filter(Boolean), [promptsList]);

  // Load save path from backend on mount
  useEffect(() => {
    fetch(getApiUrl(adbUrl, '/api/label/get-path'))
      .then((r) => r.json())
      .then((d) => { if (d.path) setSavePath(d.path); })
      .catch(() => {});
  }, [adbUrl]);

  const addLog = useCallback((msg) => {
    const time = new Date().toLocaleTimeString();
    setLog((prev) => [...prev.slice(-(MAX_LOG_ENTRIES - 1)), `[${time}] ${msg}`]);
  }, []);

  // ---------- Save image to backend ----------
  const saveImageToBackend = useCallback(async (imageB64, annotations, filename, overwrite = false) => {
    try {
      const compressed = await compressImage(imageB64);
      const resp = await fetch(getApiUrl(adbUrl, '/api/label/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: compressed,
          annotations,
          filename: filename || '',
          overwrite,
        }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      addLog(`💾 保存成功: ${data.filename} (${(data.size / 1024).toFixed(1)}KB)`);
      loadSavedImagesRef.current?.();
      return data;
    } catch (err) {
      addLog(`❌ 保存失败: ${err.message}`);
      throw err;
    }
  }, [adbUrl, addLog]);

  // ---------- Detect with model ----------
  const detectWithModel = useCallback(async (frameBase64, targetPrompt) => {
    if (!settings?.apiKey || !frameBase64 || !targetPrompt) return [];

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
              text: targetPrompt,
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
        return elements;
      } catch {
        return [];
      }
    } catch (err) {
      addLog(`❌ 检测错误: ${err.message}`);
      return [];
    }
  }, [settings, addLog]);

  // ---------- Take screenshot ----------
  const takeScreenshot = useCallback(async () => {
    try {
      const imageB64 = await adbScreenshot(adbUrl);
      return imageB64;
    } catch (err) {
      addLog(`❌ 截图失败: ${err.message}`);
      return null;
    }
  }, [adbUrl, addLog]);

  // ---------- Perform swipe left ----------
  const performSwipeLeft = useCallback(async () => {
    try {
      const resp = await fetch(getApiUrl(adbUrl, '/api/adb/screen-size'));
      const data = await resp.json();
      const w = data.width || 1080;
      const h = data.height || 1920;
      await adbSwipe(
        Math.round(w * 0.75), Math.round(h * 0.5),
        Math.round(w * 0.25), Math.round(h * 0.5),
        300, adbUrl
      );
      addLog('👈 左滑完成');
    } catch (err) {
      addLog(`❌ 滑动失败: ${err.message}`);
    }
  }, [adbUrl, addLog]);

  // ---------- Single screenshot detection ----------
  const runSingleDetect = useCallback(async () => {
    if (prompts.length === 0) {
      setError('请输入至少一个检测提示词');
      return;
    }

    setRunning(true);
    setProcessedCount(0);
    addLog('📸 单张检测：正在截图...');

    const frame = await takeScreenshot();
    if (!frame) {
      setRunning(false);
      return;
    }

    setCurrentFrame(frame);
    let allAnnotations = [];

    for (const prompt of prompts) {
      setCurrentPrompt(prompt);
      addLog(`🔍 检测提示词: ${prompt}`);
      const detected = await detectWithModel(frame, prompt);
      if (detected.length > 0) {
        allAnnotations = [...allAnnotations, ...detected];
        addLog(`  ✅ 发现 ${detected.length} 个目标`);
      } else {
        addLog(`  ⚪ 未发现目标`);
      }
    }

    setCurrentAnnotations(allAnnotations);

    if (allAnnotations.length > 0) {
      try {
        await saveImageToBackend(frame, allAnnotations);
      } catch {
        // logged in saveImageToBackend
      }
    }

    setProcessedCount(1);
    setRunning(false);
    setCurrentPrompt('');
    addLog(`✅ 单张检测完成，发现 ${allAnnotations.length} 个目标`);
  }, [prompts, takeScreenshot, detectWithModel, saveImageToBackend, addLog]);

  // ---------- Gallery automation flow ----------
  const runGalleryFlow = useCallback(async () => {
    if (prompts.length === 0) {
      setError('请输入至少一个检测提示词');
      return;
    }

    runningRef.current = true;
    setRunning(true);
    setProcessedCount(0);
    addLog('🚀 开始图库自动标注...');
    if (detectionRegion) addLog(`📐 检测区域: (${detectionRegion.x1},${detectionRegion.y1})-(${detectionRegion.x2},${detectionRegion.y2})`);

    let count = 0;
    while (runningRef.current) {
      addLog('📸 正在截图...');
      const frame = await takeScreenshot();
      if (!frame || !runningRef.current) break;

      setCurrentFrame(frame);

      // Crop to detection region first if defined
      let analysisFrame = frame;
      if (detectionRegion) {
        analysisFrame = await cropFrameToRegion(analysisFrame, detectionRegion);
      }

      // Optionally extract network image from the (possibly cropped) frame
      if (enableImageExtraction) {
        addLog('🔍 尝试从区域图片提取网络图片...');
        const extracted = await extractNetworkImage(analysisFrame, extractionColor);
        if (extracted) {
          analysisFrame = extracted;
          addLog('  ✅ 图片提取成功');
        } else {
          addLog('  ⚠️ 提取失败，使用当前帧');
        }
      }

      // Keep the original frame in workspace preview (detection region is shown as overlay)

      let allAnnotations = [];

      for (const prompt of prompts) {
        if (!runningRef.current) break;
        setCurrentPrompt(prompt);
        addLog(`🔍 检测提示词: ${prompt}`);
        const detected = await detectWithModel(analysisFrame, prompt);
        if (detected.length > 0) {
          allAnnotations = [...allAnnotations, ...detected];
          addLog(`  ✅ 发现 ${detected.length} 个目标`);
        } else {
          addLog(`  ⚪ 未发现目标`);
        }
      }

      setCurrentAnnotations(allAnnotations);

      if (allAnnotations.length > 0) {
        try {
          await saveImageToBackend(analysisFrame, allAnnotations);
        } catch {
          // logged in saveImageToBackend
        }
      }

      count++;
      setProcessedCount(count);

      if (!runningRef.current) break;

      addLog(`⏳ 等待 ${swipeDelay / 1000}s 后左滑...`);
      await new Promise((r) => setTimeout(r, swipeDelay));
      if (!runningRef.current) break;

      await performSwipeLeft();
      await new Promise((r) => setTimeout(r, 500));
    }

    setRunning(false);
    setCurrentPrompt('');
    addLog(`✅ 图库标注结束，共处理 ${count} 张图片`);
  }, [prompts, swipeDelay, enableImageExtraction, extractionColor, detectionRegion, takeScreenshot, detectWithModel, saveImageToBackend, performSwipeLeft, addLog]);

  // ---------- Stream mode: WebSocket + continuous detection ----------
  const startStreamFlow = useCallback(() => {
    if (prompts.length === 0) {
      setError('请输入至少一个检测提示词');
      return;
    }

    setConnectionStatus('connecting');
    setError('');
    runningRef.current = true;
    setRunning(true);
    setProcessedCount(0);
    addLog('🚀 开始实时流标注...');
    if (detectionRegion) addLog(`📐 检测区域: (${detectionRegion.x1},${detectionRegion.y1})-(${detectionRegion.x2},${detectionRegion.y2})`);

    const wsUrl = wsUrlFromHttp(adbUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    let detectBusy = false;
    // Snapshot region at start so changes during streaming don't affect in-flight detections
    const regionSnapshot = detectionRegion;

    ws.onopen = () => {
      setConnectionStatus('connected');
      setStreaming(true);
      addLog('📡 串流已连接');
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.error) {
          setError(data.error);
          return;
        }
        if (data.frame) {
          setCurrentFrame(data.frame);
          setFps(data.fps || 0);
          streamFrameRef.current = data.frame;

          if (data.width && data.height) {
            setScreenRotation(data.width > data.height ? 90 : 0);
          }

          if (!detectBusy && runningRef.current) {
            detectBusy = true;
            let frame = data.frame;

            // Crop to detection region if defined
            if (regionSnapshot) {
              frame = await cropFrameToRegion(frame, regionSnapshot);
            }

            let allAnnotations = [];

            for (const prompt of prompts) {
              if (!runningRef.current) break;
              setCurrentPrompt(prompt);
              const detected = await detectWithModel(frame, prompt);
              if (detected.length > 0) {
                allAnnotations = [...allAnnotations, ...detected];
              }
            }

            setCurrentAnnotations(allAnnotations);

            if (allAnnotations.length > 0 && runningRef.current) {
              try {
                await saveImageToBackend(frame, allAnnotations);
                setProcessedCount((c) => c + 1);
              } catch {
                // logged
              }
            }

            setCurrentPrompt('');
            detectBusy = false;
          }
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {
      setConnectionStatus('error');
      setError('WebSocket连接错误');
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
      setStreaming(false);
      wsRef.current = null;
      setRunning(false);
      runningRef.current = false;
      addLog('📡 串流已断开');
    };
  }, [adbUrl, prompts, detectionRegion, detectWithModel, saveImageToBackend, addLog]);

  // ---------- Stop automation ----------
  const stopAutomation = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    setCurrentPrompt('');
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStreaming(false);
    setConnectionStatus('disconnected');
    addLog('⏹ 自动化已停止');
  }, [addLog]);

  // ---------- Load saved images ----------
  const loadSavedImages = useCallback(async () => {
    try {
      const resp = await fetch(getApiUrl(adbUrl, '/api/label/list'));
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setSavedImages(data.items || []);
      if (data.classes) setSavedClasses(data.classes);
    } catch (err) {
      addLog(`❌ 加载图片列表失败: ${err.message}`);
    }
  }, [adbUrl, addLog]);
  loadSavedImagesRef.current = loadSavedImages;

  // ---------- Load single image ----------
  const loadImage = useCallback(async (filename) => {
    try {
      const resp = await fetch(getApiUrl(adbUrl, `/api/label/image?filename=${encodeURIComponent(filename)}`));
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return data;
    } catch (err) {
      addLog(`❌ 加载图片失败: ${err.message}`);
      return null;
    }
  }, [adbUrl, addLog]);

  // Load image data when selected image changes
  const selectedFilename = selectedImage?.filename;
  useEffect(() => {
    if (!selectedFilename) {
      setImageData(null);
      return;
    }
    let cancelled = false;
    loadImage(selectedFilename).then((data) => {
      if (!cancelled && data) {
        setImageData(data);
      }
    });
    return () => { cancelled = true; };
  }, [selectedFilename, loadImage]);

  // Sync annotations when selectedImage changes
  useEffect(() => {
    if (selectedImage) {
      setSelectedAnnotations(selectedImage.annotations || []);
    }
  }, [selectedImage]);

  // ---------- Auto-save annotations when switching images ----------
  const prevImageRef = useRef(null);
  const pendingAnnotationsRef = useRef(null);

  // Keep pendingAnnotationsRef in sync with selectedAnnotations
  useEffect(() => {
    pendingAnnotationsRef.current = selectedAnnotations;
  }, [selectedAnnotations]);

  const selectImage = useCallback((newImg) => {
    const prevImage = prevImageRef.current;
    const pendingAnns = pendingAnnotationsRef.current;
    // Auto-save if we have a previous image with possibly modified annotations
    if (prevImage && pendingAnns) {
      const origAnns = prevImage.annotations || [];
      const changed = JSON.stringify(pendingAnns) !== JSON.stringify(origAnns);
      if (changed) {
        // Fire-and-forget save (non-blocking)
        fetch(getApiUrl(adbUrl, '/api/label/update'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: prevImage.filename, annotations: pendingAnns }),
        })
          .then((r) => {
            if (r.ok) {
              addLog(`💾 自动保存: ${prevImage.filename}`);
              loadSavedImagesRef.current?.();
            }
          })
          .catch(() => {
            addLog(`⚠️ 自动保存失败: ${prevImage.filename}`);
          });
      }
    }
    prevImageRef.current = newImg;
    setSelectedImage(newImg);
  }, [adbUrl, addLog]);

  // ---------- Update annotations ----------
  const updateAnnotations = useCallback(async (filename, annotations) => {
    try {
      const resp = await fetch(getApiUrl(adbUrl, '/api/label/update'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, annotations }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      addLog(`✅ 标注已更新: ${filename}`);
      await loadSavedImages();
    } catch (err) {
      addLog(`❌ 更新失败: ${err.message}`);
    }
  }, [adbUrl, addLog, loadSavedImages]);

  // ---------- Delete image (single or batch) ----------
  const deleteImage = useCallback(async (filename) => {
    try {
      const resp = await fetch(getApiUrl(adbUrl, '/api/label/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      addLog(`🗑 已删除: ${filename}`);
      if (selectedImage?.filename === filename) {
        setSelectedImage(null);
        setSelectedAnnotations([]);
        setImageData(null);
      }
      await loadSavedImages();
    } catch (err) {
      addLog(`❌ 删除失败: ${err.message}`);
    }
  }, [adbUrl, addLog, loadSavedImages, selectedImage]);

  const batchDeleteImages = useCallback(async (filenames) => {
    if (!filenames || filenames.length === 0) return;
    try {
      const resp = await fetch(getApiUrl(adbUrl, '/api/label/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      addLog(`🗑 批量删除完成: ${data.deleted?.length || 0} 张图片`);
      if (data.errors?.length > 0) {
        addLog(`⚠️ ${data.errors.length} 个文件删除失败`);
      }
      if (selectedImage && filenames.includes(selectedImage.filename)) {
        setSelectedImage(null);
        setSelectedAnnotations([]);
        setImageData(null);
      }
      await loadSavedImages();
    } catch (err) {
      addLog(`❌ 批量删除失败: ${err.message}`);
    }
  }, [adbUrl, addLog, loadSavedImages, selectedImage]);

  // ---------- Rename category across all annotations ----------
  const renameCategory = useCallback(async (oldLabel, newLabel) => {
    if (!oldLabel || !newLabel || oldLabel === newLabel) return;
    let updatedCount = 0;
    for (const img of savedImages) {
      const anns = img.annotations || [];
      const hasLabel = anns.some((a) => a.label === oldLabel);
      if (!hasLabel) continue;
      const newAnns = anns.map((a) => a.label === oldLabel ? { ...a, label: newLabel } : a);
      try {
        await fetch(getApiUrl(adbUrl, '/api/label/update'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: img.filename, annotations: newAnns }),
        });
        updatedCount++;
      } catch (err) {
        addLog(`⚠️ 类别重命名失败 (${img.filename}): ${err.message}`);
      }
    }
    addLog(`✅ 类别重命名完成: "${oldLabel}" → "${newLabel}" (${updatedCount} 张图片已更新)`);
    // Update currently selected annotations if applicable
    if (selectedImage) {
      setSelectedAnnotations((prev) =>
        prev.map((a) => a.label === oldLabel ? { ...a, label: newLabel } : a)
      );
    }
    await loadSavedImages();
  }, [adbUrl, savedImages, selectedImage, addLog, loadSavedImages]);

  // ---------- Update save path ----------
  const updateSavePath = useCallback(async (newPath) => {
    try {
      const resp = await fetch(getApiUrl(adbUrl, '/api/label/set-path'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setSavePath(data.path || newPath);
      addLog(`📁 保存路径已更新: ${data.path || newPath}`);
      await loadSavedImages();
    } catch (err) {
      addLog(`❌ 设置路径失败: ${err.message}`);
    }
  }, [adbUrl, addLog, loadSavedImages]);

  // ---------- Add annotation ----------
  const addAnnotation = useCallback((annotation) => {
    setSelectedAnnotations((prev) => [...prev, annotation]);
  }, []);

  // ---------- Apply crop (overwrite or save-as) ----------
  const applyCrop = useCallback(async (cropBox, saveMode = 'overwrite') => {
    const imgBase64 = selectedImage ? (imageData?.image || null) : currentFrame;
    const contentType = selectedImage
      ? (imageData?.content_type || 'image/png')
      : 'image/png';
    if (!imgBase64) return false;
    if (!selectedImage) {
      addLog('❌ 裁剪仅在选择了保存的图片时可用');
      return false;
    }

    const { x1, y1, x2, y2 } = cropBox;
    const cropW = x2 - x1;
    const cropH = y2 - y1;

    const img = new Image();
    img.src = `data:${contentType};base64,${imgBase64}`;
    await new Promise((r) => { img.onload = r; });

    const sx = Math.round((x1 / 1000) * img.width);
    const sy = Math.round((y1 / 1000) * img.height);
    const sw = Math.round((cropW / 1000) * img.width);
    const sh = Math.round((cropH / 1000) * img.height);

    if (sw < 10 || sh < 10) return false;

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const cctx = canvas.getContext('2d');
    cctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const croppedB64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];

    // Remap annotations from original 0-1000 space to cropped 0-1000 space
    // Clamp annotation coords to crop region first, then remap
    const croppedAnnotations = selectedAnnotations
      .map((ann) => {
        const ax1 = ann.x1 ?? ann.bbox?.[0] ?? 0;
        const ay1 = ann.y1 ?? ann.bbox?.[1] ?? 0;
        const ax2 = ann.x2 ?? ann.bbox?.[2] ?? 0;
        const ay2 = ann.y2 ?? ann.bbox?.[3] ?? 0;
        // Clamp to crop region before remapping
        const cx1 = Math.max(ax1, x1);
        const cy1 = Math.max(ay1, y1);
        const cx2 = Math.min(ax2, x2);
        const cy2 = Math.min(ay2, y2);
        // Skip if annotation doesn't overlap crop region
        if (cx1 >= cx2 || cy1 >= cy2) return null;
        // Remap to 0-1000 in cropped space
        const nx1 = Math.round(((cx1 - x1) / cropW) * 1000);
        const ny1 = Math.round(((cy1 - y1) / cropH) * 1000);
        const nx2 = Math.round(((cx2 - x1) / cropW) * 1000);
        const ny2 = Math.round(((cy2 - y1) / cropH) * 1000);
        if (nx2 - nx1 < MIN_ANNOTATION_THRESHOLD || ny2 - ny1 < MIN_ANNOTATION_THRESHOLD) return null;
        return { ...ann, bbox: [nx1, ny1, nx2, ny2], x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
      })
      .filter(Boolean);

    try {
      const isOverwrite = saveMode === 'overwrite';
      const filename = isOverwrite ? selectedImage.filename : '';
      await saveImageToBackend(croppedB64, croppedAnnotations, filename, isOverwrite);
      if (isOverwrite) {
        setSelectedAnnotations(croppedAnnotations);
        addLog(`✂️ 裁剪覆盖成功: ${selectedImage.filename}`);
        const newData = await loadImage(selectedImage.filename);
        if (newData) setImageData(newData);
      } else {
        addLog(`✂️ 裁剪另存成功`);
      }
      await loadSavedImages();
      return true;
    } catch (err) {
      addLog(`❌ 裁剪失败: ${err.message}`);
      return false;
    }
  }, [selectedImage, imageData, currentFrame, selectedAnnotations, saveImageToBackend, addLog, loadSavedImages, loadImage]);

  // Cleanup
  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  const value = useMemo(() => ({
    mode, setMode,
    running, stopAutomation,
    currentFrame, setCurrentFrame, currentAnnotations, currentPrompt,
    processedCount,
    promptsList, setPromptsList, prompts,
    swipeDelay, setSwipeDelay,
    savePath, updateSavePath,
    log, addLog,
    error, setError,
    enableImageExtraction, setEnableImageExtraction,
    extractionColor, setExtractionColor,
    reviewedImages, toggleReviewed,
    detectionRegion, setDetectionRegion,
    streaming, connectionStatus, fps, screenRotation,
    runSingleDetect, runGalleryFlow, startStreamFlow,
    takeScreenshot, detectWithModel,
    saveImageToBackend,
    savedImages, savedClasses, loadSavedImages, loadImage,
    selectedImage, setSelectedImage: selectImage,
    selectedAnnotations, setSelectedAnnotations,
    editingLabel, setEditingLabel,
    updateAnnotations, deleteImage, batchDeleteImages, renameCategory,
    hoveredAnnotation, setHoveredAnnotation,
    imageData, setImageData,
    addAnnotation,
    applyCrop,
  }), [
    mode, running, currentFrame, setCurrentFrame, currentAnnotations, currentPrompt,
    processedCount, promptsList, prompts, swipeDelay, savePath, log, addLog, error,
    enableImageExtraction, extractionColor, reviewedImages, toggleReviewed,
    detectionRegion,
    streaming, connectionStatus, fps, screenRotation,
    runSingleDetect, runGalleryFlow, startStreamFlow, stopAutomation,
    takeScreenshot, detectWithModel, saveImageToBackend, updateSavePath,
    savedImages, savedClasses, loadSavedImages, loadImage,
    selectedImage, selectedAnnotations, editingLabel,
    updateAnnotations, deleteImage, batchDeleteImages, renameCategory, selectImage,
    hoveredAnnotation, imageData,
    addAnnotation, applyCrop,
  ]);

  return (
    <AutoLabelerContext.Provider value={value}>
      {children}
    </AutoLabelerContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// ConfirmDialog — modal overlay for delete confirmation
// ---------------------------------------------------------------------------
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="auto-labeler-dialog-overlay" onClick={onCancel}>
      <div className="auto-labeler-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="auto-labeler-dialog-message">{message}</div>
        <div className="auto-labeler-dialog-buttons">
          <button className="auto-labeler-btn danger" onClick={onConfirm}>确认删除</button>
          <button className="auto-labeler-btn" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LabelInputDialog — custom dialog replacing window.prompt for label input
// Supports typing new label or selecting from existing labels
// ---------------------------------------------------------------------------
function LabelInputDialog({ defaultValue, existingLabels, onConfirm, onCancel }) {
  const inputRef = useRef(null);
  const [value, setValue] = useState(defaultValue || '');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleConfirm = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <div className="auto-labeler-dialog-overlay" onClick={onCancel}>
      <div className="auto-labeler-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="auto-labeler-dialog-message">输入标注标签:</div>
        <input
          ref={inputRef}
          className="auto-labeler-dialog-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleConfirm();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="输入新标签或从下方选择..."
        />
        {existingLabels && existingLabels.length > 0 && (
          <div className="auto-labeler-existing-labels">
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>已有标签（点击选择）:</div>
            <div className="auto-labeler-label-chips">
              {existingLabels.map((label) => (
                <span
                  key={label}
                  className={`auto-labeler-label-chip${value === label ? ' active' : ''}`}
                  onClick={() => setValue(label)}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="auto-labeler-dialog-buttons">
          <button className="auto-labeler-btn primary" onClick={handleConfirm}>确定</button>
          <button className="auto-labeler-btn" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CropConfirmDialog — custom dialog for crop: save-as or overwrite
// ---------------------------------------------------------------------------
function CropConfirmDialog({ onSaveAs, onOverwrite, onCancel }) {
  return (
    <div className="auto-labeler-dialog-overlay" onClick={onCancel}>
      <div className="auto-labeler-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="auto-labeler-dialog-message">确认裁剪：请选择保存方式</div>
        <div className="auto-labeler-dialog-buttons" style={{ flexDirection: 'column', gap: '8px' }}>
          <button className="auto-labeler-btn primary" style={{ width: '100%' }} onClick={onSaveAs}>
            📄 另存为新文件
          </button>
          <button className="auto-labeler-btn danger" style={{ width: '100%' }} onClick={onOverwrite}>
            ♻️ 覆盖原文件
          </button>
          <button className="auto-labeler-btn" style={{ width: '100%' }} onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel — left sidebar: image directory tree
// ---------------------------------------------------------------------------
const VIRTUAL_ITEM_HEIGHT = 32; // px per image list item
const VIRTUAL_OVERSCAN_ITEMS = 10;    // extra items to render above/below viewport

export function AutoLabelerPanel() {
  const ctx = useContext(AutoLabelerContext);
  const loadSavedImagesFn = ctx?.loadSavedImages;
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [selectedSet, setSelectedSet] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [renamingCategory, setRenamingCategory] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // Virtual scroll state
  const scrollContainerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  useEffect(() => {
    if (loadSavedImagesFn) loadSavedImagesFn();
  }, [loadSavedImagesFn]);

  // Track scroll and container resize for virtual scrolling
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  // Compute category stats from all saved images (must be before conditional return)
  const categoryStats = useMemo(() => {
    const images = ctx?.savedImages || [];
    const stats = {};
    for (const img of images) {
      for (const ann of (img.annotations || [])) {
        const label = ann.label || 'unknown';
        stats[label] = (stats[label] || 0) + 1;
      }
    }
    return Object.entries(stats).sort((a, b) => b[1] - a[1]);
  }, [ctx?.savedImages]);

  // Build a map from label name to class index in classes.txt
  const classIndexMap = useMemo(() => {
    const map = {};
    const classes = ctx?.savedClasses;
    if (classes) {
      classes.forEach((cls, idx) => { map[cls] = idx; });
    }
    return map;
  }, [ctx?.savedClasses]);

  if (!ctx) return null;

  const { savePath, savedImages, loadSavedImages, selectedImage, setSelectedImage, deleteImage, batchDeleteImages, reviewedImages, toggleReviewed, renameCategory } = ctx;

  // Toggle selection for an image
  const toggleSelect = (filename) => {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedSet(new Set(savedImages.map((img) => img.filename)));
  };

  const deselectAll = () => {
    setSelectedSet(new Set());
  };

  const toggleSelectMode = () => {
    if (selectMode) deselectAll();
    setSelectMode(!selectMode);
  };

  const handleBatchDelete = () => {
    if (selectedSet.size > 0) setConfirmBatchDelete(true);
  };

  const executeBatchDelete = async () => {
    setConfirmBatchDelete(false);
    if (batchDeleteImages) {
      await batchDeleteImages([...selectedSet]);
    }
    setSelectedSet(new Set());
    setSelectMode(false);
  };

  const startRename = (label) => {
    setRenamingCategory(label);
    setRenameValue(label);
  };

  const executeRename = async () => {
    if (renameCategory && renamingCategory && renameValue.trim() && renameValue.trim() !== renamingCategory) {
      await renameCategory(renamingCategory, renameValue.trim());
    }
    setRenamingCategory(null);
    setRenameValue('');
  };

  // Virtual scroll calculations
  const totalItems = savedImages.length;
  const totalHeight = totalItems * VIRTUAL_ITEM_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / VIRTUAL_ITEM_HEIGHT) - VIRTUAL_OVERSCAN_ITEMS);
  const endIdx = Math.min(totalItems, Math.ceil((scrollTop + containerHeight) / VIRTUAL_ITEM_HEIGHT) + VIRTUAL_OVERSCAN_ITEMS);
  const visibleImages = savedImages.slice(startIdx, endIdx);
  const offsetTop = startIdx * VIRTUAL_ITEM_HEIGHT;

  return (
    <div className="auto-labeler-panel">
      <h3 className="auto-labeler-title">🏷️ 图片目录</h3>

      {savePath && (
        <div className="auto-labeler-path-current" title={savePath}>
          📁 {savePath}
        </div>
      )}

      {/* Category stats collapsible section */}
      <section className="auto-labeler-section" style={{ padding: '4px 10px' }}>
        <div
          className="auto-labeler-section-title"
          style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
          onClick={() => setCategoriesExpanded(!categoriesExpanded)}
        >
          <span style={{ fontSize: 10, transition: 'transform 0.2s', transform: categoriesExpanded ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
          📂 类别 ({categoryStats.length})
        </div>
        {categoriesExpanded && (
          <div className="auto-labeler-category-list">
            {categoryStats.length === 0 ? (
              <div style={{ fontSize: 11, color: '#888', padding: '4px 0' }}>暂无类别</div>
            ) : (
              categoryStats.map(([label, count]) => {
                const classIdx = classIndexMap[label];
                return (
                  <div key={label} className="auto-labeler-category-item">
                    {classIdx !== undefined && (
                      <span className="auto-labeler-category-id" title={`classes.txt 编号: ${classIdx}`}>
                        {classIdx}
                      </span>
                    )}
                    {renamingCategory === label ? (
                      <input
                        className="auto-labeler-ann-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') executeRename();
                          if (e.key === 'Escape') setRenamingCategory(null);
                        }}
                        onBlur={executeRename}
                        autoFocus
                        style={{ flex: 1, fontSize: 11 }}
                      />
                    ) : (
                      <span
                        className="auto-labeler-category-name"
                        onClick={() => startRename(label)}
                        title="点击重命名类别"
                      >
                        {label}
                      </span>
                    )}
                    <span className="auto-labeler-category-count">{count}</span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>

      <section className="auto-labeler-section" style={{ padding: '6px 10px' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className="auto-labeler-btn"
            onClick={loadSavedImages}
            style={{ flex: 1 }}
          >
            🔄 刷新
          </button>
          <button
            className={`auto-labeler-btn${selectMode ? ' active' : ''}`}
            onClick={toggleSelectMode}
            title={selectMode ? '退出多选' : '多选模式'}
          >
            {selectMode ? '✕ 退出多选' : '☑ 多选'}
          </button>
        </div>
        {selectMode && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <button className="auto-labeler-btn" onClick={selectAll} style={{ flex: 1, fontSize: 11 }}>
              全选 ({savedImages.length})
            </button>
            <button className="auto-labeler-btn" onClick={deselectAll} style={{ flex: 1, fontSize: 11 }}>
              取消全选
            </button>
            <button
              className="auto-labeler-btn danger"
              onClick={handleBatchDelete}
              disabled={selectedSet.size === 0}
              style={{ flex: 1, fontSize: 11 }}
            >
              🗑 删除 ({selectedSet.size})
            </button>
          </div>
        )}
      </section>

      <div className="auto-labeler-image-items" ref={scrollContainerRef} style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ position: 'absolute', top: offsetTop, left: 0, right: 0 }}>
            {visibleImages.map((img, vi) => {
              const i = startIdx + vi;
              const isReviewed = reviewedImages?.has(img.filename);
              const isSelected = selectedSet.has(img.filename);
              return (
                <div
                  key={img.filename}
                  className={`auto-labeler-image-item${selectedImage?.filename === img.filename ? ' active' : ''}${isReviewed ? ' reviewed' : ''}`}
                  onClick={() => { if (selectMode) { toggleSelect(img.filename); } setSelectedImage(img); }}
                  style={{
                    height: VIRTUAL_ITEM_HEIGHT,
                    ...(selectedImage?.filename === img.filename ? { backgroundColor: '#094771' } : {}),
                    ...(isSelected && selectMode ? { backgroundColor: 'rgba(9,71,113,0.5)' } : {}),
                  }}
                >
                  {selectMode && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => { toggleSelect(img.filename); setSelectedImage(img); }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ flexShrink: 0, cursor: 'pointer' }}
                    />
                  )}
                  {!selectMode && (
                    <button
                      className="auto-labeler-btn-small auto-labeler-review-btn"
                      onClick={(e) => { e.stopPropagation(); toggleReviewed(img.filename); }}
                      title={isReviewed ? '取消审核标记' : '标记为已审核'}
                      style={{ color: isReviewed ? '#4caf50' : '#555', flexShrink: 0, fontSize: '14px' }}
                    >
                      {isReviewed ? '✅' : '⬜'}
                    </button>
                  )}
                  <span className="auto-labeler-image-number">{i + 1}.</span>
                  <span
                    className="auto-labeler-image-name"
                    style={isReviewed ? { color: '#4caf50' } : undefined}
                    onClick={selectMode ? (e) => { e.stopPropagation(); setSelectedImage(img); } : undefined}
                    title={selectMode ? '点击查看图片' : undefined}
                  >
                    {img.filename}
                  </span>
                  <span className="auto-labeler-image-meta">
                    {img.annotations?.length || 0} 标注
                  </span>
                  {!selectMode && (
                    <button
                      className="auto-labeler-btn-small auto-labeler-image-delete"
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(img.filename); }}
                      title="删除图片"
                    >
                      🗑
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {savedImages.length === 0 && (
          <div className="auto-labeler-image-empty">
            暂无保存的图片
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          message={`确定删除图片 "${confirmDelete}" 吗？`}
          onConfirm={() => { deleteImage(confirmDelete); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmBatchDelete && (
        <ConfirmDialog
          message={`确定删除选中的 ${selectedSet.size} 张图片吗？`}
          onConfirm={executeBatchDelete}
          onCancel={() => setConfirmBatchDelete(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crop overlay (unchanged)
// ---------------------------------------------------------------------------
function MobileCropOverlay({ cropBox, onCropChange, imageRect }) {
  const HANDLE_SIZE = 20;
  const dragRef = useRef(null);

  const handlePointerDown = (edge, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startBox = { ...cropBox };

    const onMove = (ev) => {
      if (!imageRect) return;
      const dx = ((ev.clientX - startX) / imageRect.width) * 1000;
      const dy = ((ev.clientY - startY) / imageRect.height) * 1000;
      const newBox = { ...startBox };
      const MIN_SIZE = MIN_CROP_SIZE;

      if (edge.includes('left')) newBox.x1 = Math.max(0, Math.min(startBox.x1 + dx, startBox.x2 - MIN_SIZE));
      if (edge.includes('right')) newBox.x2 = Math.min(1000, Math.max(startBox.x2 + dx, startBox.x1 + MIN_SIZE));
      if (edge.includes('top')) newBox.y1 = Math.max(0, Math.min(startBox.y1 + dy, startBox.y2 - MIN_SIZE));
      if (edge.includes('bottom')) newBox.y2 = Math.min(1000, Math.max(startBox.y2 + dy, startBox.y1 + MIN_SIZE));

      onCropChange(newBox);
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const left = (cropBox.x1 / 1000) * 100;
  const top = (cropBox.y1 / 1000) * 100;
  const width = ((cropBox.x2 - cropBox.x1) / 1000) * 100;
  const height = ((cropBox.y2 - cropBox.y1) / 1000) * 100;

  const edges = [
    { name: 'top', style: { left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${HANDLE_SIZE}px`, cursor: 'n-resize', transform: 'translateY(-50%)' } },
    { name: 'bottom', style: { left: `${left}%`, top: `${top + height}%`, width: `${width}%`, height: `${HANDLE_SIZE}px`, cursor: 's-resize', transform: 'translateY(-50%)' } },
    { name: 'left', style: { left: `${left}%`, top: `${top}%`, width: `${HANDLE_SIZE}px`, height: `${height}%`, cursor: 'w-resize', transform: 'translateX(-50%)' } },
    { name: 'right', style: { left: `${left + width}%`, top: `${top}%`, width: `${HANDLE_SIZE}px`, height: `${height}%`, cursor: 'e-resize', transform: 'translateX(-50%)' } },
    { name: 'top-left', style: { left: `${left}%`, top: `${top}%`, width: `${HANDLE_SIZE}px`, height: `${HANDLE_SIZE}px`, cursor: 'nw-resize', transform: 'translate(-50%,-50%)' } },
    { name: 'top-right', style: { left: `${left + width}%`, top: `${top}%`, width: `${HANDLE_SIZE}px`, height: `${HANDLE_SIZE}px`, cursor: 'ne-resize', transform: 'translate(-50%,-50%)' } },
    { name: 'bottom-left', style: { left: `${left}%`, top: `${top + height}%`, width: `${HANDLE_SIZE}px`, height: `${HANDLE_SIZE}px`, cursor: 'sw-resize', transform: 'translate(-50%,-50%)' } },
    { name: 'bottom-right', style: { left: `${left + width}%`, top: `${top + height}%`, width: `${HANDLE_SIZE}px`, height: `${HANDLE_SIZE}px`, cursor: 'se-resize', transform: 'translate(-50%,-50%)' } },
  ];

  return (
    <div className="mobile-crop-overlay" ref={dragRef}>
      <div className="mobile-crop-dim mobile-crop-dim-top" style={{ height: `${top}%` }} />
      <div className="mobile-crop-dim mobile-crop-dim-bottom" style={{ top: `${top + height}%`, height: `${100 - top - height}%` }} />
      <div className="mobile-crop-dim mobile-crop-dim-left" style={{ top: `${top}%`, height: `${height}%`, width: `${left}%` }} />
      <div className="mobile-crop-dim mobile-crop-dim-right" style={{ top: `${top}%`, height: `${height}%`, left: `${left + width}%`, width: `${100 - left - width}%` }} />
      <div className="mobile-crop-border" style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }} />
      {edges.map((e) => (
        <div
          key={e.name}
          className={`mobile-crop-handle ${e.name.includes('-') ? 'corner' : 'edge'}`}
          style={{ ...e.style, position: 'absolute', zIndex: 10 }}
          onPointerDown={(ev) => handlePointerDown(e.name, ev)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace — center editor + right sidebar (settings & annotations)
// ---------------------------------------------------------------------------
export function AutoLabelerWorkspace() {
  const ctx = useContext(AutoLabelerContext);
  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const interactionRef = useRef(null);
  const [cropMode, setCropMode] = useState(false);
  const [cropBox, setCropBox] = useState(null);
  const [cropClickState, setCropClickState] = useState(null); // null | { x1, y1 } — waiting for second click
  const [imageRect, setImageRect] = useState(null);
  const [drawingBox, setDrawingBox] = useState(null);
  const [pathInput, setPathInput] = useState('');
  const [promptInput, setPromptInput] = useState('');
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [annotationHistory, setAnnotationHistory] = useState([]);
  const [labelDialogState, setLabelDialogState] = useState(null);
  const [cropConfirmDialog, setCropConfirmDialog] = useState(false);
  const [regionSelectMode, setRegionSelectMode] = useState(false);
  const [regionBox, setRegionBox] = useState({ x1: 100, y1: 100, x2: 900, y2: 900 });
  const [regionScreenshotLoading, setRegionScreenshotLoading] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [colorPickMode, setColorPickMode] = useState(false);
  const [annListCollapsed, setAnnListCollapsed] = useState(false);
  const isPanningRef = useRef(false);

  const mode = ctx?.mode;
  const setMode = ctx?.setMode;
  const running = ctx?.running;
  const stopAutomation = ctx?.stopAutomation;
  const currentFrame = ctx?.currentFrame;
  const setCurrentFrame = ctx?.setCurrentFrame;
  const currentAnnotations = ctx?.currentAnnotations || [];
  const currentPrompt = ctx?.currentPrompt;
  const processedCount = ctx?.processedCount;
  const promptsList = ctx?.promptsList || [];
  const setPromptsList = ctx?.setPromptsList;
  const prompts = ctx?.prompts || [];
  const swipeDelay = ctx?.swipeDelay;
  const setSwipeDelay = ctx?.setSwipeDelay;
  const savePath = ctx?.savePath;
  const updateSavePath = ctx?.updateSavePath;
  const log = ctx?.log || [];
  const addLog = ctx?.addLog;
  const error = ctx?.error;
  const setError = ctx?.setError;
  const enableImageExtraction = ctx?.enableImageExtraction;
  const setEnableImageExtraction = ctx?.setEnableImageExtraction;
  const extractionColor = ctx?.extractionColor;
  const setExtractionColor = ctx?.setExtractionColor;
  const detectionRegion = ctx?.detectionRegion;
  const setDetectionRegion = ctx?.setDetectionRegion;
  const streaming = ctx?.streaming;
  const connectionStatus = ctx?.connectionStatus;
  const fps = ctx?.fps;
  const takeScreenshot = ctx?.takeScreenshot;
  const runSingleDetect = ctx?.runSingleDetect;
  const runGalleryFlow = ctx?.runGalleryFlow;
  const startStreamFlow = ctx?.startStreamFlow;
  const selectedImage = ctx?.selectedImage;
  const setSelectedImage = ctx?.setSelectedImage;
  const ctxSelectedAnnotations = ctx?.selectedAnnotations;
  const selectedAnnotations = useMemo(() => ctxSelectedAnnotations || [], [ctxSelectedAnnotations]);
  const setSelectedAnnotations = ctx?.setSelectedAnnotations;
  const editingLabel = ctx?.editingLabel;
  const setEditingLabel = ctx?.setEditingLabel;
  const updateAnnotations = ctx?.updateAnnotations;
  const hoveredAnnotation = ctx?.hoveredAnnotation;
  const setHoveredAnnotation = ctx?.setHoveredAnnotation;
  const imageData = ctx?.imageData;
  const addAnnotation = ctx?.addAnnotation;
  const applyCropFn = ctx?.applyCrop;

  // Compute unique existing labels from savedClasses + all annotation labels
  const existingLabels = useMemo(() => {
    const classes = ctx?.savedClasses || [];
    const images = ctx?.savedImages || [];
    const labelSet = new Set(classes);
    for (const img of images) {
      for (const ann of (img.annotations || [])) {
        if (ann.label) labelSet.add(ann.label);
      }
    }
    return [...labelSet];
  }, [ctx?.savedClasses, ctx?.savedImages]);

  // Track image element dimensions
  useEffect(() => {
    const img = imageRef.current;
    if (!img) return;
    const updateRect = () => {
      const r = img.getBoundingClientRect();
      setImageRect({ width: r.width, height: r.height });
    };
    img.addEventListener('load', updateRect);
    const ro = new ResizeObserver(updateRect);
    ro.observe(img);
    return () => {
      img.removeEventListener('load', updateRect);
      ro.disconnect();
    };
  }, [selectedImage, currentFrame]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        setAnnotationHistory((prev) => {
          if (prev.length === 0) return prev;
          const newHistory = [...prev];
          const lastState = newHistory.pop();
          setSelectedAnnotations(lastState);
          return newHistory;
        });
      }
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (selectedImage && updateAnnotations) {
          updateAnnotations(selectedImage.filename, selectedAnnotations);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedImage, updateAnnotations, selectedAnnotations, setSelectedAnnotations]);

  if (!ctx) return null;

  // ---- Push annotation history for undo ----
  const pushAnnotationHistory = () => {
    setAnnotationHistory((prev) => [...prev.slice(-(MAX_UNDO_HISTORY - 1)), [...selectedAnnotations]]);
  };

  const handleUndo = () => {
    setAnnotationHistory((prev) => {
      if (prev.length === 0) return prev;
      const newHistory = [...prev];
      const lastState = newHistory.pop();
      setSelectedAnnotations(lastState);
      return newHistory;
    });
  };

  // ---- Prompt list management ----
  const addPrompt = () => {
    const trimmed = promptInput.trim();
    if (trimmed && !promptsList.includes(trimmed)) {
      setPromptsList([...promptsList, trimmed]);
      setPromptInput('');
    }
  };

  const removePrompt = (index) => {
    setPromptsList(promptsList.filter((_, i) => i !== index));
  };

  // Effective display data
  const effectiveImageData = selectedImage ? imageData : null;
  const displayFrame = selectedImage ? (effectiveImageData?.image || null) : currentFrame;
  const displayAnnotations = selectedImage ? selectedAnnotations : currentAnnotations;
  const displayContentType = selectedImage
    ? (effectiveImageData?.content_type || 'image/png')
    : 'image/png';

  // ---- Zoom wheel handler ----
  const handleWheel = (e) => {
    e.preventDefault();
    const scale = Math.min(Math.abs(e.deltaY) / 100, 1);
    const delta = (e.deltaY > 0 ? -0.1 : 0.1) * Math.max(scale, 0.5);
    setZoomLevel((prev) => Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, prev + delta)));
  };

  // ---- Middle-click pan handler ----
  const handleMiddleMouseDown = (e) => {
    if (e.button !== 1) return; // Only middle click
    e.preventDefault();
    isPanningRef.current = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const startPan = { ...panOffset };

    const onMove = (ev) => {
      setPanOffset({
        x: startPan.x + (ev.clientX - startX),
        y: startPan.y + (ev.clientY - startY),
      });
    };

    const onUp = () => {
      isPanningRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const resetView = () => {
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
  };

  // ---- Interactive bbox editing: pointer handlers ----
  const handlePointerDown = (e) => {
    // Skip left-click interaction during middle-button pan
    if (isPanningRef.current) return;
    if (e.button === 1) return; // Ignore middle click in pointer handler

    // Color pick mode: pick color from the clicked pixel
    if (colorPickMode && currentFrame) {
      const img = imageRef.current;
      if (!img) return;
      const r = img.getBoundingClientRect();
      const normX = ((e.clientX - r.left) / r.width) * 1000;
      const normY = ((e.clientY - r.top) / r.height) * 1000;
      e.preventDefault();
      pickColorFromImage(currentFrame, normX, normY).then((color) => {
        setExtractionColor(color);
        setColorPickMode(false);
        addLog?.(`🎨 已选取颜色: rgb(${color.r}, ${color.g}, ${color.b})`);
      });
      return;
    }

    if (!selectedImage) return;

    const img = imageRef.current;
    if (!img) return;

    const getCoords = (ev) => {
      const r = img.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * 1000;
      const y = ((ev.clientY - r.top) / r.height) * 1000;
      return {
        x: Math.max(0, Math.min(1000, x)),
        y: Math.max(0, Math.min(1000, y)),
      };
    };

    // Handle two-click crop mode
    if (cropMode) {
      const coords = getCoords(e);
      e.preventDefault();
      if (!cropClickState) {
        // First click: set top-left corner
        setCropClickState({ x1: coords.x, y1: coords.y });
        setCropBox(null);
      } else {
        // Second click: set bottom-right corner and form crop box
        const x1 = Math.min(cropClickState.x1, coords.x);
        const y1 = Math.min(cropClickState.y1, coords.y);
        const x2 = Math.max(cropClickState.x1, coords.x);
        const y2 = Math.max(cropClickState.y1, coords.y);
        if (x2 - x1 >= MIN_CROP_SIZE && y2 - y1 >= MIN_CROP_SIZE) {
          setCropBox({ x1, y1, x2, y2 });
        }
        setCropClickState(null);
      }
      return;
    }

    const coords = getCoords(e);

    // Hit test against current annotations
    const r = img.getBoundingClientRect();
    const threshX = (EDGE_HIT_THRESHOLD_PX / r.width) * 1000;
    const threshY = (EDGE_HIT_THRESHOLD_PX / r.height) * 1000;

    let hitResult = null;
    for (let i = displayAnnotations.length - 1; i >= 0; i--) {
      const hit = hitTestAnnotation(coords.x, coords.y, displayAnnotations[i], threshX, threshY);
      if (hit) {
        hitResult = { annIdx: i, hit };
        break;
      }
    }

    let currentDrawingBox = null;

    if (hitResult) {
      pushAnnotationHistory();
      const ann = displayAnnotations[hitResult.annIdx];
      const origBox = {
        x1: ann.x1 ?? ann.bbox?.[0] ?? 0,
        y1: ann.y1 ?? ann.bbox?.[1] ?? 0,
        x2: ann.x2 ?? ann.bbox?.[2] ?? 0,
        y2: ann.y2 ?? ann.bbox?.[3] ?? 0,
      };

      if (hitResult.hit === 'inside') {
        interactionRef.current = {
          type: 'move', annIdx: hitResult.annIdx,
          startX: coords.x, startY: coords.y, origBox,
        };
      } else {
        interactionRef.current = {
          type: 'resize', annIdx: hitResult.annIdx, edge: hitResult.hit,
          startX: coords.x, startY: coords.y, origBox,
        };
      }
    } else {
      currentDrawingBox = { x1: coords.x, y1: coords.y, x2: coords.x, y2: coords.y };
      interactionRef.current = { type: 'draw', startX: coords.x, startY: coords.y };
      setDrawingBox(currentDrawingBox);
    }

    e.preventDefault();

    let hasMoved = false;

    const onMove = (ev) => {
      const c = getCoords(ev);
      const interaction = interactionRef.current;
      if (!interaction) return;

      const dx = Math.abs(c.x - interaction.startX);
      const dy = Math.abs(c.y - interaction.startY);
      if (dx > CLICK_MOVE_THRESHOLD || dy > CLICK_MOVE_THRESHOLD) hasMoved = true;

      if (interaction.type === 'draw') {
        currentDrawingBox = {
          x1: Math.min(interaction.startX, c.x),
          y1: Math.min(interaction.startY, c.y),
          x2: Math.max(interaction.startX, c.x),
          y2: Math.max(interaction.startY, c.y),
        };
        setDrawingBox(currentDrawingBox);
      } else if (interaction.type === 'move') {
        const dx = c.x - interaction.startX;
        const dy = c.y - interaction.startY;
        const { origBox, annIdx } = interaction;
        const boxW = origBox.x2 - origBox.x1;
        const boxH = origBox.y2 - origBox.y1;
        const nx1 = Math.max(0, Math.min(1000 - boxW, origBox.x1 + dx));
        const ny1 = Math.max(0, Math.min(1000 - boxH, origBox.y1 + dy));
        setSelectedAnnotations((prev) => {
          const newAnns = [...prev];
          newAnns[annIdx] = {
            ...newAnns[annIdx],
            x1: nx1, y1: ny1, x2: nx1 + boxW, y2: ny1 + boxH,
            bbox: [nx1, ny1, nx1 + boxW, ny1 + boxH],
          };
          return newAnns;
        });
      } else if (interaction.type === 'resize') {
        const { origBox, edge, annIdx } = interaction;
        const dx = c.x - interaction.startX;
        const dy = c.y - interaction.startY;
        const newBox = { ...origBox };
        const MIN_SIZE = MIN_BBOX_SIZE;
        if (edge.includes('left')) newBox.x1 = Math.max(0, Math.min(origBox.x1 + dx, origBox.x2 - MIN_SIZE));
        if (edge.includes('right')) newBox.x2 = Math.min(1000, Math.max(origBox.x2 + dx, origBox.x1 + MIN_SIZE));
        if (edge.includes('top')) newBox.y1 = Math.max(0, Math.min(origBox.y1 + dy, origBox.y2 - MIN_SIZE));
        if (edge.includes('bottom')) newBox.y2 = Math.min(1000, Math.max(origBox.y2 + dy, origBox.y1 + MIN_SIZE));
        setSelectedAnnotations((prev) => {
          const newAnns = [...prev];
          newAnns[annIdx] = {
            ...newAnns[annIdx],
            x1: newBox.x1, y1: newBox.y1, x2: newBox.x2, y2: newBox.y2,
            bbox: [newBox.x1, newBox.y1, newBox.x2, newBox.y2],
          };
          return newAnns;
        });
      }
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);

      const interaction = interactionRef.current;
      interactionRef.current = null;

      if (interaction?.type === 'draw' && currentDrawingBox) {
        const w = currentDrawingBox.x2 - currentDrawingBox.x1;
        const h = currentDrawingBox.y2 - currentDrawingBox.y1;
        if (w > MIN_BBOX_SIZE && h > MIN_BBOX_SIZE) {
          const box = { ...currentDrawingBox };
          setLabelDialogState({
            defaultValue: '',
            onConfirm: (label) => {
              if (label && addAnnotation) {
                pushAnnotationHistory();
                addAnnotation({
                  label,
                  bbox: [box.x1, box.y1, box.x2, box.y2],
                  x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2,
                });
              }
              setLabelDialogState(null);
            },
          });
        }
        setDrawingBox(null);
      } else if ((interaction?.type === 'move' || interaction?.type === 'resize') && !hasMoved) {
        // Click without drag on existing annotation — open label edit dialog
        const annIdx = interaction.annIdx;
        const ann = selectedAnnotations[annIdx];
        if (ann) {
          setLabelDialogState({
            defaultValue: ann.label || '',
            onConfirm: (newLabel) => {
              if (newLabel) {
                pushAnnotationHistory();
                setSelectedAnnotations((prev) => {
                  const newAnns = [...prev];
                  newAnns[annIdx] = { ...newAnns[annIdx], label: newLabel };
                  return newAnns;
                });
              }
              setLabelDialogState(null);
            },
          });
        }
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  // Cursor management on hover
  const handleMouseMove = (e) => {
    if (cropMode || !selectedImage || interactionRef.current) return;
    const img = imageRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 1000;
    const my = ((e.clientY - rect.top) / rect.height) * 1000;
    const threshX = (EDGE_HIT_THRESHOLD_PX / rect.width) * 1000;
    const threshY = (EDGE_HIT_THRESHOLD_PX / rect.height) * 1000;
    let cursor = 'crosshair';
    for (let i = displayAnnotations.length - 1; i >= 0; i--) {
      const hit = hitTestAnnotation(mx, my, displayAnnotations[i], threshX, threshY);
      if (hit) {
        cursor = getCursorForHit(hit);
        break;
      }
    }
    if (containerRef.current) {
      containerRef.current.style.cursor = cursor;
    }
  };

  // ---- Annotation actions ----
  const removeAnnotation = (idx) => {
    pushAnnotationHistory();
    setSelectedAnnotations(selectedAnnotations.filter((_, i) => i !== idx));
  };

  const updateLabel = (idx, newLabel) => {
    const newAnns = [...selectedAnnotations];
    newAnns[idx] = { ...newAnns[idx], label: newLabel };
    setSelectedAnnotations(newAnns);
    setEditingLabel(null);
  };

  const saveAnnotationEdits = async () => {
    if (selectedImage && updateAnnotations) {
      await updateAnnotations(selectedImage.filename, selectedAnnotations);
    }
  };

  const handleApplyCrop = () => {
    setCropConfirmDialog(true);
  };

  const handleCropSaveAs = async () => {
    setCropConfirmDialog(false);
    if (applyCropFn) {
      const success = await applyCropFn(cropBox, 'saveAs');
      if (success) {
        setCropMode(false);
        setCropBox(null);
        setCropClickState(null);
      }
    }
  };

  const handleCropOverwrite = async () => {
    setCropConfirmDialog(false);
    if (applyCropFn) {
      const success = await applyCropFn(cropBox, 'overwrite');
      if (success) {
        setCropMode(false);
        setCropBox(null);
        setCropClickState(null);
      }
    }
  };

  const startAutomation = () => {
    if (mode === 'single') {
      runSingleDetect();
    } else if (mode === 'gallery') {
      runGalleryFlow();
    } else {
      startStreamFlow();
    }
  };

  const handleToggleRegionSelect = async () => {
    if (regionSelectMode) {
      // Confirm: set the detection region
      const confirmedRegion = { ...regionBox };
      setDetectionRegion(confirmedRegion);
      setRegionSelectMode(false);

      // If extract network image is enabled, crop and extract from the region
      if (enableImageExtraction && currentFrame) {
        addLog?.('🔍 正在对已划定区域进行网络图片提取...');
        const cropped = await cropFrameToRegion(currentFrame, confirmedRegion);
        if (cropped && cropped !== currentFrame) {
          const extracted = await extractNetworkImage(cropped, extractionColor);
          if (extracted) {
            setCurrentFrame?.(extracted);
            addLog?.('  ✅ 区域图片提取成功');
          } else {
            addLog?.('  ⚠️ 区域图片提取失败，使用裁剪后的区域图');
            setCurrentFrame?.(cropped);
          }
        }
      }
    } else {
      // Enter region select mode: take a fresh screenshot from the phone
      // Navigate to workspace preview if viewing a specific image
      if (selectedImage) {
        setSelectedImage(null);
      }
      setRegionScreenshotLoading(true);
      addLog?.('📸 正在截取手机屏幕用于划定区域...');
      let frame = null;
      try {
        frame = await takeScreenshot?.();
      } catch {
        // takeScreenshot logs its own errors
      }
      setRegionScreenshotLoading(false);
      if (frame) {
        setCurrentFrame?.(frame);
        addLog?.('  ✅ 截图完成，请划定检测区域');
      } else {
        addLog?.('  ⚠️ 截图失败，请使用现有预览图划定区域');
      }
      setRegionSelectMode(true);
      // Initialize from existing or default
      if (detectionRegion) {
        setRegionBox({ ...detectionRegion });
      } else {
        setRegionBox({ x1: 100, y1: 100, x2: 900, y2: 900 });
      }
    }
  };

  const handleClearRegion = () => {
    setDetectionRegion(null);
    setRegionSelectMode(false);
  };

  const handleSetPath = () => {
    if (pathInput.trim() && updateSavePath) {
      updateSavePath(pathInput.trim());
    }
  };

  return (
    <div className="auto-labeler-workspace">
      {/* Toolbar */}
      <div className="auto-labeler-ws-toolbar">
        <div className="auto-labeler-ws-toolbar-left">
          {selectedImage ? (
            <>
              <span className="auto-labeler-ws-filename">📄 {selectedImage.filename}</span>
              <button className="auto-labeler-btn" onClick={() => setSelectedImage(null)}>
                ← 返回预览
              </button>
            </>
          ) : (
            <span className="auto-labeler-ws-filename">
              {running ? '🔄 自动标注运行中...' : '🖼️ 工作区预览'}
            </span>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="auto-labeler-ws-content">
        {/* Center: image + interactive bbox editing */}
        <div className="auto-labeler-ws-image-area">
          {/* Floating annotation tools in upper-left */}
          {selectedImage && displayFrame && (
            <div className="auto-labeler-ws-float-tools">
              <button
                className="auto-labeler-btn"
                onClick={handleUndo}
                disabled={annotationHistory.length === 0}
                title="撤销 (Ctrl+Z)"
              >
                ↩ 撤销
              </button>
              <button
                className={`auto-labeler-btn ${cropMode ? 'active' : ''}`}
                onClick={() => {
                  if (cropMode) {
                    setCropMode(false);
                    setCropBox(null);
                    setCropClickState(null);
                  } else {
                    setCropMode(true);
                    setCropBox(null);
                    setCropClickState(null);
                  }
                }}
              >
                ✂️ {cropMode ? '取消裁剪' : '裁剪'}
              </button>
              {cropMode && !cropClickState && !cropBox && (
                <span className="auto-labeler-ws-float-info" style={{ color: '#ff9800' }}>
                  👆 点击左上角位置
                </span>
              )}
              {cropMode && cropClickState && !cropBox && (
                <span className="auto-labeler-ws-float-info" style={{ color: '#ff9800' }}>
                  👇 点击右下角位置
                </span>
              )}
              {cropMode && cropBox && (
                <button className="auto-labeler-btn primary" onClick={handleApplyCrop}>
                  ✅ 确认裁剪
                </button>
              )}
              <button className="auto-labeler-btn primary" onClick={saveAnnotationEdits}>
                💾 保存 (Ctrl+S)
              </button>
            </div>
          )}

          {/* Floating annotation editor panel — collapsible */}
          {selectedImage && displayFrame && selectedAnnotations.length > 0 && (
            <div className="auto-labeler-ws-float-annotations">
              <div
                className="auto-labeler-ws-float-ann-header"
                onClick={() => setAnnListCollapsed(!annListCollapsed)}
                style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <span style={{ fontSize: 10, transition: 'transform 0.2s', transform: annListCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', display: 'inline-block' }}>▶</span>
                📋 标注列表 ({selectedAnnotations.length})
              </div>
              {!annListCollapsed && (
                <div className="auto-labeler-ws-float-ann-list">
                  {selectedAnnotations.map((ann, i) => (
                    <div
                      key={i}
                      className="auto-labeler-ann-item"
                      onMouseEnter={() => setHoveredAnnotation(i)}
                      onMouseLeave={() => setHoveredAnnotation(null)}
                      style={hoveredAnnotation === i ? { backgroundColor: 'rgba(255,152,0,0.15)' } : undefined}
                    >
                      <span className="auto-labeler-ann-index">{i}</span>
                      {editingLabel === i ? (
                        <input
                          className="auto-labeler-ann-input"
                          defaultValue={ann.label}
                          autoFocus
                          onBlur={(e) => updateLabel(i, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') updateLabel(i, e.target.value);
                            if (e.key === 'Escape') setEditingLabel(null);
                          }}
                        />
                      ) : (
                        <span
                          className="auto-labeler-ann-label"
                          onClick={() => setEditingLabel(i)}
                          title="点击编辑标签"
                        >
                          {ann.label}
                        </span>
                      )}
                      <span className="auto-labeler-ann-coords">
                        ({Math.round(ann.x1 ?? ann.bbox?.[0] ?? 0)},{Math.round(ann.y1 ?? ann.bbox?.[1] ?? 0)},{Math.round(ann.x2 ?? ann.bbox?.[2] ?? 0)},{Math.round(ann.y2 ?? ann.bbox?.[3] ?? 0)})
                      </span>
                      <button
                        className="auto-labeler-btn-small"
                        onClick={() => removeAnnotation(i)}
                        title="删除此标注"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {displayFrame ? (
            <div
              className="auto-labeler-ws-image-container"
              ref={containerRef}
              onPointerDown={handlePointerDown}
              onMouseDown={handleMiddleMouseDown}
              onMouseMove={handleMouseMove}
              onWheel={handleWheel}
              style={{
                transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
                transformOrigin: 'center center',
                cursor: colorPickMode ? 'crosshair' : undefined,
              }}
            >
              <img
                ref={imageRef}
                src={`data:${displayContentType};base64,${displayFrame}`}
                alt="Label preview"
                draggable={false}
              />
              {/* Annotation overlays (hide during crop and region select) */}
              {!cropMode && !regionSelectMode && displayAnnotations.map((ann, i) => {
                const ax1 = ann.x1 ?? ann.bbox?.[0] ?? 0;
                const ay1 = ann.y1 ?? ann.bbox?.[1] ?? 0;
                const ax2 = ann.x2 ?? ann.bbox?.[2] ?? 0;
                const ay2 = ann.y2 ?? ann.bbox?.[3] ?? 0;
                const isHovered = hoveredAnnotation === i;
                return (
                  <div
                    key={i}
                    className="auto-labeler-bbox"
                    style={{
                      left: `${(ax1 / 1000) * 100}%`,
                      top: `${(ay1 / 1000) * 100}%`,
                      width: `${((ax2 - ax1) / 1000) * 100}%`,
                      height: `${((ay2 - ay1) / 1000) * 100}%`,
                      ...(isHovered ? {
                        borderColor: '#ff9800',
                        backgroundColor: 'rgba(255,152,0,0.25)',
                        zIndex: 5,
                      } : {}),
                    }}
                  >
                    <span className="auto-labeler-bbox-label">{ann.label}</span>
                  </div>
                );
              })}
              {/* Drawing box preview */}
              {drawingBox && (
                <div
                  className="auto-labeler-bbox"
                  style={{
                    left: `${(drawingBox.x1 / 1000) * 100}%`,
                    top: `${(drawingBox.y1 / 1000) * 100}%`,
                    width: `${((drawingBox.x2 - drawingBox.x1) / 1000) * 100}%`,
                    height: `${((drawingBox.y2 - drawingBox.y1) / 1000) * 100}%`,
                    borderColor: '#2196f3',
                    backgroundColor: 'rgba(33,150,243,0.15)',
                    borderStyle: 'dashed',
                  }}
                />
              )}
              {/* Crop: first click indicator (top-left point) */}
              {cropMode && cropClickState && !cropBox && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${(cropClickState.x1 / 1000) * 100}%`,
                    top: `${(cropClickState.y1 / 1000) * 100}%`,
                    width: '12px',
                    height: '12px',
                    background: '#ff5722',
                    borderRadius: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 10,
                    pointerEvents: 'none',
                    boxShadow: '0 0 0 3px rgba(255,87,34,0.4)',
                  }}
                />
              )}
              {/* Crop: completed crop box */}
              {cropMode && cropBox && (
                <MobileCropOverlay
                  cropBox={cropBox}
                  onCropChange={setCropBox}
                  imageRect={imageRect}
                />
              )}
              {/* Region selection overlay (reuses crop overlay) */}
              {regionSelectMode && (
                <MobileCropOverlay
                  cropBox={regionBox}
                  onCropChange={setRegionBox}
                  imageRect={imageRect}
                />
              )}
              {/* Show detection region indicator when set (non-edit mode) */}
              {!regionSelectMode && !cropMode && detectionRegion && !selectedImage && (
                <div
                  className="auto-labeler-bbox"
                  style={{
                    left: `${(detectionRegion.x1 / 1000) * 100}%`,
                    top: `${(detectionRegion.y1 / 1000) * 100}%`,
                    width: `${((detectionRegion.x2 - detectionRegion.x1) / 1000) * 100}%`,
                    height: `${((detectionRegion.y2 - detectionRegion.y1) / 1000) * 100}%`,
                    borderColor: '#ff9800',
                    backgroundColor: 'rgba(255,152,0,0.08)',
                    borderStyle: 'dashed',
                    borderWidth: '2px',
                    pointerEvents: 'none',
                  }}
                >
                  <span className="auto-labeler-bbox-label" style={{ background: '#ff9800' }}>检测区域</span>
                </div>
              )}
            </div>
          ) : (
            <div className="auto-labeler-ws-placeholder">
              {running ? (
                <span>⏳ 等待截图...</span>
              ) : (
                <span>🖼️ 选择左侧图片或启动自动标注</span>
              )}
            </div>
          )}

          {/* Bottom-left reset view button */}
          {displayFrame && (zoomLevel !== 1.0 || panOffset.x !== 0 || panOffset.y !== 0) && (
            <button
              className="auto-labeler-btn auto-labeler-reset-view-btn"
              onClick={resetView}
              title="复位图片 (重置缩放和平移)"
            >
              ⟳ 复位
            </button>
          )}

          {/* Color pick mode indicator */}
          {colorPickMode && (
            <div className="auto-labeler-color-pick-hint">
              🎯 点击图片上的色块像素来选取颜色
              <button className="auto-labeler-btn-small" onClick={() => setColorPickMode(false)} style={{ marginLeft: 8 }}>✕ 取消</button>
            </div>
          )}
        </div>

        {/* Right sidebar: settings & controls */}
        <div className="auto-labeler-ws-sidebar" style={{ overflowY: 'auto' }}>
          {/* Settings & controls */}
          <section className="auto-labeler-section">
            <div className="auto-labeler-section-title">📁 保存路径</div>
            {savePath && (
              <div className="auto-labeler-path-current" title={savePath}>
                {savePath}
              </div>
            )}
            <div className="auto-labeler-row">
              <input
                type="text"
                className="auto-labeler-input"
                placeholder="输入保存目录路径..."
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSetPath(); }}
              />
              <button
                className="auto-labeler-btn"
                onClick={handleSetPath}
                disabled={!pathInput.trim()}
              >
                设置
              </button>
            </div>
          </section>

          <section className="auto-labeler-section">
            <div className="auto-labeler-section-title">📋 标注模式</div>
            <div className="auto-labeler-mode-tabs">
              <button
                className={`auto-labeler-mode-btn ${mode === 'single' ? 'active' : ''}`}
                onClick={() => setMode('single')}
                disabled={running}
              >
                📸 单张
              </button>
              <button
                className={`auto-labeler-mode-btn ${mode === 'gallery' ? 'active' : ''}`}
                onClick={() => setMode('gallery')}
                disabled={running}
              >
                🖼️ 图库
              </button>
              <button
                className={`auto-labeler-mode-btn ${mode === 'stream' ? 'active' : ''}`}
                onClick={() => setMode('stream')}
                disabled={running}
              >
                📹 流
              </button>
            </div>
          </section>

          <section className="auto-labeler-section">
            <div className="auto-labeler-section-title">🔍 检测提示词</div>
            <div className="auto-labeler-row">
              <input
                type="text"
                className="auto-labeler-input"
                placeholder="输入完整检测提示词 (如: 找出图中所有按钮的坐标)"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addPrompt(); }}
                disabled={running}
              />
              <button
                className="auto-labeler-btn"
                onClick={addPrompt}
                disabled={running || !promptInput.trim()}
              >
                添加
              </button>
            </div>
            {prompts.length > 0 && (
              <div className="auto-labeler-tags">
                {prompts.map((p, i) => (
                  <span key={i} className="auto-labeler-tag">
                    {p}
                    <button
                      className="auto-labeler-tag-remove"
                      onClick={() => removePrompt(i)}
                      disabled={running}
                      title="移除"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Detection region selection (for gallery & stream modes) */}
          {(mode === 'gallery' || mode === 'stream') && (
            <section className="auto-labeler-section">
              <div className="auto-labeler-section-title">📐 检测区域</div>
              {detectionRegion && !regionSelectMode && (
                <div className="auto-labeler-path-current" style={{ color: '#ff9800' }}>
                  ({detectionRegion.x1},{detectionRegion.y1})-({detectionRegion.x2},{detectionRegion.y2})
                </div>
              )}
              <div className="auto-labeler-row">
                <button
                  className={`auto-labeler-btn ${regionSelectMode ? 'primary' : ''}`}
                  onClick={handleToggleRegionSelect}
                  disabled={running || regionScreenshotLoading}
                  title={regionSelectMode ? '确认划定区域' : '截取手机屏幕并划定检测区域'}
                >
                  {regionScreenshotLoading ? '📸 截图中...' : regionSelectMode ? '✅ 确认区域' : '✏️ 划定区域'}
                </button>
                {detectionRegion && (
                  <button
                    className="auto-labeler-btn"
                    onClick={handleClearRegion}
                    disabled={running}
                    title="清除检测区域，使用全屏"
                  >
                    ✕ 清除
                  </button>
                )}
              </div>
              {!detectionRegion && !regionSelectMode && (
                <div className="auto-labeler-hint">未设置，将使用全屏检测</div>
              )}
            </section>
          )}

          {mode === 'gallery' && (
            <>
              <section className="auto-labeler-section">
                <div className="auto-labeler-section-title">⏱️ 滑动间隔</div>
                <div className="auto-labeler-row">
                  <input
                    type="range"
                    min="500"
                    max="10000"
                    step="500"
                    value={swipeDelay}
                    onChange={(e) => setSwipeDelay(Number(e.target.value))}
                    disabled={running}
                    className="auto-labeler-slider"
                  />
                  <span className="auto-labeler-delay-value">{(swipeDelay / 1000).toFixed(1)}s</span>
                </div>
              </section>

              <section className="auto-labeler-section">
                <div className="auto-labeler-section-title">🖼️ 图片提取</div>
                <label className="auto-labeler-toggle-label">
                  <input
                    type="checkbox"
                    checked={enableImageExtraction}
                    onChange={(e) => setEnableImageExtraction(e.target.checked)}
                    disabled={running}
                  />
                  从手机截图提取网络图片
                </label>
                {enableImageExtraction && (
                  <div style={{ marginTop: 6 }}>
                    <div className="auto-labeler-row" style={{ gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#aaa', whiteSpace: 'nowrap' }}>色块颜色:</span>
                      {extractionColor ? (
                        <span
                          style={{
                            display: 'inline-block', width: 20, height: 20, borderRadius: 3,
                            background: `rgb(${extractionColor.r},${extractionColor.g},${extractionColor.b})`,
                            border: '1px solid #555', flexShrink: 0,
                          }}
                          title={`rgb(${extractionColor.r}, ${extractionColor.g}, ${extractionColor.b})`}
                        />
                      ) : (
                        <span
                          style={{
                            display: 'inline-block', width: 20, height: 20, borderRadius: 3,
                            background: '#000', border: '1px solid #555', flexShrink: 0,
                          }}
                          title="默认: 黑色"
                        />
                      )}
                      <button
                        className="auto-labeler-btn"
                        onClick={async () => {
                          if (!currentFrame) {
                            addLog?.('📸 正在截取手机屏幕...');
                            await takeScreenshot?.();
                          }
                          setColorPickMode(true);
                          addLog?.('🎯 请在预览图上点击色块像素来选取颜色');
                        }}
                        disabled={running}
                        style={{ fontSize: 11 }}
                        title="从手机截图中点选像素颜色"
                      >
                        🎯 取色
                      </button>
                      {extractionColor && (
                        <button
                          className="auto-labeler-btn"
                          onClick={() => setExtractionColor(null)}
                          disabled={running}
                          style={{ fontSize: 11 }}
                          title="重置为默认黑色"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

          <section className="auto-labeler-section">
            <div className="auto-labeler-section-title">🎮 控制</div>
            <div className="auto-labeler-row">
              {!running ? (
                <button
                  className="auto-labeler-btn primary"
                  onClick={startAutomation}
                  disabled={prompts.length === 0}
                >
                  ▶ {mode === 'single' ? '单张检测' : mode === 'gallery' ? '开始图库' : '开始串流'}
                </button>
              ) : (
                <button
                  className="auto-labeler-btn danger"
                  onClick={stopAutomation}
                >
                  ⏹ 停止
                </button>
              )}
            </div>
          </section>

          {(running || processedCount > 0) && (
            <section className="auto-labeler-section">
              <div className="auto-labeler-section-title">📊 状态</div>
              <div className="auto-labeler-stats">
                <span>已处理: <strong>{processedCount}</strong></span>
                {currentPrompt && <span>提示词: <strong>{currentPrompt}</strong></span>}
                {streaming && <span>帧率: <strong>{fps?.toFixed(1)}</strong></span>}
                {streaming && (
                  <span className={`auto-labeler-status ${connectionStatus}`}>
                    {connectionStatus === 'connected' ? '🟢' :
                     connectionStatus === 'connecting' ? '🟡' : '⚪'}
                  </span>
                )}
              </div>
            </section>
          )}

          <section className="auto-labeler-section auto-labeler-log-section">
            <div className="auto-labeler-section-title">📋 日志</div>
            <div className="auto-labeler-log">
              {log.length === 0 ? (
                <div className="auto-labeler-log-empty">等待操作...</div>
              ) : (
                log.map((msg, i) => (
                  <div key={i} className="auto-labeler-log-item">{msg}</div>
                ))
              )}
            </div>
          </section>

          {error && (
            <div className="auto-labeler-error">
              <span>❌ {error}</span>
              <button className="auto-labeler-btn-small" onClick={() => setError('')}>✕</button>
            </div>
          )}
        </div>
      </div>

      {labelDialogState && (
        <LabelInputDialog
          defaultValue={labelDialogState.defaultValue || ''}
          existingLabels={existingLabels}
          onConfirm={labelDialogState.onConfirm}
          onCancel={() => setLabelDialogState(null)}
        />
      )}

      {cropConfirmDialog && (
        <CropConfirmDialog
          onSaveAs={handleCropSaveAs}
          onOverwrite={handleCropOverwrite}
          onCancel={() => setCropConfirmDialog(false)}
        />
      )}
    </div>
  );
}

export default { AutoLabelerProvider, AutoLabelerPanel, AutoLabelerWorkspace };
