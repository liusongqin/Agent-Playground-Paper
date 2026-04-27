/**
 * Global API Monitor: Intercepts all fetch calls to backend APIs
 * and records requests/responses for developer monitoring.
 */

const MAX_LOG_ENTRIES = 50;

let apiLogs = [];
let listeners = [];
let idCounter = 0;

/**
 * Add a listener that is notified on each new API log entry.
 * @param {function} fn - callback(logs)
 * @returns {function} unsubscribe
 */
export function subscribeApiLogs(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

function notifyListeners() {
  const snapshot = [...apiLogs];
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch {
      // ignore listener errors
    }
  }
}

/**
 * Get current API logs snapshot.
 */
export function getApiLogs() {
  return [...apiLogs];
}

/**
 * Clear all API logs.
 */
export function clearApiLogs() {
  apiLogs = [];
  notifyListeners();
}

/**
 * Read an SSE stream response and accumulate content into a log entry.
 * Updates the log entry in-place and notifies listeners as content arrives.
 */
async function readStreamResponse(clonedResponse, logEntry) {
  try {
    const reader = clonedResponse.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
          }
        } catch {
          // skip malformed JSON lines
        }
      }

      // Update log entry with accumulated content
      logEntry.response = fullContent || '(streaming...)';
      notifyListeners();
    }

    // Final update with complete content
    logEntry.response = fullContent || '(empty streaming response)';
    logEntry.duration = Math.round(performance.now() - (logEntry._startTime || 0));
    notifyListeners();
  } catch {
    if (!logEntry.response || logEntry.response === '(streaming...)') {
      logEntry.response = '(streaming read error)';
    }
    notifyListeners();
  }
}

/**
 * Install the global fetch interceptor.
 * Call once at app startup.
 */
export function installFetchInterceptor() {
  const originalFetch = window.fetch;

  window.fetch = async function interceptedFetch(...args) {
    const [resource, init] = args;
    const url = typeof resource === 'string' ? resource : resource?.url || '';

    // Only monitor API calls (skip non-API resources like static files)
    const isApiCall = url.includes('/api/') || url.includes('/v1/') || url.includes('/chat/completions');
    if (!isApiCall) {
      return originalFetch.apply(this, args);
    }

    const method = init?.method || 'GET';
    const timestamp = new Date().toISOString();
    let requestBody = null;

    // Capture request body
    if (init?.body) {
      try {
        if (typeof init.body === 'string') {
          requestBody = JSON.parse(init.body);
        } else {
          requestBody = String(init.body);
        }
      } catch {
        requestBody = typeof init.body === 'string' ? init.body : '(binary data)';
      }
    }

    const startTime = performance.now();

    const logEntry = {
      id: `${Date.now()}-${++idCounter}`,
      timestamp,
      method,
      url,
      request: requestBody,
      response: null,
      status: null,
      error: null,
      duration: null,
      _startTime: startTime,
    };

    try {
      const response = await originalFetch.apply(this, args);
      const endTime = performance.now();
      logEntry.duration = Math.round(endTime - startTime);
      logEntry.status = response.status;

      // Clone response to read body without consuming it
      const cloned = response.clone();

      // Read response body (best-effort, may be streaming)
      try {
        const contentType = cloned.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream')) {
          // For streaming responses, add entry immediately as "streaming..."
          logEntry.response = '(streaming...)';
          apiLogs = [...apiLogs.slice(-(MAX_LOG_ENTRIES - 1)), logEntry];
          notifyListeners();

          // Read the SSE stream in background and accumulate content
          readStreamResponse(cloned, logEntry);
        } else {
          const text = await cloned.text();
          try {
            logEntry.response = JSON.parse(text);
          } catch {
            logEntry.response = text.length > 2000 ? text.slice(0, 2000) + '...' : text;
          }
          apiLogs = [...apiLogs.slice(-(MAX_LOG_ENTRIES - 1)), logEntry];
          notifyListeners();
        }
      } catch {
        logEntry.response = '(unable to read response)';
        apiLogs = [...apiLogs.slice(-(MAX_LOG_ENTRIES - 1)), logEntry];
        notifyListeners();
      }

      return response;
    } catch (err) {
      const endTime = performance.now();
      logEntry.duration = Math.round(endTime - startTime);
      logEntry.error = err.message;

      apiLogs = [...apiLogs.slice(-(MAX_LOG_ENTRIES - 1)), logEntry];
      notifyListeners();

      throw err;
    }
  };
}
