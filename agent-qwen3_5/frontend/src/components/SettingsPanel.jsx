import { useState, useMemo } from 'react';
import { DEFAULT_AGENT_INSTRUCTIONS, buildAgentSystemPrompt } from '../utils/agentActions';
import { BUILT_IN_SKILLS } from '../utils/skills';

export default function SettingsPanel({ settings, onSettingsChange, onClose }) {
  const [localSettings, setLocalSettings] = useState({ ...settings });
  const [showApiKey, setShowApiKey] = useState(false);
  const [showDefaultPrompt, setShowDefaultPrompt] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState('general');

  const handleChange = (key, value) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSettingsChange(localSettings);
    onClose();
  };

  const handleReset = () => {
    setLocalSettings({
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'Qwen3.5-0.8B',
      systemPrompt: '你是一个有用的AI助手。请使用中文回答问题。',
      temperature: 0.1,
      maxTokens: 1024,
      topP: 1.0,
      presencePenalty: 2.0,
      topK: 20,
      stream: true,
      chatMode: 'ask',
      agentConfirmBeforeExecute: true,
      customAgentPrompt: '',
      terminalAgentPrompt: '',
      enableThinking: true,
    });
  };

  // Developer options: compute the full prompt that would be sent to the model
  const fullSystemPrompt = useMemo(() => {
    if (localSettings.chatMode === 'agent') {
      return buildAgentSystemPrompt(
        localSettings.systemPrompt,
        settings._agentSkills || [],
        settings._terminalCwd || '(未连接终端)',
        localSettings.customAgentPrompt,
        localSettings.terminalAgentPrompt
      );
    }
    return localSettings.systemPrompt;
  }, [localSettings.chatMode, localSettings.systemPrompt, localSettings.customAgentPrompt, localSettings.terminalAgentPrompt, settings._agentSkills, settings._terminalCwd]);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel settings-panel-wide" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>⚙️ 设置</h2>
          <button className="btn-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Settings tabs */}
        <div className="settings-tabs">
          <button
            className={`settings-tab ${activeSettingsTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveSettingsTab('general')}
          >
            🔧 通用
          </button>
          <button
            className={`settings-tab ${activeSettingsTab === 'model' ? 'active' : ''}`}
            onClick={() => setActiveSettingsTab('model')}
          >
            🧠 模型参数
          </button>
          <button
            className={`settings-tab ${activeSettingsTab === 'agent' ? 'active' : ''}`}
            onClick={() => setActiveSettingsTab('agent')}
          >
            🤖 Agent模式
          </button>
          <button
            className={`settings-tab ${activeSettingsTab === 'developer' ? 'active' : ''}`}
            onClick={() => setActiveSettingsTab('developer')}
          >
            🛠️ 开发者选项
          </button>
        </div>

        <div className="settings-body">
          {/* General Tab */}
          {activeSettingsTab === 'general' && (
            <div className="settings-section">
              <h3>API 配置</h3>

              <div className="form-group">
                <label htmlFor="baseUrl">API Base URL</label>
                <input
                  id="baseUrl"
                  type="text"
                  value={localSettings.baseUrl}
                  onChange={(e) => handleChange('baseUrl', e.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
                <span className="form-hint">
                  支持 OpenAI、Azure 或任何兼容的 API 端点
                </span>
              </div>

              <div className="form-group">
                <label htmlFor="apiKey">API Key</label>
                <div className="input-with-toggle">
                  <input
                    id="apiKey"
                    type={showApiKey ? 'text' : 'password'}
                    value={localSettings.apiKey}
                    onChange={(e) => handleChange('apiKey', e.target.value)}
                    placeholder="sk-..."
                  />
                  <button
                    className="btn-toggle"
                    onClick={() => setShowApiKey(!showApiKey)}
                    type="button"
                  >
                    {showApiKey ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="model">模型</label>
                <input
                  id="model"
                  type="text"
                  value={localSettings.model}
                  onChange={(e) => handleChange('model', e.target.value)}
                  placeholder="Qwen3.5-0.8B"
                />
                <span className="form-hint">
                  例如: gpt-4, Qwen3.5-0.8B, qwen-plus, deepseek-chat
                </span>
              </div>

              <div className="form-group">
                <label htmlFor="systemPrompt">系统提示词</label>
                <textarea
                  id="systemPrompt"
                  value={localSettings.systemPrompt}
                  onChange={(e) => handleChange('systemPrompt', e.target.value)}
                  rows={3}
                  placeholder="你是一个有用的AI助手。"
                />
              </div>

              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={localSettings.stream}
                    onChange={(e) => handleChange('stream', e.target.checked)}
                  />
                  启用流式输出
                </label>
              </div>

              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={localSettings.enableThinking !== false}
                    onChange={(e) => handleChange('enableThinking', e.target.checked)}
                  />
                  启用思考模式
                </label>
                <span className="form-hint">
                  开启后模型会先进行深度思考再回答，关闭后直接回答（代码补全始终关闭思考）
                </span>
              </div>
            </div>
          )}

          {/* Model Parameters Tab */}
          {activeSettingsTab === 'model' && (
            <div className="settings-section">
              <h3>模型参数</h3>

              <div className="form-group">
                <label htmlFor="temperature">
                  Temperature: {localSettings.temperature}
                </label>
                <input
                  id="temperature"
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={localSettings.temperature}
                  onChange={(e) =>
                    handleChange('temperature', parseFloat(e.target.value))
                  }
                />
                <div className="range-labels">
                  <span>精确 (0)</span>
                  <span>创意 (2)</span>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="maxTokens">Max Tokens: {localSettings.maxTokens}</label>
                <input
                  id="maxTokens"
                  type="range"
                  min="256"
                  max="32768"
                  step="256"
                  value={localSettings.maxTokens}
                  onChange={(e) =>
                    handleChange('maxTokens', parseInt(e.target.value))
                  }
                />
                <div className="range-labels">
                  <span>256</span>
                  <span>32768</span>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="topP">
                  Top P: {localSettings.topP ?? 1.0}
                </label>
                <input
                  id="topP"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={localSettings.topP ?? 1.0}
                  onChange={(e) =>
                    handleChange('topP', parseFloat(e.target.value))
                  }
                />
                <div className="range-labels">
                  <span>集中 (0)</span>
                  <span>多样 (1)</span>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="presencePenalty">
                  Presence Penalty: {localSettings.presencePenalty ?? 0}
                </label>
                <input
                  id="presencePenalty"
                  type="range"
                  min="-2"
                  max="2"
                  step="0.1"
                  value={localSettings.presencePenalty ?? 0}
                  onChange={(e) =>
                    handleChange('presencePenalty', parseFloat(e.target.value))
                  }
                />
                <div className="range-labels">
                  <span>允许重复 (-2)</span>
                  <span>避免重复 (2)</span>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="topK">
                  Top K: {localSettings.topK ?? 20}
                </label>
                <input
                  id="topK"
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  value={localSettings.topK ?? 20}
                  onChange={(e) =>
                    handleChange('topK', parseInt(e.target.value))
                  }
                />
                <div className="range-labels">
                  <span>精确 (1)</span>
                  <span>多样 (100)</span>
                </div>
              </div>

              <div className="form-hint" style={{ marginTop: 12, padding: '8px 12px', background: '#1e1e1e', borderRadius: 4 }}>
                <strong>参考配置 (Qwen3.5-0.8B):</strong><br />
                temperature=0.1, max_tokens=1024, top_p=1.0, presence_penalty=2.0, top_k=20
              </div>
            </div>
          )}

          {/* Agent Mode Tab */}
          {activeSettingsTab === 'agent' && (
            <div className="settings-section">
              <h3>Agent 模式设置</h3>

              <div className="form-group">
                <label>聊天模式</label>
                <div className="mode-select-group">
                  <button
                    className={`mode-select-btn ${localSettings.chatMode === 'ask' ? 'active' : ''}`}
                    onClick={() => handleChange('chatMode', 'ask')}
                    type="button"
                  >
                    💬 问答
                  </button>
                  <button
                    className={`mode-select-btn ${localSettings.chatMode === 'agent' ? 'active' : ''}`}
                    onClick={() => handleChange('chatMode', 'agent')}
                    type="button"
                  >
                    🤖 Agent
                  </button>
                </div>
                <span className="form-hint">
                  问答模式：普通对话。Agent模式：模型可通过终端执行操作。
                </span>
              </div>

              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={localSettings.agentConfirmBeforeExecute !== false}
                    onChange={(e) => handleChange('agentConfirmBeforeExecute', e.target.checked)}
                  />
                  执行前确认
                </label>
                <span className="form-hint">
                  启用后，每个操作在终端执行前需要你的确认。
                </span>
              </div>

              <div className="form-group">
                <label>
                  终端Agent默认指令
                  <button
                    className="btn-toggle"
                    onClick={() => setShowDefaultPrompt(!showDefaultPrompt)}
                    type="button"
                    style={{ marginLeft: 8, fontSize: 11 }}
                  >
                    {showDefaultPrompt ? '▾ 收起' : '▸ 展开'}
                  </button>
                </label>
                {showDefaultPrompt && (
                  <textarea
                    value={localSettings.terminalAgentPrompt || ''}
                    onChange={(e) => handleChange('terminalAgentPrompt', e.target.value)}
                    rows={8}
                    placeholder={DEFAULT_AGENT_INSTRUCTIONS}
                  />
                )}
                <span className="form-hint">
                  自定义终端Agent的默认指令。留空则使用内置指令。
                </span>
              </div>

              <div className="form-group">
                <label htmlFor="customAgentPrompt">自定义 Agent 提示词</label>
                <textarea
                  id="customAgentPrompt"
                  value={localSettings.customAgentPrompt || ''}
                  onChange={(e) => handleChange('customAgentPrompt', e.target.value)}
                  rows={3}
                  placeholder="添加自定义的Agent指令..."
                />
                <span className="form-hint">
                  附加在Agent提示词后的自定义指令，用于定制Agent行为。
                </span>
              </div>
            </div>
          )}

          {/* Developer Options Tab - Agent Prompt Management */}
          {activeSettingsTab === 'developer' && (
            <div className="settings-section">
              <h3>🛠️ Agent提示词管理</h3>
              <span className="form-hint" style={{ display: 'block', marginBottom: 12 }}>
                显示和管理不同Agent的提示词，方便调试与优化。
              </span>

              <div className="form-group">
                <label>
                  当前模式：{localSettings.chatMode === 'agent' ? '🤖 Agent模式' : '💬 问答模式'}
                </label>
              </div>

              <div className="form-group">
                <label>💬 基础系统提示词</label>
                <textarea
                  value={localSettings.systemPrompt}
                  onChange={(e) => handleChange('systemPrompt', e.target.value)}
                  rows={3}
                  placeholder="你是一个有用的AI助手。"
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
                <span className="form-hint">所有模式下使用的基础系统提示词</span>
              </div>

              <div className="form-group">
                <label>🤖 Agent自定义提示词</label>
                <textarea
                  value={localSettings.customAgentPrompt || ''}
                  onChange={(e) => handleChange('customAgentPrompt', e.target.value)}
                  rows={4}
                  placeholder="附加在Agent提示词后的自定义指令..."
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
                <span className="form-hint">Agent模式下附加的自定义指令</span>
              </div>

              <div className="form-group">
                <label>🖥️ 终端Agent提示词</label>
                <textarea
                  value={localSettings.terminalAgentPrompt || ''}
                  onChange={(e) => handleChange('terminalAgentPrompt', e.target.value)}
                  rows={4}
                  placeholder={DEFAULT_AGENT_INSTRUCTIONS}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
                <span className="form-hint">终端Agent的默认指令，留空使用内置指令</span>
              </div>

              <div className="form-group">
                <label>🔗 FSM Agent提示词</label>
                <textarea
                  value={localSettings.fsmAgentPrompt || ''}
                  onChange={(e) => handleChange('fsmAgentPrompt', e.target.value)}
                  rows={4}
                  placeholder="有限状态机Agent的自定义指令..."
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
                <span className="form-hint">有限状态机Agent的自定义提示词</span>
              </div>

              <div className="form-group">
                <label>📋 当前完整提示词预览（只读）</label>
                <textarea
                  value={fullSystemPrompt}
                  readOnly
                  rows={10}
                  className="readonly-textarea developer-prompt-preview"
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={handleReset}>
            恢复默认
          </button>
          <button className="btn-primary" onClick={handleSave}>
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
}
