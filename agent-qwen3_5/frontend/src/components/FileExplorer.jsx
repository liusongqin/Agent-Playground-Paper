import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ADB_URL_STORAGE_KEY = 'agent-chat-adb-url';
const DEFAULT_ADB_URL = 'http://localhost:8080';

function getServerUrl() {
  try {
    return localStorage.getItem(ADB_URL_STORAGE_KEY) || DEFAULT_ADB_URL;
  } catch {
    return DEFAULT_ADB_URL;
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const icons = {
    js: '📜', jsx: '⚛️', ts: '📘', tsx: '⚛️',
    py: '🐍', java: '☕', go: '🔵', rs: '🦀',
    html: '🌐', css: '🎨', scss: '🎨', less: '🎨',
    json: '📋', xml: '📋', yaml: '📋', yml: '📋', toml: '📋',
    md: '📝', txt: '📄', csv: '📊', pdf: '📕',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    zip: '📦', tar: '📦', gz: '📦',
    sh: '🔧', bash: '🔧', env: '🔐',
    doc: '📘', docx: '📘', xls: '📊', xlsx: '📊', ppt: '📙', pptx: '📙',
  };
  return icons[ext] || '📄';
}

function getFolderIcon(expanded) {
  return expanded ? '📂' : '📁';
}

function buildTree(files) {
  const root = { name: 'root', type: 'folder', children: {}, files: [] };

  for (const file of files) {
    const parts = file.path ? file.path.split('/') : [file.name];
    let current = root;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!current.children[parts[i]]) {
        current.children[parts[i]] = { name: parts[i], type: 'folder', children: {}, files: [] };
      }
      current = current.children[parts[i]];
    }
    current.files.push(file);
  }

  return root;
}

function TreeNode({ node, depth, onSelect, onDelete, selectedId }) {
  const [expanded, setExpanded] = useState(depth < 2);

  const folders = Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      {folders.map((folder) => (
        <div key={folder.name}>
          <div
            className="file-tree-item folder"
            style={{ paddingLeft: depth * 16 + 8 }}
            onClick={() => setExpanded(!expanded)}
          >
            <span className="file-tree-arrow">{expanded ? '▾' : '▸'}</span>
            <span className="file-tree-icon">{getFolderIcon(expanded)}</span>
            <span className="file-tree-name">{folder.name}</span>
          </div>
          {expanded && (
            <TreeNode
              node={folder}
              depth={depth + 1}
              onSelect={onSelect}
              onDelete={onDelete}
              selectedId={selectedId}
            />
          )}
        </div>
      ))}
      {files.map((file) => (
        <div
          key={file.id}
          className={`file-tree-item file ${selectedId === file.id ? 'selected' : ''}`}
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => onSelect(file)}
        >
          <span className="file-tree-arrow" style={{ visibility: 'hidden' }}>▸</span>
          <span className="file-tree-icon">{getFileIcon(file.name)}</span>
          <span className="file-tree-name">{file.name}</span>
          <span className="file-tree-size">{formatSize(file.size)}</span>
          <div className="file-tree-actions">
            <button
              className="btn-icon"
              onClick={(e) => { e.stopPropagation(); onDelete(file.id); }}
              title="Delete"
            >
              🗑️
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

/* Context menu component for right-click actions */
function ContextMenu({ x, y, items, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ position: 'fixed', left: x, top: y, zIndex: 9999 }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <div
            key={i}
            className="context-menu-item"
            onClick={() => { item.onClick(); onClose(); }}
          >
            <span className="context-menu-icon">{item.icon}</span>
            <span className="context-menu-label">{item.label}</span>
          </div>
        )
      )}
    </div>
  );
}

/* Displays server filesystem entries for a given CWD */
function ServerFileList({ entries, cwd, onNavigate, onFileClick, activeFilePath, onContextMenu }) {
  // Sort: folders first, then files, each group sorted alphabetically
  const sortedEntries = useMemo(() => [...entries].sort((a, b) => {
    if (a.type === 'folder' && b.type !== 'folder') return -1;
    if (a.type !== 'folder' && b.type === 'folder') return 1;
    return a.name.localeCompare(b.name);
  }), [entries]);

  return (
    <div className="file-tree">
      {cwd !== '/' && (
        <div
          className="file-tree-item folder"
          style={{ paddingLeft: 8 }}
          onClick={() => {
            const parent = cwd.replace(/\/[^/]+\/?$/, '') || '/';
            onNavigate(parent);
          }}
        >
          <span className="file-tree-arrow">▸</span>
          <span className="file-tree-icon">📂</span>
          <span className="file-tree-name">..</span>
        </div>
      )}
      {sortedEntries.map((entry) => {
        const fullPath = cwd.replace(/\/$/, '') + '/' + entry.name;
        return (
          <div
            key={entry.name}
            className={`file-tree-item ${entry.type}${entry.type === 'file' && activeFilePath === fullPath ? ' selected' : ''}`}
            style={{ paddingLeft: 8 }}
            onClick={() => {
              if (entry.type === 'folder') {
                onNavigate(fullPath);
              } else {
                onFileClick(fullPath, entry.name);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onContextMenu(e, fullPath, entry);
            }}
          >
            <span className="file-tree-arrow" style={{ visibility: entry.type === 'folder' ? 'visible' : 'hidden' }}>▸</span>
            <span className="file-tree-icon">
              {entry.type === 'folder' ? getFolderIcon(false) : getFileIcon(entry.name)}
            </span>
            <span className="file-tree-name">{entry.name}</span>
            {entry.type === 'file' && (
              <span className="file-tree-size">{formatSize(entry.size)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function FileExplorer({ files, onUpload, onDelete, onSelect, selectedFile, terminalCwd, onFileContentOpen }) {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  // Server filesystem state
  const [serverEntries, setServerEntries] = useState([]);
  const [browsePath, setBrowsePath] = useState(null);
  const [fsError, setFsError] = useState(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState(null);

  const fetchDirListing = useCallback(async (dirPath) => {
    try {
      setFsError(null);
      const serverUrl = getServerUrl();
      const resp = await fetch(`${serverUrl}/api/fs/list?path=${encodeURIComponent(dirPath)}`);
      if (!resp.ok) {
        throw new Error(`Server returned ${resp.status}`);
      }
      const data = await resp.json();
      if (data.error) {
        throw new Error(data.error);
      }
      setServerEntries(data.entries || []);
      setBrowsePath(data.path || dirPath);
    } catch (err) {
      setFsError(err.message);
      setServerEntries([]);
    }
  }, []);

  // Sync with terminal CWD
  useEffect(() => {
    if (terminalCwd) {
      setBrowsePath(terminalCwd);
      fetchDirListing(terminalCwd);
    }
  }, [terminalCwd, fetchDirListing]);

  const handleNavigate = useCallback((path) => {
    setBrowsePath(path);
    fetchDirListing(path);
  }, [fetchDirListing]);

  const handleRefresh = useCallback(() => {
    if (browsePath) {
      fetchDirListing(browsePath);
    }
  }, [browsePath, fetchDirListing]);

  const fetchFileContent = useCallback(async (filePath, fileName) => {
    try {
      const serverUrl = getServerUrl();
      const resp = await fetch(`${serverUrl}/api/fs/read?path=${encodeURIComponent(filePath)}`);
      if (!resp.ok) {
        let errorDetail = resp.statusText;
        try {
          const errData = await resp.json();
          if (errData.error) errorDetail = errData.error;
        } catch { /* ignore */ }
        throw new Error(`请求失败 (${resp.status}): ${errorDetail}`);
      }
      const data = await resp.json();
      if (data.error) {
        throw new Error(data.error);
      }
      if (onFileContentOpen) {
        onFileContentOpen({ path: filePath, name: fileName, content: data.content || '', size: data.size });
      }
    } catch (err) {
      setFsError(err.message);
    }
  }, [onFileContentOpen]);

  // Context menu actions
  const handleNewFile = useCallback(async () => {
    const name = prompt('输入新文件名：');
    if (!name) return;
    const serverUrl = getServerUrl();
    const filePath = (browsePath || '/').replace(/\/$/, '') + '/' + name;
    try {
      const resp = await fetch(`${serverUrl}/api/fs/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      handleRefresh();
    } catch (err) {
      setFsError(err.message);
    }
  }, [browsePath, handleRefresh]);

  const handleNewFolder = useCallback(async () => {
    const name = prompt('输入新文件夹名：');
    if (!name) return;
    const serverUrl = getServerUrl();
    const folderPath = (browsePath || '/').replace(/\/$/, '') + '/' + name;
    try {
      const resp = await fetch(`${serverUrl}/api/fs/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      handleRefresh();
    } catch (err) {
      setFsError(err.message);
    }
  }, [browsePath, handleRefresh]);

  const handleDeleteEntry = useCallback(async (entryPath) => {
    if (!confirm(`确定删除 ${entryPath} 吗？`)) return;
    const serverUrl = getServerUrl();
    try {
      const resp = await fetch(`${serverUrl}/api/fs/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: entryPath }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      handleRefresh();
    } catch (err) {
      setFsError(err.message);
    }
  }, [handleRefresh]);

  const handleRenameEntry = useCallback(async (oldPath) => {
    const oldName = oldPath.split('/').pop();
    const newName = prompt('输入新名称：', oldName);
    if (!newName || newName === oldName) return;
    const serverUrl = getServerUrl();
    const dir = oldPath.replace(/\/[^/]+$/, '');
    const newPath = dir + '/' + newName;
    try {
      const resp = await fetch(`${serverUrl}/api/fs/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      handleRefresh();
    } catch (err) {
      setFsError(err.message);
    }
  }, [handleRefresh]);

  const handleCopyPath = useCallback((path) => {
    navigator.clipboard.writeText(path).catch(() => {});
  }, []);

  const handleContextMenu = useCallback((e, fullPath, entry) => {
    e.preventDefault();
    const items = [];
    if (entry.type === 'file') {
      items.push({ icon: '📄', label: '打开', onClick: () => fetchFileContent(fullPath, entry.name) });
      items.push({ separator: true });
    }
    if (entry.type === 'folder') {
      items.push({ icon: '📂', label: '打开文件夹', onClick: () => handleNavigate(fullPath) });
      items.push({ separator: true });
    }
    items.push({ icon: '✏️', label: '重命名', onClick: () => handleRenameEntry(fullPath) });
    items.push({ icon: '🗑️', label: '删除', onClick: () => handleDeleteEntry(fullPath) });
    items.push({ separator: true });
    items.push({ icon: '📋', label: '复制路径', onClick: () => handleCopyPath(fullPath) });
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, [fetchFileContent, handleNavigate, handleDeleteEntry, handleRenameEntry, handleCopyPath]);

  const handleBackgroundContextMenu = useCallback((e) => {
    e.preventDefault();
    const items = [
      { icon: '📄', label: '新建文件', onClick: handleNewFile },
      { icon: '📁', label: '新建文件夹', onClick: handleNewFolder },
      { separator: true },
      { icon: '🔄', label: '刷新', onClick: handleRefresh },
    ];
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, [handleNewFile, handleNewFolder, handleRefresh]);

  const handleFileUpload = (fileList) => {
    const uploadFiles = Array.from(fileList);
    setUploadError(null);
    uploadFiles.forEach((file) => {
      if (file.size > MAX_FILE_SIZE) {
        setUploadError(`File "${file.name}" exceeds the 50MB size limit`);
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        onUpload({
          id: crypto.randomUUID(),
          name: file.name,
          path: file.webkitRelativePath || file.name,
          size: file.size,
          type: file.type,
          dataUrl: ev.target.result,
          uploadedAt: Date.now(),
        });
      };
      reader.readAsDataURL(file);
    });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFileUpload(e.dataTransfer.files);
  };

  const tree = buildTree(files);

  const showServerFs = !!browsePath;

  return (
    <div className="file-explorer">
      <div className="file-explorer-header">
        <span className="file-explorer-title">EXPLORER</span>
        <div className="file-explorer-actions">
          {showServerFs && (
            <>
              <button className="btn-icon" onClick={handleNewFile} title="新建文件">📄</button>
              <button className="btn-icon" onClick={handleNewFolder} title="新建文件夹">📁</button>
              <button className="btn-icon" onClick={handleRefresh} title="刷新">🔄</button>
            </>
          )}
          <button
            className="btn-icon"
            onClick={() => fileInputRef.current?.click()}
            title="Upload Files"
          >
            ➕
          </button>
        </div>
      </div>

      {showServerFs && (
        <div className="file-explorer-cwd" title={browsePath}>
          📂 {browsePath}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={(e) => handleFileUpload(e.target.files)}
        style={{ display: 'none' }}
      />

      <div
        className={`file-explorer-body ${dragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onContextMenu={showServerFs ? handleBackgroundContextMenu : undefined}
      >
        {uploadError && (
          <div className="file-upload-error">⚠️ {uploadError}</div>
        )}
        {fsError && (
          <div className="file-upload-error">⚠️ {fsError}</div>
        )}
        {showServerFs ? (
          serverEntries.length === 0 && !fsError ? (
            <div className="file-explorer-empty">
              <div className="empty-drop-zone">
                <span className="empty-drop-icon">📂</span>
                <p>空目录（右键新建文件）</p>
              </div>
            </div>
          ) : (
            <ServerFileList
              entries={serverEntries}
              cwd={browsePath}
              onNavigate={handleNavigate}
              onFileClick={fetchFileContent}
              activeFilePath={null}
              onContextMenu={handleContextMenu}
            />
          )
        ) : files.length === 0 ? (
          <div className="file-explorer-empty">
            <div className="empty-drop-zone">
              <span className="empty-drop-icon">📂</span>
              <p>拖拽文件到此处或点击 + 上传</p>
            </div>
          </div>
        ) : (
          <div className="file-tree">
            <TreeNode
              node={tree}
              depth={0}
              onSelect={onSelect}
              onDelete={onDelete}
              selectedId={selectedFile?.id}
            />
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
