import { useState } from 'react';
import { BUILT_IN_SKILLS } from '../utils/skills';

export default function AgentTools({
  skills,
  onAddSkill,
  onDeleteSkill,
  onUpdateSkill,
}) {
  const [showAddSkillForm, setShowAddSkillForm] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState(null);
  const [newSkill, setNewSkill] = useState({
    name: '',
    icon: '🔧',
    description: '',
    command: '',
    params: [{ name: 'input', type: 'string', description: '' }],
    responseFormat: '',
  });
  const [editSkill, setEditSkill] = useState(null);

  const allSkills = [...BUILT_IN_SKILLS, ...(skills || [])];

  const handleAddParam = () => {
    setNewSkill({
      ...newSkill,
      params: [...newSkill.params, { name: '', type: 'string', description: '' }],
    });
  };

  const handleRemoveParam = (index) => {
    setNewSkill({
      ...newSkill,
      params: newSkill.params.filter((_, i) => i !== index),
    });
  };

  const handleUpdateParam = (index, field, value) => {
    const updated = [...newSkill.params];
    updated[index] = { ...updated[index], [field]: value };
    setNewSkill({ ...newSkill, params: updated });
  };

  const handleAddSkill = () => {
    if (!newSkill.name.trim() || !newSkill.command.trim()) return;
    const validParams = newSkill.params.filter((p) => p.name.trim());
    onAddSkill({
      name: newSkill.name,
      icon: newSkill.icon,
      description: newSkill.description,
      id: `custom-skill-${crypto.randomUUID()}`,
      params: validParams.length > 0 ? validParams : [{ name: 'input', type: 'string', description: 'Input for the command' }],
      toCommand: null,
      commandTemplate: newSkill.command,
      responseFormat: newSkill.responseFormat || '',
    });
    setNewSkill({
      name: '',
      icon: '🔧',
      description: '',
      command: '',
      params: [{ name: 'input', type: 'string', description: '' }],
      responseFormat: '',
    });
    setShowAddSkillForm(false);
  };

  const handleStartEditSkill = (skill) => {
    setEditingSkillId(skill.id);
    setEditSkill({
      ...skill,
      command: skill.commandTemplate || '',
      params: skill.params || [{ name: 'input', type: 'string', description: '' }],
      responseFormat: skill.responseFormat || '',
    });
  };

  const handleEditAddParam = () => {
    setEditSkill({
      ...editSkill,
      params: [...(editSkill.params || []), { name: '', type: 'string', description: '' }],
    });
  };

  const handleEditRemoveParam = (index) => {
    setEditSkill({
      ...editSkill,
      params: editSkill.params.filter((_, i) => i !== index),
    });
  };

  const handleEditUpdateParam = (index, field, value) => {
    const updated = [...editSkill.params];
    updated[index] = { ...updated[index], [field]: value };
    setEditSkill({ ...editSkill, params: updated });
  };

  const handleSaveEditSkill = () => {
    if (!editSkill || !editSkill.name.trim()) return;
    const validParams = (editSkill.params || []).filter((p) => p.name.trim());
    if (onUpdateSkill) {
      onUpdateSkill({
        ...editSkill,
        commandTemplate: editSkill.command,
        params: validParams.length > 0 ? validParams : editSkill.params,
        responseFormat: editSkill.responseFormat || '',
      });
    }
    setEditingSkillId(null);
    setEditSkill(null);
  };

  const handleCancelEditSkill = () => {
    setEditingSkillId(null);
    setEditSkill(null);
  };

  const generateFormatPreview = (skill) => {
    const params = (skill.params || []).reduce((acc, p) => {
      acc[p.name] = p.type === 'string' ? `<${p.description || p.name}>` : `<${p.type}>`;
      return acc;
    }, {});
    return JSON.stringify({ action: skill.id || skill.name, params }, null, 2);
  };

  return (
    <div className="agent-tools">
      <div className="agent-tools-header">
        <span className="agent-tools-title">⚡ 技能管理</span>
        <span className="form-hint">设计模型可操作的接口函数</span>
      </div>

      <div className="agent-tools-subheader">
        <span className="skills-hint">定义终端指令和模型返回格式</span>
        <button
          className="btn-icon"
          onClick={() => setShowAddSkillForm(!showAddSkillForm)}
          title="添加自定义技能"
        >
          ➕
        </button>
      </div>

      {showAddSkillForm && (
        <div className="agent-add-form skill-design-form">
          <div className="form-group">
            <label>技能名称</label>
            <input
              type="text"
              value={newSkill.name}
              onChange={(e) => setNewSkill({ ...newSkill, name: e.target.value })}
              placeholder="例如: deploy-service"
            />
          </div>
          <div className="form-group">
            <label>图标 (emoji)</label>
            <input
              type="text"
              value={newSkill.icon}
              onChange={(e) => setNewSkill({ ...newSkill, icon: e.target.value })}
              placeholder="🔧"
              maxLength={4}
            />
          </div>
          <div className="form-group">
            <label>描述</label>
            <input
              type="text"
              value={newSkill.description}
              onChange={(e) => setNewSkill({ ...newSkill, description: e.target.value })}
              placeholder="这个技能做什么？"
            />
          </div>

          <div className="form-group">
            <label>参数定义</label>
            <div className="skill-params-editor">
              {newSkill.params.map((param, i) => (
                <div key={i} className="skill-param-row">
                  <input
                    type="text"
                    value={param.name}
                    onChange={(e) => handleUpdateParam(i, 'name', e.target.value)}
                    placeholder="参数名"
                    className="skill-param-name"
                  />
                  <select
                    value={param.type}
                    onChange={(e) => handleUpdateParam(i, 'type', e.target.value)}
                    className="skill-param-type"
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="path">path</option>
                  </select>
                  <input
                    type="text"
                    value={param.description}
                    onChange={(e) => handleUpdateParam(i, 'description', e.target.value)}
                    placeholder="参数描述"
                    className="skill-param-desc"
                  />
                  <button className="btn-icon" onClick={() => handleRemoveParam(i)} title="删除参数">✕</button>
                </div>
              ))}
              <button className="btn-secondary btn-small" onClick={handleAddParam}>+ 添加参数</button>
            </div>
          </div>

          <div className="form-group">
            <label>终端指令模板</label>
            <input
              type="text"
              value={newSkill.command}
              onChange={(e) => setNewSkill({ ...newSkill, command: e.target.value })}
              placeholder={`例如: docker deploy {{input}}`}
            />
            <span className="form-hint">使用 {'{{参数名}}'} 作为参数占位符</span>
          </div>

          <div className="form-group">
            <label>模型返回格式说明（可选）</label>
            <textarea
              value={newSkill.responseFormat}
              onChange={(e) => setNewSkill({ ...newSkill, responseFormat: e.target.value })}
              placeholder="告诉模型应该返回什么格式的结果..."
              rows={2}
            />
          </div>

          <div className="form-group">
            <label>模型调用格式预览</label>
            <pre className="skill-format-preview">
              {generateFormatPreview(newSkill)}
            </pre>
          </div>

          <div className="agent-add-actions">
            <button className="btn-secondary" onClick={() => setShowAddSkillForm(false)}>取消</button>
            <button className="btn-primary" onClick={handleAddSkill}>添加技能</button>
          </div>
        </div>
      )}

      <div className="agent-tools-body">
        {allSkills.map((skill) => (
          <div key={skill.id}>
            {editingSkillId === skill.id && editSkill ? (
              <div className="agent-add-form skill-design-form agent-edit-form">
                <div className="form-group">
                  <label>技能名称</label>
                  <input
                    type="text"
                    value={editSkill.name}
                    onChange={(e) => setEditSkill({ ...editSkill, name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>图标</label>
                  <input
                    type="text"
                    value={editSkill.icon}
                    onChange={(e) => setEditSkill({ ...editSkill, icon: e.target.value })}
                    maxLength={4}
                  />
                </div>
                <div className="form-group">
                  <label>描述</label>
                  <input
                    type="text"
                    value={editSkill.description}
                    onChange={(e) => setEditSkill({ ...editSkill, description: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>参数定义</label>
                  <div className="skill-params-editor">
                    {(editSkill.params || []).map((param, i) => (
                      <div key={i} className="skill-param-row">
                        <input
                          type="text"
                          value={param.name}
                          onChange={(e) => handleEditUpdateParam(i, 'name', e.target.value)}
                          placeholder="参数名"
                          className="skill-param-name"
                        />
                        <select
                          value={param.type}
                          onChange={(e) => handleEditUpdateParam(i, 'type', e.target.value)}
                          className="skill-param-type"
                        >
                          <option value="string">string</option>
                          <option value="number">number</option>
                          <option value="boolean">boolean</option>
                          <option value="path">path</option>
                        </select>
                        <input
                          type="text"
                          value={param.description}
                          onChange={(e) => handleEditUpdateParam(i, 'description', e.target.value)}
                          placeholder="参数描述"
                          className="skill-param-desc"
                        />
                        <button className="btn-icon" onClick={() => handleEditRemoveParam(i)} title="删除参数">✕</button>
                      </div>
                    ))}
                    <button className="btn-secondary btn-small" onClick={handleEditAddParam}>+ 添加参数</button>
                  </div>
                </div>

                <div className="form-group">
                  <label>终端指令模板</label>
                  <input
                    type="text"
                    value={editSkill.command}
                    onChange={(e) => setEditSkill({ ...editSkill, command: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>模型返回格式说明</label>
                  <textarea
                    value={editSkill.responseFormat || ''}
                    onChange={(e) => setEditSkill({ ...editSkill, responseFormat: e.target.value })}
                    rows={2}
                  />
                </div>

                <div className="form-group">
                  <label>格式预览</label>
                  <pre className="skill-format-preview">
                    {generateFormatPreview(editSkill)}
                  </pre>
                </div>

                <div className="agent-add-actions">
                  <button className="btn-secondary" onClick={handleCancelEditSkill}>取消</button>
                  <button className="btn-primary" onClick={handleSaveEditSkill}>保存</button>
                </div>
              </div>
            ) : (
              <div className="agent-card skill-card">
                <div className="agent-card-icon">{skill.icon}</div>
                <div className="agent-card-info">
                  <div className="agent-card-name">{skill.name || skill.id}</div>
                  <div className="agent-card-desc">{skill.description}</div>
                  {skill.params && (
                    <div className="skill-card-params">
                      {skill.params.map((p) => (
                        <span key={p.name} className="skill-param-badge">{p.name}: {p.type}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="agent-card-actions">
                  {skill.id.startsWith('custom-skill-') && (
                    <>
                      <button
                        className="btn-icon"
                        onClick={() => handleStartEditSkill(skill)}
                        title="编辑技能"
                      >
                        ✏️
                      </button>
                      <button
                        className="btn-icon"
                        onClick={() => onDeleteSkill(skill.id)}
                        title="删除技能"
                      >
                        🗑️
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
