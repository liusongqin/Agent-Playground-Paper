import { useState, useEffect } from 'react';
import { listMcpTools } from '../services/mcp';

export default function McpPanel({ mcpServers, onAddServer, onDeleteServer, onUpdateServer }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newServer, setNewServer] = useState({
    name: '',
    command: '',
    args: '',
    env: '',
    description: '',
  });
  const [availableTools, setAvailableTools] = useState([]);
  const [toolsLoading, setToolsLoading] = useState(true);

  // Fetch available MCP tools on mount
  useEffect(() => {
    listMcpTools()
      .then((tools) => setAvailableTools(tools))
      .catch(() => setAvailableTools([]))
      .finally(() => setToolsLoading(false));
  }, []);

  const handleAdd = () => {
    if (!newServer.name.trim() || !newServer.command.trim()) return;
    onAddServer({
      ...newServer,
      id: `mcp-${crypto.randomUUID()}`,
      args: newServer.args ? newServer.args.split(/\s+/).filter(Boolean) : [],
      env: parseEnvString(newServer.env),
      enabled: true,
    });
    setNewServer({ name: '', command: '', args: '', env: '', description: '' });
    setShowAddForm(false);
  };

  const handleUpdate = (server) => {
    onUpdateServer(server);
    setEditingId(null);
  };

  const handleToggle = (server) => {
    onUpdateServer({ ...server, enabled: !server.enabled });
  };

  return (
    <div className="mcp-panel">
      <div className="mcp-panel-header">
        <span className="mcp-panel-title">MCP TOOLS</span>
        <button
          className="btn-icon"
          onClick={() => setShowAddForm(!showAddForm)}
          title="Add MCP Server"
        >
          ➕
        </button>
      </div>

      <div className="mcp-panel-info">
        <span className="form-hint">
          本地MCP工具可在Agent模式下直接调用（使用 mcp_ 前缀）。
        </span>
      </div>

      {/* Available MCP Tools */}
      <div className="mcp-tools-section">
        <div className="mcp-tools-header">
          <span className="mcp-tools-title">🔧 可用工具 ({availableTools.length})</span>
          <button
            className="btn-icon"
            onClick={() => {
              setToolsLoading(true);
              listMcpTools()
                .then((tools) => setAvailableTools(tools))
                .catch(() => setAvailableTools([]))
                .finally(() => setToolsLoading(false));
            }}
            title="刷新工具列表"
          >
            🔄
          </button>
        </div>
        {toolsLoading ? (
          <div className="mcp-tools-loading">加载中...</div>
        ) : availableTools.length === 0 ? (
          <div className="mcp-tools-empty">
            <span className="form-hint">未检测到MCP工具，请确保服务器已启动。</span>
          </div>
        ) : (
          <div className="mcp-tools-list">
            {availableTools.map((tool) => (
              <div key={tool.name} className="mcp-tool-card">
                <div className="mcp-tool-name">mcp_{tool.name}</div>
                <div className="mcp-tool-desc">{tool.description}</div>
                {tool.parameters && Object.keys(tool.parameters).length > 0 && (
                  <div className="mcp-tool-params">
                    {Object.entries(tool.parameters).map(([name, info]) => (
                      <span key={name} className="skill-param-badge">
                        {name}: {info.type || 'string'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showAddForm && (
        <div className="mcp-add-form">
          <div className="form-group">
            <label>Server Name</label>
            <input
              type="text"
              value={newServer.name}
              onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
              placeholder="e.g. filesystem-server"
            />
          </div>
          <div className="form-group">
            <label>Command</label>
            <input
              type="text"
              value={newServer.command}
              onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
              placeholder="e.g. npx, python, node"
            />
            <span className="form-hint">The executable to run the MCP server</span>
          </div>
          <div className="form-group">
            <label>Arguments</label>
            <input
              type="text"
              value={newServer.args}
              onChange={(e) => setNewServer({ ...newServer, args: e.target.value })}
              placeholder="e.g. -y @modelcontextprotocol/server-filesystem /path"
            />
            <span className="form-hint">Space-separated command arguments</span>
          </div>
          <div className="form-group">
            <label>Environment Variables</label>
            <textarea
              value={newServer.env}
              onChange={(e) => setNewServer({ ...newServer, env: e.target.value })}
              placeholder="KEY=VALUE (one per line)"
              rows={2}
            />
            <span className="form-hint">Optional environment variables, one KEY=VALUE per line</span>
          </div>
          <div className="form-group">
            <label>Description</label>
            <input
              type="text"
              value={newServer.description}
              onChange={(e) => setNewServer({ ...newServer, description: e.target.value })}
              placeholder="What does this MCP server provide?"
            />
          </div>
          <div className="mcp-add-actions">
            <button className="btn-secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleAdd}>Add Server</button>
          </div>
        </div>
      )}

      <div className="mcp-server-list">
        {mcpServers.length === 0 && !showAddForm && (
          <div className="mcp-empty">
            <div className="mcp-empty-icon">🔌</div>
            <p>No MCP servers configured</p>
            <p className="form-hint">
              Add an MCP server to extend the agent with external tools.
            </p>
          </div>
        )}

        {mcpServers.map((server) => (
          <div key={server.id} className={`mcp-server-card ${server.enabled ? '' : 'disabled'}`}>
            {editingId === server.id ? (
              <McpServerEditForm
                server={server}
                onSave={handleUpdate}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <div className="mcp-server-header">
                  <span className="mcp-server-status">
                    {server.enabled ? '🟢' : '⚪'}
                  </span>
                  <span className="mcp-server-name">{server.name}</span>
                  <div className="mcp-server-actions">
                    <button
                      className="btn-icon"
                      onClick={() => handleToggle(server)}
                      title={server.enabled ? 'Disable' : 'Enable'}
                    >
                      {server.enabled ? '⏸️' : '▶️'}
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() => setEditingId(server.id)}
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() => onDeleteServer(server.id)}
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                {server.description && (
                  <div className="mcp-server-desc">{server.description}</div>
                )}
                <div className="mcp-server-detail">
                  <span className="mcp-detail-label">Command:</span>
                  <code className="mcp-detail-value">
                    {server.command} {Array.isArray(server.args) ? server.args.join(' ') : server.args}
                  </code>
                </div>
                {server.env && Object.keys(server.env).length > 0 && (
                  <div className="mcp-server-detail">
                    <span className="mcp-detail-label">Env:</span>
                    <span className="mcp-detail-value">
                      {Object.keys(server.env).join(', ')}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function McpServerEditForm({ server, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: server.name,
    command: server.command,
    args: Array.isArray(server.args) ? server.args.join(' ') : (server.args || ''),
    env: server.env ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
    description: server.description || '',
  });

  const handleSave = () => {
    if (!form.name.trim() || !form.command.trim()) return;
    onSave({
      ...server,
      name: form.name,
      command: form.command,
      args: form.args ? form.args.split(/\s+/).filter(Boolean) : [],
      env: parseEnvString(form.env),
      description: form.description,
    });
  };

  return (
    <div className="mcp-edit-form">
      <div className="form-group">
        <label>Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div className="form-group">
        <label>Command</label>
        <input
          type="text"
          value={form.command}
          onChange={(e) => setForm({ ...form, command: e.target.value })}
        />
      </div>
      <div className="form-group">
        <label>Arguments</label>
        <input
          type="text"
          value={form.args}
          onChange={(e) => setForm({ ...form, args: e.target.value })}
        />
      </div>
      <div className="form-group">
        <label>Environment</label>
        <textarea
          value={form.env}
          onChange={(e) => setForm({ ...form, env: e.target.value })}
          rows={2}
        />
      </div>
      <div className="form-group">
        <label>Description</label>
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </div>
      <div className="mcp-add-actions">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={handleSave}>Save</button>
      </div>
    </div>
  );
}

function parseEnvString(envStr) {
  if (!envStr || !envStr.trim()) return {};
  const env = {};
  for (const line of envStr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.substring(0, idx).trim();
    const value = trimmed.substring(idx + 1).trim();
    if (key) {
      env[key] = value;
    }
  }
  return env;
}
