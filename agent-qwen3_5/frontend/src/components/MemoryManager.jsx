import { useState, useCallback } from 'react';

const MEMORY_STORAGE_KEY = 'agent-chat-memories';

function loadMemories() {
  try {
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMemories(memories) {
  localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memories));
}

export default function MemoryManager({ settings, onSettingsChange }) {
  const [memories, setMemories] = useState(loadMemories);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMemory, setNewMemory] = useState({ key: '', value: '', category: '常规' });
  const [editingId, setEditingId] = useState(null);
  const [editMemory, setEditMemory] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const categories = ['常规', '偏好', '上下文', '指令'];

  const handleAdd = useCallback(() => {
    if (!newMemory.key.trim() || !newMemory.value.trim()) return;
    const memory = {
      id: crypto.randomUUID(),
      key: newMemory.key.trim(),
      value: newMemory.value.trim(),
      category: newMemory.category,
      createdAt: new Date().toISOString(),
    };
    const updated = [...memories, memory];
    setMemories(updated);
    saveMemories(updated);
    setNewMemory({ key: '', value: '', category: '常规' });
    setShowAddForm(false);
  }, [newMemory, memories]);

  const handleDelete = useCallback((id) => {
    const updated = memories.filter((m) => m.id !== id);
    setMemories(updated);
    saveMemories(updated);
  }, [memories]);

  const handleStartEdit = useCallback((memory) => {
    setEditingId(memory.id);
    setEditMemory({ ...memory });
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editMemory || !editMemory.key.trim() || !editMemory.value.trim()) return;
    const updated = memories.map((m) => m.id === editMemory.id ? { ...editMemory } : m);
    setMemories(updated);
    saveMemories(updated);
    setEditingId(null);
    setEditMemory(null);
  }, [editMemory, memories]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditMemory(null);
  }, []);

  const handleClearAll = useCallback(() => {
    setMemories([]);
    saveMemories([]);
  }, []);

  // Include memories in agent system prompt
  const handleToggleMemoryInPrompt = useCallback(() => {
    const current = settings.includeMemories !== false;
    onSettingsChange({ ...settings, includeMemories: !current });
  }, [settings, onSettingsChange]);

  const filteredMemories = memories.filter((m) =>
    m.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.value.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.category.includes(searchTerm)
  );

  return (
    <div className="memory-manager-content">
      <div className="memory-controls">
        <label className="memory-toggle">
          <input
            type="checkbox"
            checked={settings.includeMemories !== false}
            onChange={handleToggleMemoryInPrompt}
          />
          <span>在Agent提示词中包含记忆</span>
        </label>
        <div className="memory-actions">
          <button className="btn-icon" onClick={() => setShowAddForm(!showAddForm)} title="添加记忆">➕</button>
          <button className="btn-icon" onClick={handleClearAll} title="清空所有记忆">🗑️</button>
        </div>
      </div>

      <div className="memory-search">
        <input
          type="text"
          placeholder="搜索记忆..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {showAddForm && (
        <div className="memory-add-form">
          <div className="form-group">
            <label>关键字</label>
            <input
              type="text"
              value={newMemory.key}
              onChange={(e) => setNewMemory({ ...newMemory, key: e.target.value })}
              placeholder="记忆标题/关键字"
            />
          </div>
          <div className="form-group">
            <label>内容</label>
            <textarea
              value={newMemory.value}
              onChange={(e) => setNewMemory({ ...newMemory, value: e.target.value })}
              placeholder="记忆内容..."
              rows={3}
            />
          </div>
          <div className="form-group">
            <label>分类</label>
            <select
              value={newMemory.category}
              onChange={(e) => setNewMemory({ ...newMemory, category: e.target.value })}
            >
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="memory-add-actions">
            <button className="btn-secondary" onClick={() => setShowAddForm(false)}>取消</button>
            <button className="btn-primary" onClick={handleAdd}>添加</button>
          </div>
        </div>
      )}

      <div className="memory-list">
        {filteredMemories.length === 0 && (
          <div className="memory-empty">暂无记忆数据</div>
        )}
        {filteredMemories.map((memory) => (
          <div key={memory.id} className="memory-item">
            {editingId === memory.id && editMemory ? (
              <div className="memory-edit-form">
                <input
                  type="text"
                  value={editMemory.key}
                  onChange={(e) => setEditMemory({ ...editMemory, key: e.target.value })}
                />
                <textarea
                  value={editMemory.value}
                  onChange={(e) => setEditMemory({ ...editMemory, value: e.target.value })}
                  rows={2}
                />
                <select
                  value={editMemory.category}
                  onChange={(e) => setEditMemory({ ...editMemory, category: e.target.value })}
                >
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="memory-edit-actions">
                  <button className="btn-secondary" onClick={handleCancelEdit}>取消</button>
                  <button className="btn-primary" onClick={handleSaveEdit}>保存</button>
                </div>
              </div>
            ) : (
              <>
                <div className="memory-item-header">
                  <span className="memory-key">{memory.key}</span>
                  <span className="memory-category-badge">{memory.category}</span>
                </div>
                <div className="memory-value">{memory.value}</div>
                <div className="memory-item-footer">
                  <span className="memory-date">{new Date(memory.createdAt).toLocaleDateString()}</span>
                  <div className="memory-item-actions">
                    <button className="btn-icon" onClick={() => handleStartEdit(memory)} title="编辑">✏️</button>
                    <button className="btn-icon" onClick={() => handleDelete(memory.id)} title="删除">🗑️</button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
