import { useState, useRef, useEffect } from 'react';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

export default function MessageInput({ onSend, onStop, isLoading, disabled, initialInput, enableThinking, onToggleThinking }) {
  const [input, setInput] = useState(initialInput || '');
  const [images, setImages] = useState([]);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const handleSubmit = () => {
    if ((input.trim() || images.length > 0) && !isLoading) {
      onSend(input, images);
      setInput('');
      setImages([]);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      if (file.size > MAX_IMAGE_SIZE) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            name: file.name,
            dataUrl: ev.target.result,
            type: file.type,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (id) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = (ev) => {
          setImages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              name: `pasted-image-${Date.now()}.png`,
              dataUrl: ev.target.result,
              type: file.type,
            },
          ]);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  return (
    <div className="message-input-container">
      {images.length > 0 && (
        <div className="image-preview-bar">
          {images.map((img) => (
            <div key={img.id} className="image-preview-item">
              <img src={img.dataUrl} alt={img.name} className="image-preview-thumb" />
              <button
                className="image-preview-remove"
                onClick={() => removeImage(img.id)}
                title="Remove image"
              >
                ✕
              </button>
              <span className="image-preview-name">{img.name}</span>
            </div>
          ))}
        </div>
      )}
      <div className="message-input-wrapper">
        <button
          className="btn-attach"
          onClick={() => fileInputRef.current?.click()}
          title="Upload image"
          disabled={disabled}
        >
          📎
        </button>
        <button
          className={`btn-thinking-toggle ${enableThinking ? 'active' : ''}`}
          onClick={onToggleThinking}
          title={enableThinking ? '思考模式已开启，点击关闭' : '思考模式已关闭，点击开启'}
          disabled={disabled}
        >
          {enableThinking ? '🧠' : '💤'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleImageUpload}
          style={{ display: 'none' }}
        />
        <textarea
          ref={textareaRef}
          className="message-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
          rows={1}
          disabled={disabled}
        />
        {isLoading ? (
          <button className="btn-stop" onClick={onStop} title="Stop generation">
            ⏹
          </button>
        ) : (
          <button
            className="btn-send"
            onClick={handleSubmit}
            disabled={(!input.trim() && images.length === 0) || disabled}
            title="Send message"
          >
            ➤
          </button>
        )}
      </div>
    </div>
  );
}
