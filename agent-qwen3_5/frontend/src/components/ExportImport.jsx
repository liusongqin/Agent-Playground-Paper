import { useRef, useState } from 'react';

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadMarkdown(conversations, filename) {
  let md = '# Agent Chat Export\n\n';
  md += `Export Date: ${new Date().toISOString()}\n\n---\n\n`;

  for (const conv of conversations) {
    md += `## ${conv.title}\n\n`;
    md += `Created: ${new Date(conv.createdAt).toLocaleString()}\n\n`;

    for (const msg of conv.messages) {
      const role = msg.role === 'user' ? '**You**' : msg.role === 'assistant' ? '**Assistant**' : `**${msg.role}**`;
      const time = new Date(msg.timestamp).toLocaleTimeString();
      md += `### ${role} (${time})\n\n${msg.content}\n\n`;
    }
    md += '---\n\n';
  }

  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ExportImport({ conversations, onImportConversations, settings, onImportSettings }) {
  const fileInputRef = useRef(null);
  const [importStatus, setImportStatus] = useState(null);

  const handleExportConversations = () => {
    const data = {
      type: 'agent-chat-conversations',
      version: 1,
      exportedAt: new Date().toISOString(),
      conversations,
    };
    downloadJSON(data, `agent-chat-conversations-${Date.now()}.json`);
  };

  const handleExportMarkdown = () => {
    downloadMarkdown(conversations, `agent-chat-export-${Date.now()}.md`);
  };

  const handleExportSettings = () => {
    const data = {
      type: 'agent-chat-settings',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { ...settings, apiKey: '' }, // Don't export API key
    };
    downloadJSON(data, `agent-chat-settings-${Date.now()}.json`);
  };

  const handleExportAll = () => {
    const data = {
      type: 'agent-chat-full-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      conversations,
      settings: { ...settings, apiKey: '' },
    };
    downloadJSON(data, `agent-chat-full-export-${Date.now()}.json`);
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        let imported = false;

        if (data.type === 'agent-chat-conversations' || data.type === 'agent-chat-full-export') {
          if (data.conversations && Array.isArray(data.conversations)) {
            onImportConversations(data.conversations);
            imported = true;
          }
        }

        if (data.type === 'agent-chat-settings' || data.type === 'agent-chat-full-export') {
          if (data.settings) {
            onImportSettings(data.settings);
            imported = true;
          }
        }

        if (imported) {
          setImportStatus({ type: 'success', message: 'Data imported successfully!' });
        } else {
          setImportStatus({ type: 'error', message: 'Unrecognized file format. Please use an Agent Chat export file.' });
        }
      } catch {
        setImportStatus({ type: 'error', message: 'Failed to parse file. Please ensure it is a valid JSON file.' });
      }
    };
    reader.readAsText(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="export-import">
      <div className="export-import-header">
        <span className="export-import-title">DATA MANAGEMENT</span>
      </div>

      <div className="export-import-body">
        <div className="export-section">
          <h3>📤 Export</h3>
          <div className="export-buttons">
            <button className="btn-export" onClick={handleExportConversations}>
              <span className="btn-export-icon">💬</span>
              <span className="btn-export-text">
                <span className="btn-export-label">Export Conversations</span>
                <span className="btn-export-hint">JSON format, {conversations.length} conversations</span>
              </span>
            </button>
            <button className="btn-export" onClick={handleExportMarkdown}>
              <span className="btn-export-icon">📝</span>
              <span className="btn-export-text">
                <span className="btn-export-label">Export as Markdown</span>
                <span className="btn-export-hint">Human-readable format</span>
              </span>
            </button>
            <button className="btn-export" onClick={handleExportSettings}>
              <span className="btn-export-icon">⚙️</span>
              <span className="btn-export-text">
                <span className="btn-export-label">Export Settings</span>
                <span className="btn-export-hint">API key excluded for security</span>
              </span>
            </button>
            <button className="btn-export" onClick={handleExportAll}>
              <span className="btn-export-icon">📦</span>
              <span className="btn-export-text">
                <span className="btn-export-label">Export All Data</span>
                <span className="btn-export-hint">Complete backup</span>
              </span>
            </button>
          </div>
        </div>

        <div className="import-section">
          <h3>📥 Import</h3>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            style={{ display: 'none' }}
          />
          <button
            className="btn-import"
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="btn-import-icon">📂</span>
            <span className="btn-import-text">
              <span className="btn-import-label">Import from JSON</span>
              <span className="btn-import-hint">Supports conversations, settings, or full exports</span>
            </span>
          </button>
          {importStatus && (
            <div className={`import-status ${importStatus.type}`}>
              {importStatus.type === 'success' ? '✅' : '❌'} {importStatus.message}
            </div>
          )}
        </div>

        <div className="data-stats">
          <h3>📊 Statistics</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-value">{conversations.length}</span>
              <span className="stat-label">Conversations</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">
                {conversations.reduce((sum, c) => sum + (c.messages?.length || 0), 0)}
              </span>
              <span className="stat-label">Messages</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{settings.model}</span>
              <span className="stat-label">Current Model</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">
                {settings.apiKey ? 'Configured' : 'Not Set'}
              </span>
              <span className="stat-label">API Key</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
