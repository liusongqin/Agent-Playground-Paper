import { useEffect, useRef } from 'react';
import MessageItem from './MessageItem';

export default function MessageList({ messages, isLoading, onConfirmAction, onRejectAction, onConfirmAllActions, onRejectAllActions, onExecuteNextAction }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  if (messages.length === 0) {
    return (
      <div className="message-list empty">
        <div className="empty-state">
          <div className="empty-icon">💬</div>
          <h2>Start a Conversation</h2>
          <p>Send a message to begin chatting with the AI assistant.</p>
          <div className="empty-hints">
            <div className="hint-item" title="Ask anything">💡 Ask me anything</div>
            <div className="hint-item" title="Write code">🧑‍💻 Help me write code</div>
            <div className="hint-item" title="Analyze data">📊 Analyze data</div>
            <div className="hint-item" title="Creative writing">✍️ Creative writing</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((msg) => (
        <MessageItem
          key={msg.id}
          message={msg}
          onConfirmAction={onConfirmAction}
          onRejectAction={onRejectAction}
          onConfirmAllActions={onConfirmAllActions}
          onRejectAllActions={onRejectAllActions}
          onExecuteNextAction={onExecuteNextAction}
        />
      ))}
      {isLoading && (
        <div className="typing-indicator">
          <span></span><span></span><span></span>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
