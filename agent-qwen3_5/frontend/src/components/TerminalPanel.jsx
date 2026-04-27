import { useState, forwardRef } from 'react';
import Terminal from './Terminal';
import ClaudeTerminal from './ClaudeTerminal';

/**
 * TerminalPanel — tabbed terminal panel that hosts the original Terminal
 * and the Agent Terminal side-by-side (via tabs).
 *
 * Props are forwarded to the original Terminal component so that the agent
 * integration (sendCommand / capture) keeps working unchanged.
 */
export default forwardRef(function TerminalPanel(
  { isVisible, onCwdChange, style },
  terminalRef
) {
  const [activeTab, setActiveTab] = useState('terminal'); // 'terminal' | 'claudeCode'

  return (
    <div
      className="terminal-panel-wrapper"
      style={{ display: isVisible ? 'flex' : 'none', ...style }}
    >
      {/* Shared tab bar */}
      <div className="terminal-panel-tabs">
        <button
          className={`terminal-panel-tab ${activeTab === 'terminal' ? 'active' : ''}`}
          onClick={() => setActiveTab('terminal')}
        >
          <span className="terminal-tab-icon">⬛</span>
          TERMINAL
        </button>
        <button
          className={`terminal-panel-tab ${activeTab === 'claudeCode' ? 'active' : ''}`}
          onClick={() => setActiveTab('claudeCode')}
        >
          <span className="terminal-tab-icon">🤖</span>
          AGENT TERMINAL 
        </button>
      </div>

      {/* Terminal bodies — we keep both mounted but hide the inactive one
          so that WebSocket connections and state are preserved across tab switches. */}
      <Terminal
        ref={terminalRef}
        isVisible={activeTab === 'terminal'}
        onCwdChange={onCwdChange}
        style={{ flex: 1, border: 'none', height: 'auto' }}
      />
      <ClaudeTerminal
        isVisible={activeTab === 'claudeCode'}
        style={{ flex: 1, border: 'none', height: 'auto' }}
      />
    </div>
  );
});
