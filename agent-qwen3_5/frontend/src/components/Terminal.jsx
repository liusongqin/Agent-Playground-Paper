import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const DEFAULT_WS_URL = 'ws://localhost:8765';
const WS_URL_STORAGE_KEY = 'agent-chat-terminal-ws-url';
const INITIAL_CONNECT_DELAY_MS = 200;
const FIT_DELAY_MS = 100;
const RECONNECT_DELAY_MS = 100;

const TERMINAL_THEME = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#aeafad',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  black: '#1e1e1e',
  red: '#f44747',
  green: '#6a9955',
  yellow: '#d7ba7d',
  blue: '#569cd6',
  magenta: '#c586c0',
  cyan: '#4ec9b0',
  white: '#d4d4d4',
  brightBlack: '#808080',
  brightRed: '#f44747',
  brightGreen: '#6a9955',
  brightYellow: '#d7ba7d',
  brightBlue: '#569cd6',
  brightMagenta: '#c586c0',
  brightCyan: '#4ec9b0',
  brightWhite: '#ffffff',
};

export default forwardRef(function Terminal({ isVisible, onCwdChange, style }, ref) {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const onCwdChangeRef = useRef(onCwdChange);
  const [connected, setConnected] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const wsUrlRef = useRef(
    (() => {
      try {
        return localStorage.getItem(WS_URL_STORAGE_KEY) || DEFAULT_WS_URL;
      } catch {
        return DEFAULT_WS_URL;
      }
    })()
  );
  const [wsUrlInput, setWsUrlInput] = useState(() => {
    try {
      return localStorage.getItem(WS_URL_STORAGE_KEY) || DEFAULT_WS_URL;
    } catch {
      return DEFAULT_WS_URL;
    }
  });

  // Keep the CWD change callback ref in sync
  useEffect(() => {
    onCwdChangeRef.current = onCwdChange;
  }, [onCwdChange]);

  // Output capture buffer for agent use
  const outputBufferRef = useRef('');
  const capturingRef = useRef(false);

  // Expose sendCommand and captureOutput to parent via ref
  useImperativeHandle(ref, () => ({
    sendCommand: (command) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data: command + '\r' }));
        return true;
      }
      return false;
    },
    isConnected: () => connected,
    /**
     * Start capturing terminal output into a buffer.
     * Call stopCapture() to retrieve captured output.
     */
    startCapture: () => {
      outputBufferRef.current = '';
      capturingRef.current = true;
    },
    /**
     * Stop capturing and return the captured terminal output (plain text, ANSI stripped).
     * @param {number} maxLength - Max characters to return (default 2000)
     * @returns {string} captured output
     */
    stopCapture: (maxLength = 2000) => {
      capturingRef.current = false;
      const raw = outputBufferRef.current;
      outputBufferRef.current = '';
      // Strip ANSI escape sequences for clean text
      // eslint-disable-next-line no-control-regex
      const clean = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      return clean.length > maxLength ? clean.slice(-maxLength) : clean;
    },
  }), [connected]);

  const connectWebSocket = useCallback(() => {
    const term = xtermRef.current;
    if (!term) return;

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const url = wsUrlRef.current;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        term.write('\x1b[1;32m✓ Connected to terminal server\x1b[0m\r\n');
        // Send terminal size on connect
        const { cols, rows } = term;
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'output') {
              term.write(msg.data);
              // Capture output for agent use if capturing is active
              if (capturingRef.current) {
                outputBufferRef.current += msg.data;
              }
            } else if (msg.type === 'cwd') {
              onCwdChangeRef.current?.(msg.data);
            }
          } catch {
            // Plain text output — write directly
            term.write(event.data);
            if (capturingRef.current) {
              outputBufferRef.current += event.data;
            }
          }
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (xtermRef.current) {
          term.write('\r\n\x1b[1;31m✗ Disconnected from terminal server\x1b[0m\r\n');
          term.write('\x1b[90mMake sure the backend server is running:\x1b[0m\r\n');
          term.write('\x1b[93m  cd server && pip install -r requirements.txt && python server.py\x1b[0m\r\n');
          term.write('\x1b[90mClick 🔄 to reconnect or ⚙️ to configure the server URL.\x1b[0m\r\n');
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror
      };
    } catch {
      setConnected(false);
      term.write('\r\n\x1b[1;31m✗ Failed to connect to terminal server\x1b[0m\r\n');
    }
  }, []);

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const term = new XTerminal({
      theme: TERMINAL_THEME,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);

    try {
      fitAddon.fit();
    } catch {
      // ignore fit errors on initial render
    }

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Welcome message
    term.write('\x1b[1;36m=== Terminal ===\x1b[0m\r\n');
    term.write('\x1b[90mConnecting to terminal server...\x1b[0m\r\n');

    // Forward all input to WebSocket
    term.onData((data) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Attempt initial connection
    setTimeout(() => connectWebSocket(), INITIAL_CONNECT_DELAY_MS);

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [connectWebSocket]);

  // Handle resize and visibility changes
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && isVisible) {
        try {
          fitAddonRef.current.fit();
          // Notify server of new terminal size
          if (xtermRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
            const { cols, rows } = xtermRef.current;
            wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
          }
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('resize', handleResize);

    // Use ResizeObserver to detect container size changes (e.g. from drag resizing)
    let resizeObserver;
    if (terminalRef.current) {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(terminalRef.current);
    }

    if (isVisible && fitAddonRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current.fit();
        } catch {
          // ignore
        }
      }, FIT_DELAY_MS);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [isVisible]);

  const handleSaveConfig = () => {
    const url = wsUrlInput.trim() || DEFAULT_WS_URL;
    wsUrlRef.current = url;
    try {
      localStorage.setItem(WS_URL_STORAGE_KEY, url);
    } catch {
      // ignore storage errors
    }
    setShowConfig(false);
    // Reconnect with new URL
    setTimeout(() => connectWebSocket(), RECONNECT_DELAY_MS);
  };

  return (
    <div
      className="terminal-container"
      style={{ display: isVisible ? 'flex' : 'none', ...style }}
    >
      <div className="terminal-header">
        <div className="terminal-header-actions">
          <span className={`terminal-status ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? '● Connected' : '○ Disconnected'}
          </span>
          <button
            className="btn-icon terminal-action-btn"
            onClick={() => connectWebSocket()}
            title="Reconnect"
          >
            🔄
          </button>
          <button
            className="btn-icon terminal-action-btn"
            onClick={() => setShowConfig(!showConfig)}
            title="Configure WebSocket URL"
          >
            ⚙️
          </button>
        </div>
      </div>
      {showConfig && (
        <div className="terminal-config">
          <label className="terminal-config-label">WebSocket URL:</label>
          <input
            type="text"
            className="terminal-config-input"
            value={wsUrlInput}
            onChange={(e) => setWsUrlInput(e.target.value)}
            placeholder={DEFAULT_WS_URL}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveConfig()}
          />
          <button className="btn-primary terminal-config-btn" onClick={handleSaveConfig}>
            Connect
          </button>
        </div>
      )}
      <div className="terminal-body" ref={terminalRef} />
    </div>
  );
})
