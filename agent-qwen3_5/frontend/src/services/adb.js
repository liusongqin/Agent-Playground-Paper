/**
 * ADB Bridge Service - communicates with a local ADB bridge server
 * for Android device operations (screenshot, click, swipe, etc.)
 *
 * The frontend sends HTTP requests to a local ADB bridge server
 * that translates them into actual ADB commands.
 */

const DEFAULT_ADB_URL = 'http://localhost:8080';

function getUrl(baseUrl, path) {
  return `${(baseUrl || DEFAULT_ADB_URL).replace(/\/+$/, '')}${path}`;
}

// 计算图片缩放
let currentScale = 1.0;

/**
 * Take a screenshot via ADB and return base64 image data.
 */
export async function adbScreenshot(baseUrl) {
  const response = await fetch(getUrl(baseUrl, '/api/adb/screenshot'));
  if (!response.ok) {
    throw new Error(`ADB screenshot failed: HTTP ${response.status}`);
  }
  const data = await response.json();
  currentScale = data.scale; // 保存比例
  return data.image; // base64 encoded PNG
}

/**
 * Click at coordinates on the device screen.
 */
export async function adbClick(x, y, baseUrl) {
  const response = await fetch(getUrl(baseUrl, '/api/adb/click'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: Math.round(x), y: Math.round(y), scale: currentScale}),
  });
  if (!response.ok) {
    throw new Error(`ADB click failed: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Input text on the device.
 */
export async function adbInputText(text, baseUrl) {
  const response = await fetch(getUrl(baseUrl, '/api/adb/input/text'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error(`ADB input text failed: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Swipe gesture on the device.
 */
export async function adbSwipe(x1, y1, x2, y2, duration, baseUrl) {
  const response = await fetch(getUrl(baseUrl, '/api/adb/swipe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x1: Math.round(x1),
      y1: Math.round(y1),
      x2: Math.round(x2),
      y2: Math.round(y2),
      duration: duration || 300,
    }),
  });
  if (!response.ok) {
    throw new Error(`ADB swipe failed: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Send a key event to the device (e.g. KEYCODE_HOME=3, KEYCODE_BACK=4).
 */
export async function adbKeyEvent(keycode, baseUrl) {
  const response = await fetch(getUrl(baseUrl, '/api/adb/keyevent'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keycode }),
  });
  if (!response.ok) {
    throw new Error(`ADB key event failed: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * List connected ADB devices.
 */
export async function adbDevices(baseUrl) {
  const response = await fetch(getUrl(baseUrl, '/api/adb/devices'));
  if (!response.ok) {
    throw new Error(`ADB devices query failed: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Input text via ADB Keyboard broadcast mechanism.
 * Sends text through a custom keyboard IME service on the device.
 */
export async function adbKeyboardInput(text, baseUrl) {
  const response = await fetch(getUrl(baseUrl, '/api/adb/keyboard/input'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error(`ADB keyboard input failed: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Parse bounding box coordinates from model response.
 *
 * Expected model response format:
 * ```json
 * [{"bbox_2d": [x1, y1, x2, y2], "label": "element_name"}]
 * ```
 *
 * Coordinates are in 0-1000 normalized range.
 */
export function parseBboxFromResponse(responseContent) {
  // Extract JSON block (may be wrapped in ```json ... ```)
  const jsonMatch = responseContent.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : responseContent;

  const items = JSON.parse(jsonStr);

  if (!Array.isArray(items)) {
    throw new Error('Expected array of bounding boxes');
  }

  return items.map((item) => {
    const bbox = item.bbox_2d;
    if (!Array.isArray(bbox) || bbox.length !== 4) {
      throw new Error('Invalid bbox_2d format');
    }
    return {
      bbox,
      label: item.label || 'unknown',
      x1: bbox[0],
      y1: bbox[1],
      x2: bbox[2],
      y2: bbox[3],
    };
  });
}

/**
 * Calculate center point of a bounding box.
 */
export function calcBboxCenter(x1, y1, x2, y2) {
  return {
    cx: Math.round((x1 + x2) / 2),
    cy: Math.round((y1 + y2) / 2),
  };
}

/**
 * Convert normalized coordinates (0-1000) to pixel coordinates.
 */
export function normalizedToPixel(cx, cy, imgWidth, imgHeight) {
  return {
    px: Math.round((cx / 1000) * imgWidth),
    py: Math.round((cy / 1000) * imgHeight),
  };
}

/**
 * Parse a model response into a structured action object.
 *
 * The model is expected to return JSON with an "action" field and
 * action-specific data. Supports extraction from raw JSON, ```json blocks,
 * or JSON embedded within other text.
 *
 * Supported actions:
 *  - click: { action, bbox_2d, label, thought }
 *  - input_text: { action, text, thought }
 *  - swipe: { action, start, end, thought }
 *  - back: { action, thought }
 *  - wait: { action, duration, thought }
 *  - finish: { action, thought }
 */
export function parseAgentAction(responseContent) {
  let jsonStr = (responseContent || '').trim();

  // Try to extract ```json ... ``` block
  const jsonBlockMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1];
  }

  // Try to extract { ... } if not starting with {
  if (!jsonStr.startsWith('{')) {
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objMatch) {
      jsonStr = objMatch[0];
    }
  }

  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    const preview = jsonStr.length > 200 ? jsonStr.slice(0, 200) + '...' : jsonStr;
    throw new Error(`Invalid JSON in model response: ${preview}`);
  }
  const actionType = (data.action || '').toLowerCase();
  const thought = data.thought || '';

  switch (actionType) {
    case 'click':
      return {
        actionType: 'click',
        bbox: data.bbox_2d,
        label: data.label || 'unknown',
        thought,
      };
    case 'input_text':
      return { actionType: 'input_text', text: data.text, thought };
    case 'swipe':
      return {
        actionType: 'swipe',
        start: data.start,
        end: data.end,
        thought,
      };
    case 'back':
      return { actionType: 'back', thought };
    case 'wait':
      return { actionType: 'wait', duration: data.duration || 2, thought };
    case 'finish':
      return { actionType: 'finish', thought };
    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }
}
