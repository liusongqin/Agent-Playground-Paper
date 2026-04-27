import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import hljs from 'highlight.js';

const ADB_URL_STORAGE_KEY = 'agent-chat-adb-url';
const DEFAULT_ADB_URL = 'http://localhost:8080';
const COMPLETION_DEBOUNCE_MS = 600;

function getServerUrl() {
  try {
    return localStorage.getItem(ADB_URL_STORAGE_KEY) || DEFAULT_ADB_URL;
  } catch {
    return DEFAULT_ADB_URL;
  }
}

function getFileIcon(name) {
  if (!name) return '📄';
  const ext = name.split('.').pop().toLowerCase();
  const icons = {
    js: '📜', jsx: '⚛️', ts: '📘', tsx: '⚛️',
    py: '🐍', java: '☕', go: '🔵', rs: '🦀',
    html: '🌐', css: '🎨', scss: '🎨',
    json: '📋', xml: '📋', yaml: '📋', yml: '📋',
    md: '📝', txt: '📄', sh: '🔧',
  };
  return icons[ext] || '📄';
}

function getLanguageFromName(name) {
  if (!name) return 'text';
  const ext = name.split('.').pop().toLowerCase();
  const langs = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', java: 'java', go: 'go', rs: 'rust',
    html: 'html', css: 'css', scss: 'scss',
    json: 'json', xml: 'xml', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', txt: 'text', sh: 'bash',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  };
  return langs[ext] || 'text';
}

function getHljsLanguage(lang) {
  const map = {
    javascript: 'javascript', typescript: 'typescript',
    python: 'python', java: 'java', go: 'go', rust: 'rust',
    html: 'xml', css: 'css', scss: 'scss',
    json: 'json', xml: 'xml', yaml: 'yaml',
    markdown: 'markdown', bash: 'bash',
    c: 'c', cpp: 'cpp',
  };
  return map[lang] || null;
}

export default function FileEditor({ file, onClose, onRequestCompletion, completionEnabled, onToggleCompletion }) {
  const [content, setContent] = useState(file?.content || '');
  const [completionResult, setCompletionResult] = useState(null);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [dirty, setDirty] = useState(false);
  const textareaRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const gutterRef = useRef(null);
  const prevPathRef = useRef(file?.path);
  const completionTimerRef = useRef(null);
  const completionAbortRef = useRef(null);

  // Update content when file changes (different path)
  if (file?.path !== prevPathRef.current) {
    prevPathRef.current = file?.path;
    setContent(file?.content || '');
    setCompletionResult(null);
    setDirty(false);
    setSaveStatus(null);
  }

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
    };
  }, []);

  // Synchronize gutter scroll with code area scroll
  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = scrollContainerRef.current.scrollTop;
    }
  }, []);

  // Highlighted HTML for the code display layer
  const highlightedHtml = useMemo(() => {
    const lang = getLanguageFromName(file?.name);
    const hljsLang = getHljsLanguage(lang);
    let html;
    try {
      if (hljsLang && hljs.getLanguage(hljsLang)) {
        html = hljs.highlight(content, { language: hljsLang }).value;
      } else {
        html = hljs.highlightAuto(content).value;
      }
    } catch {
      html = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    // Ensure trailing newline so textarea and highlight layer stay aligned
    html += '\n';
    return html;
  }, [content, file?.name]);

  // Auto-trigger completion after typing (debounced)
  const triggerCompletion = useCallback((newContent) => {
    if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
    if (completionAbortRef.current) completionAbortRef.current = true;

    if (!completionEnabled || !onRequestCompletion) return;

    completionTimerRef.current = setTimeout(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPos = textarea.selectionStart;
      if (!newContent || cursorPos === 0) return;
      const lineStart = newContent.lastIndexOf('\n', cursorPos - 1) + 1;
      const currentLine = newContent.slice(lineStart, cursorPos);
      if (!currentLine.trim()) return;

      const textBefore = newContent.slice(Math.max(0, cursorPos - 500), cursorPos);
      const textAfter = newContent.slice(cursorPos, cursorPos + 200);
      const lang = getLanguageFromName(file?.name);

      const abortFlag = { cancelled: false };
      completionAbortRef.current = abortFlag;

      setCompletionLoading(true);
      onRequestCompletion(textBefore, textAfter, lang)
        .then((result) => {
          if (!abortFlag.cancelled && result) {
            setCompletionResult({ text: result, position: cursorPos });
          }
        })
        .catch(() => {
          // ignore completion errors
        })
        .finally(() => {
          if (!abortFlag.cancelled) {
            setCompletionLoading(false);
          }
        });
    }, COMPLETION_DEBOUNCE_MS);
  }, [completionEnabled, onRequestCompletion, file?.name]);

  const handleSave = useCallback(async () => {
    if (!file?.path) return;
    setSaveStatus('saving');
    try {
      const serverUrl = getServerUrl();
      const resp = await fetch(`${serverUrl}/api/fs/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path, content }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setSaveStatus('saved');
      setDirty(false);
      setTimeout(() => setSaveStatus(null), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 3000);
    }
  }, [file?.path, content]);

  const handleKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
      return;
    }

    if (e.key === 'Tab' && completionResult) {
      e.preventDefault();
      const pos = completionResult.position;
      const newContent = content.slice(0, pos) + completionResult.text + content.slice(pos);
      setContent(newContent);
      setCompletionResult(null);
      setDirty(true);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          const newPos = pos + completionResult.text.length;
          textareaRef.current.selectionStart = newPos;
          textareaRef.current.selectionEnd = newPos;
        }
      });
    }

    if (e.key === 'Escape' && completionResult) {
      setCompletionResult(null);
    }
  }, [content, completionResult, handleSave]);

  const handleChange = useCallback((e) => {
    const newContent = e.target.value;
    setContent(newContent);
    setCompletionResult(null);
    setDirty(true);
    triggerCompletion(newContent);
  }, [triggerCompletion]);

  const lineCount = content.split('\n').length;

  if (!file) {
    return (
      <div className="file-editor-empty">
        <div className="file-editor-welcome">
          <h3>📝 编辑器</h3>
          <p>在左侧文件浏览器中选择文件打开</p>
          <div className="file-editor-shortcuts">
            <p><kbd>Ctrl</kbd>+<kbd>S</kbd> 保存文件</p>
            <p>输入时自动触发代码补全</p>
            <p><kbd>Tab</kbd> 接受补全</p>
            <p><kbd>Esc</kbd> 取消补全</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="file-editor">
      <div className="file-editor-tab-bar">
        <div className="file-editor-tab active">
          <span className="file-editor-tab-icon">{getFileIcon(file.name)}</span>
          <span className="file-editor-tab-name">{file.name}{dirty ? ' •' : ''}</span>
          <button
            className="tab-close-btn"
            onClick={onClose}
            title="关闭文件"
          >
            ✕
          </button>
        </div>
        <div className="file-editor-tab-actions">
          <button
            className={`btn-icon completion-toggle ${completionEnabled ? 'active' : ''}`}
            onClick={onToggleCompletion}
            title={completionEnabled ? '关闭代码补全' : '开启代码补全'}
          >
            {completionEnabled ? '🧠' : '💤'}
          </button>
          <button
            className="btn-icon"
            onClick={handleSave}
            disabled={!dirty}
            title="保存 (Ctrl+S)"
          >
            💾
          </button>
          {saveStatus === 'saving' && <span className="save-status">保存中...</span>}
          {saveStatus === 'saved' && <span className="save-status saved">✅ 已保存</span>}
          {saveStatus === 'error' && <span className="save-status error">❌ 保存失败</span>}
        </div>
      </div>
      <div className="file-editor-path-bar">
        <span className="file-editor-path">{file.path}</span>
        <span className="file-editor-lang">{getLanguageFromName(file.name)}</span>
        {completionEnabled && <span className="file-editor-completion-badge">补全已开启</span>}
        {completionLoading && <span className="file-editor-completion-status">⏳ 补全中...</span>}
      </div>
      <div className="file-editor-content">
        {/* Line number gutter - scrolls vertically in sync */}
        <div className="file-editor-gutter" ref={gutterRef}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="file-editor-line-number">{i + 1}</div>
          ))}
        </div>
        {/* Code area with highlight underlay + textarea overlay */}
        <div className="file-editor-code-area" ref={scrollContainerRef} onScroll={handleScroll}>
          <div className="file-editor-code-layers">
            {/* Syntax-highlighted code (read-only display layer) */}
            <pre
              className="file-editor-highlight hljs"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
            {/* Editable textarea (transparent, on top) */}
            <textarea
              ref={textareaRef}
              className="file-editor-textarea"
              value={content}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              wrap="off"
            />
          </div>
          {completionResult && (
            <div className="file-editor-completion-hint file-editor-completion-inline">
              <span className="completion-ghost-text">{completionResult.text}</span>
              <span className="completion-hint-action">Tab 补全 | Esc 取消</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
