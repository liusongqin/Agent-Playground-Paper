import { useState, useEffect } from 'react';
import { fetchModels } from '../services/openai';

export default function ModelManager({ settings, onSettingsChange }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const loadModels = async () => {
    if (!settings.apiKey) {
      setError('Please configure API Key first');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const modelList = await fetchModels(settings);
      setModels(modelList);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (settings.apiKey) {
      loadModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.apiKey, settings.baseUrl]);

  const filteredModels = models.filter((m) =>
    m.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelectModel = (modelId) => {
    onSettingsChange({ ...settings, model: modelId });
  };

  const modelCategories = {
    'GPT Models': filteredModels.filter((m) => m.includes('gpt')),
    'Qwen Models': filteredModels.filter((m) => m.includes('qwen')),
    'DeepSeek Models': filteredModels.filter((m) => m.includes('deepseek')),
    'Embedding Models': filteredModels.filter((m) => m.includes('embed')),
    'Other Models': filteredModels.filter(
      (m) => !m.includes('gpt') && !m.includes('qwen') && !m.includes('deepseek') && !m.includes('embed')
    ),
  };

  return (
    <div className="model-manager">
      <div className="model-manager-header">
        <span className="model-manager-title">MODELS</span>
        <button
          className="btn-icon"
          onClick={loadModels}
          title="Refresh Models"
          disabled={loading}
        >
          🔄
        </button>
      </div>

      <div className="model-manager-current">
        <span className="model-current-label">Current Model</span>
        <span className="model-current-value">📡 {settings.model}</span>
      </div>

      <div className="model-search">
        <input
          type="text"
          className="model-search-input"
          placeholder="Search models..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="model-manager-body">
        {!settings.apiKey && (
          <div className="model-notice">
            ⚠️ Configure API Key to load models
          </div>
        )}

        {error && (
          <div className="model-error">
            ❌ {error}
          </div>
        )}

        {loading && (
          <div className="model-loading">
            <span className="spinner">⏳</span> Loading models...
          </div>
        )}

        {!loading && models.length > 0 && (
          <div className="model-list">
            {Object.entries(modelCategories).map(([category, categoryModels]) => {
              if (categoryModels.length === 0) return null;
              return (
                <div key={category} className="model-category">
                  <div className="model-category-header">{category} ({categoryModels.length})</div>
                  {categoryModels.map((modelId) => (
                    <div
                      key={modelId}
                      className={`model-item ${modelId === settings.model ? 'active' : ''}`}
                      onClick={() => handleSelectModel(modelId)}
                    >
                      <span className="model-item-icon">
                        {modelId === settings.model ? '✅' : '🔲'}
                      </span>
                      <span className="model-item-name">{modelId}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {!loading && !error && models.length === 0 && settings.apiKey && (
          <div className="model-empty">
            <p>No models found. Click 🔄 to refresh.</p>
          </div>
        )}
      </div>

      <div className="model-manager-params">
        <div className="model-params-title">Quick Parameters</div>
        <div className="model-param-row">
          <label>Temperature: {settings.temperature}</label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={settings.temperature}
            onChange={(e) =>
              onSettingsChange({ ...settings, temperature: parseFloat(e.target.value) })
            }
          />
        </div>
        <div className="model-param-row">
          <label>Max Tokens: {settings.maxTokens}</label>
          <input
            type="range"
            min="256"
            max="8192"
            step="256"
            value={settings.maxTokens}
            onChange={(e) =>
              onSettingsChange({ ...settings, maxTokens: parseInt(e.target.value) })
            }
          />
        </div>
        <div className="model-param-row checkbox">
          <label>
            <input
              type="checkbox"
              checked={settings.stream}
              onChange={(e) =>
                onSettingsChange({ ...settings, stream: e.target.checked })
              }
            />
            Stream Response
          </label>
        </div>
      </div>
    </div>
  );
}
