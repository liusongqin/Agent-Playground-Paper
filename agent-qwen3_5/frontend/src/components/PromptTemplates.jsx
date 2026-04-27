import { useState } from 'react';

const BUILT_IN_TEMPLATES = [
  {
    id: 'explain-code',
    name: 'Explain Code',
    icon: '💡',
    description: 'Get a clear explanation of code',
    prompt: 'Please explain the following code in detail. Break down what each part does, why it\'s written this way, and any important patterns or concepts used:\n\n```\n[paste your code here]\n```',
    category: 'Development',
  },
  {
    id: 'code-review',
    name: 'Code Review',
    icon: '🔍',
    description: 'Get a thorough code review',
    prompt: 'Please review the following code. Check for:\n- Bugs and potential issues\n- Performance improvements\n- Code style and readability\n- Security vulnerabilities\n- Best practices\n\n```\n[paste your code here]\n```',
    category: 'Development',
  },
  {
    id: 'write-tests',
    name: 'Write Tests',
    icon: '🧪',
    description: 'Generate unit tests for code',
    prompt: 'Please write comprehensive unit tests for the following code. Include edge cases, happy paths, and error scenarios:\n\n```\n[paste your code here]\n```',
    category: 'Development',
  },
  {
    id: 'refactor',
    name: 'Refactor Code',
    icon: '♻️',
    description: 'Refactor and improve code quality',
    prompt: 'Please refactor the following code to improve readability, maintainability, and performance while keeping the same functionality:\n\n```\n[paste your code here]\n```',
    category: 'Development',
  },
  {
    id: 'debug-error',
    name: 'Debug Error',
    icon: '🐛',
    description: 'Help debug an error message',
    prompt: 'I\'m getting the following error. Please help me understand what\'s wrong and how to fix it:\n\nError message:\n```\n[paste error here]\n```\n\nRelevant code:\n```\n[paste code here]\n```',
    category: 'Development',
  },
  {
    id: 'translate-text',
    name: 'Translate',
    icon: '🌍',
    description: 'Translate text between languages',
    prompt: 'Please translate the following text from [source language] to [target language]. Maintain the original tone and meaning:\n\n[paste text here]',
    category: 'Language',
  },
  {
    id: 'summarize',
    name: 'Summarize',
    icon: '📝',
    description: 'Summarize long text concisely',
    prompt: 'Please provide a concise summary of the following text. Include the key points and main takeaways:\n\n[paste text here]',
    category: 'Writing',
  },
  {
    id: 'email-draft',
    name: 'Draft Email',
    icon: '📧',
    description: 'Draft a professional email',
    prompt: 'Please draft a professional email with the following details:\n- To: [recipient]\n- Subject: [subject]\n- Purpose: [purpose/key points]\n- Tone: [formal/casual/friendly]',
    category: 'Writing',
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm Ideas',
    icon: '🧠',
    description: 'Generate creative ideas for a topic',
    prompt: 'Please brainstorm 10 creative ideas for the following topic. For each idea, provide a brief description and potential benefits:\n\nTopic: [your topic here]',
    category: 'Creative',
  },
  {
    id: 'write-readme',
    name: 'Write README',
    icon: '📖',
    description: 'Generate a project README',
    prompt: 'Please generate a comprehensive README.md for my project with the following details:\n- Project name: [name]\n- Description: [description]\n- Tech stack: [technologies]\n- Key features: [features]\n\nInclude sections for installation, usage, API reference, contributing, and license.',
    category: 'Development',
  },
  {
    id: 'sql-query',
    name: 'Write SQL Query',
    icon: '🗃️',
    description: 'Generate SQL queries from description',
    prompt: 'Please write an SQL query to accomplish the following:\n\nDatabase tables:\n```\n[describe your tables and columns]\n```\n\nWhat I need:\n[describe the data you want to retrieve/modify]',
    category: 'Development',
  },
  {
    id: 'regex-helper',
    name: 'Regex Helper',
    icon: '🔤',
    description: 'Create or explain regex patterns',
    prompt: 'Please help me with a regular expression:\n\nWhat I need to match: [describe the pattern]\n\nExamples of text that should match:\n- [example 1]\n- [example 2]\n\nExamples that should NOT match:\n- [example 1]\n- [example 2]',
    category: 'Development',
  },
];

const TEMPLATE_CATEGORIES = [...new Set(BUILT_IN_TEMPLATES.map((t) => t.category))];

export default function PromptTemplates({ onUseTemplate, customTemplates, onAddTemplate, onDeleteTemplate, onUpdateTemplate }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [editTemplate, setEditTemplate] = useState(null);
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    icon: '📝',
    description: '',
    prompt: '',
    category: 'Custom',
  });

  const allTemplates = [...BUILT_IN_TEMPLATES, ...customTemplates];

  const filteredTemplates = allTemplates.filter((t) => {
    const matchesSearch =
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory =
      selectedCategory === 'All' || t.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const allCategories = ['All', ...TEMPLATE_CATEGORIES, ...(customTemplates.length > 0 ? ['Custom'] : [])];

  const handleAddTemplate = () => {
    if (!newTemplate.name.trim() || !newTemplate.prompt.trim()) return;
    onAddTemplate({
      ...newTemplate,
      id: 'custom-' + crypto.randomUUID(),
    });
    setNewTemplate({ name: '', icon: '📝', description: '', prompt: '', category: 'Custom' });
    setShowAddForm(false);
  };

  const handleStartEdit = (template) => {
    setEditingTemplateId(template.id);
    setEditTemplate({ ...template });
  };

  const handleSaveEdit = () => {
    if (!editTemplate || !editTemplate.name.trim() || !editTemplate.prompt.trim()) return;
    if (onUpdateTemplate) {
      onUpdateTemplate(editTemplate);
    }
    setEditingTemplateId(null);
    setEditTemplate(null);
  };

  const handleCancelEdit = () => {
    setEditingTemplateId(null);
    setEditTemplate(null);
  };

  return (
    <div className="prompt-templates">
      <div className="prompt-templates-header">
        <span className="prompt-templates-title">TEMPLATES</span>
        <button
          className="btn-icon"
          onClick={() => setShowAddForm(!showAddForm)}
          title="Add Custom Template"
        >
          ➕
        </button>
      </div>

      <div className="template-search">
        <input
          type="text"
          className="template-search-input"
          placeholder="Search templates..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="template-categories">
        {allCategories.map((cat) => (
          <button
            key={cat}
            className={`template-category-btn ${selectedCategory === cat ? 'active' : ''}`}
            onClick={() => setSelectedCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {showAddForm && (
        <div className="template-add-form">
          <div className="form-group">
            <label>Name</label>
            <input
              type="text"
              value={newTemplate.name}
              onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
              placeholder="Template name"
            />
          </div>
          <div className="form-group">
            <label>Icon (emoji)</label>
            <input
              type="text"
              value={newTemplate.icon}
              onChange={(e) => setNewTemplate({ ...newTemplate, icon: e.target.value })}
              placeholder="📝"
              maxLength={4}
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <input
              type="text"
              value={newTemplate.description}
              onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
              placeholder="What is this template for?"
            />
          </div>
          <div className="form-group">
            <label>Prompt Template</label>
            <textarea
              value={newTemplate.prompt}
              onChange={(e) => setNewTemplate({ ...newTemplate, prompt: e.target.value })}
              placeholder="Enter the prompt template..."
              rows={4}
            />
          </div>
          <div className="template-add-actions">
            <button className="btn-secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleAddTemplate}>Add Template</button>
          </div>
        </div>
      )}

      <div className="prompt-templates-body">
        {filteredTemplates.map((template) => (
          <div key={template.id}>
            {editingTemplateId === template.id && editTemplate ? (
              <div className="template-add-form template-edit-form">
                <div className="form-group">
                  <label>Name</label>
                  <input
                    type="text"
                    value={editTemplate.name}
                    onChange={(e) => setEditTemplate({ ...editTemplate, name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Icon</label>
                  <input
                    type="text"
                    value={editTemplate.icon}
                    onChange={(e) => setEditTemplate({ ...editTemplate, icon: e.target.value })}
                    maxLength={4}
                  />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <input
                    type="text"
                    value={editTemplate.description}
                    onChange={(e) => setEditTemplate({ ...editTemplate, description: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Prompt</label>
                  <textarea
                    value={editTemplate.prompt}
                    onChange={(e) => setEditTemplate({ ...editTemplate, prompt: e.target.value })}
                    rows={4}
                  />
                </div>
                <div className="template-add-actions">
                  <button className="btn-secondary" onClick={handleCancelEdit}>Cancel</button>
                  <button className="btn-primary" onClick={handleSaveEdit}>Save</button>
                </div>
              </div>
            ) : (
              <div
                className="template-card"
                onClick={() => onUseTemplate(template)}
              >
                <div className="template-card-icon">{template.icon}</div>
                <div className="template-card-info">
                  <div className="template-card-name">{template.name}</div>
                  <div className="template-card-desc">{template.description}</div>
                </div>
                <div className="template-card-actions">
                  <button
                    className="btn-use-template"
                    onClick={(e) => { e.stopPropagation(); onUseTemplate(template); }}
                    title="Use this template"
                  >
                    Use
                  </button>
                  {template.id.startsWith('custom-') && (
                    <>
                      <button
                        className="btn-icon"
                        onClick={(e) => { e.stopPropagation(); handleStartEdit(template); }}
                        title="Edit"
                      >
                        ✏️
                      </button>
                      <button
                        className="btn-icon"
                        onClick={(e) => { e.stopPropagation(); onDeleteTemplate(template.id); }}
                        title="Delete"
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

        {filteredTemplates.length === 0 && (
          <div className="template-empty">
            <p>No templates found matching your search.</p>
          </div>
        )}
      </div>
    </div>
  );
}
