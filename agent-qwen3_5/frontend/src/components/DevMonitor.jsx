import { useState, useMemo } from 'react';
import { clearApiLogs } from '../utils/apiMonitor';

export default function DevMonitor({ apiLogs }) {
  const [filterUrl, setFilterUrl] = useState('');
  const [filterMethod, setFilterMethod] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Get unique methods and statuses for filter dropdowns
  const methods = useMemo(() => {
    const set = new Set(apiLogs.map((l) => l.method).filter(Boolean));
    return [...set].sort();
  }, [apiLogs]);

  const statuses = useMemo(() => {
    const set = new Set(apiLogs.map((l) => l.status).filter((s) => s != null));
    return [...set].sort((a, b) => a - b);
  }, [apiLogs]);

  // Apply filters
  const filteredLogs = useMemo(() => {
    return apiLogs.filter((log) => {
      if (filterUrl && !log.url?.toLowerCase().includes(filterUrl.toLowerCase())) return false;
      if (filterMethod && log.method !== filterMethod) return false;
      if (filterStatus && String(log.status) !== filterStatus) return false;
      return true;
    });
  }, [apiLogs, filterUrl, filterMethod, filterStatus]);

  const clearFilters = () => {
    setFilterUrl('');
    setFilterMethod('');
    setFilterStatus('');
  };

  const hasFilters = filterUrl || filterMethod || filterStatus;

  return (
    <div className="dev-monitor">
      <div className="dev-monitor-header">
        <span className="dev-monitor-title">🛠️ DEV MONITOR</span>
        <div className="dev-monitor-toolbar">
          <span className="dev-monitor-count">{filteredLogs.length}/{apiLogs.length}</span>
          <button className="btn-icon btn-small" onClick={clearApiLogs} title="清空日志">🗑️</button>
        </div>
      </div>

      {/* Filters */}
      <div className="dev-monitor-filters">
        <input
          type="text"
          className="dev-monitor-filter-input"
          value={filterUrl}
          onChange={(e) => setFilterUrl(e.target.value)}
          placeholder="过滤URL..."
        />
        <select
          className="dev-monitor-filter-select"
          value={filterMethod}
          onChange={(e) => setFilterMethod(e.target.value)}
        >
          <option value="">方法</option>
          {methods.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select
          className="dev-monitor-filter-select"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">状态</option>
          {statuses.map((s) => (
            <option key={s} value={String(s)}>{s}</option>
          ))}
        </select>
        {hasFilters && (
          <button className="btn-icon btn-small" onClick={clearFilters} title="清除过滤">✕</button>
        )}
      </div>

      {/* Log List */}
      <div className="dev-monitor-list">
        {filteredLogs.length === 0 && (
          <div className="dev-monitor-empty">
            {apiLogs.length === 0
              ? '暂无API调用记录，发送请求后将自动捕获'
              : '没有匹配过滤条件的记录'}
          </div>
        )}
        {[...filteredLogs].reverse().map((log) => (
          <details key={log.id} className="dev-monitor-entry">
            <summary className={`dev-monitor-summary ${log.error ? 'error' : ''}`}>
              <span className={`dev-monitor-method method-${log.method}`}>{log.method}</span>
              <span className="dev-monitor-url" title={log.url}>
                {log.url?.replace(/^https?:\/\/[^/]+/, '') || log.url}
              </span>
              {log.status && (
                <span className={`dev-monitor-status ${log.status >= 400 ? 'error' : 'ok'}`}>
                  {log.status}
                </span>
              )}
              {log.duration != null && (
                <span className="dev-monitor-duration">{log.duration}ms</span>
              )}
              <span className="dev-monitor-time">
                {log.timestamp?.split('T')[1]?.slice(0, 8) || ''}
              </span>
            </summary>
            <div className="dev-monitor-detail">
              {log.request && (
                <div className="dev-monitor-section">
                  <label>📤 请求内容</label>
                  <pre className="dev-monitor-pre">
                    {typeof log.request === 'string' ? log.request : JSON.stringify(log.request, null, 2)}
                  </pre>
                </div>
              )}
              {log.response && (
                <div className="dev-monitor-section">
                  <label>📥 返回内容</label>
                  <pre className="dev-monitor-pre">
                    {typeof log.response === 'string' ? log.response : JSON.stringify(log.response, null, 2)}
                  </pre>
                </div>
              )}
              {log.error && (
                <div className="dev-monitor-section">
                  <label>❌ 错误</label>
                  <pre className="dev-monitor-pre dev-monitor-error">{log.error}</pre>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
