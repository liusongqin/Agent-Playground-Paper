import { useState } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import { stripAgentActions } from '../utils/agentActions';

function formatTime(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ImagePreview({ src, alt }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <img
        src={src}
        alt={alt}
        className="message-image-thumb"
        onClick={() => setExpanded(true)}
      />
      {expanded && (
        <div className="image-lightbox" onClick={() => setExpanded(false)}>
          <img src={src} alt={alt} className="image-lightbox-img" />
        </div>
      )}
    </>
  );
}

function ActionCard({ action, onConfirm, onReject, stepIndex, totalSteps }) {
  const statusIcons = {
    pending: '⏳',
    confirmed: '✅',
    executing: '🔄',
    executed: '✅',
    rejected: '❌',
    error: '⚠️',
  };

  const statusLabels = {
    pending: 'Pending confirmation',
    confirmed: 'Confirmed',
    executing: 'Executing...',
    executed: 'Executed',
    rejected: 'Rejected',
    error: 'Error',
  };

  return (
    <div className={`action-card action-status-${action.status}`}>
      <div className="action-card-header">
        {totalSteps > 1 && (
          <span className="action-step-badge">Step {stepIndex}/{totalSteps}</span>
        )}
        <span className="action-card-icon">{statusIcons[action.status] || '⏳'}</span>
        <span className="action-card-title">{action.action}</span>
        <span className="action-card-status">{statusLabels[action.status] || action.status}</span>
      </div>
      <div className="action-card-params">
        {Object.entries(action.params).map(([key, value]) => (
          <div key={key} className="action-param">
            <span className="action-param-key">{key}:</span>
            <span className="action-param-value">
              {typeof value === 'string' && value.length > 100
                ? value.substring(0, 100) + '...'
                : String(value)}
            </span>
          </div>
        ))}
      </div>
      {action.command && (
        <div className="action-card-command">
          <span className="action-command-label">Command:</span>
          <code className="action-command-code">{action.command}</code>
        </div>
      )}
      {action.result && (
        <div className="action-card-result">
          <span className="action-command-label">Result:</span>
          <pre className="action-result-code">{
            action.result.length > 500
              ? action.result.substring(0, 500) + '...'
              : action.result
          }</pre>
        </div>
      )}
      {action.status === 'pending' && onConfirm && (
        <div className="action-card-buttons">
          <button className="btn-action-confirm" onClick={() => onConfirm(action)}>
            ✅ Execute
          </button>
          <button className="btn-action-reject" onClick={() => onReject(action)}>
            ❌ Reject
          </button>
        </div>
      )}
      {action.error && (
        <div className="action-card-error">{action.error}</div>
      )}
    </div>
  );
}

function ActionBatchToolbar({ actions, onConfirmAll, onRejectAll, onExecuteNext }) {
  const pendingActions = actions.filter((a) => a.status === 'pending');
  const executedCount = actions.filter((a) => a.status === 'executed').length;
  const totalCount = actions.length;

  if (pendingActions.length === 0) return null;

  return (
    <div className="action-batch-toolbar">
      <div className="action-batch-progress">
        <span className="action-batch-label">
          📋 {totalCount} steps total — {executedCount} executed, {pendingActions.length} pending
        </span>
      </div>
      <div className="action-batch-buttons">
        <button className="btn-action-batch btn-batch-next" onClick={onExecuteNext}>
          ▶ Execute Next Step
        </button>
        <button className="btn-action-batch btn-batch-all" onClick={onConfirmAll}>
          ▶▶ Execute All Steps
        </button>
        <button className="btn-action-batch btn-batch-reject" onClick={onRejectAll}>
          ✕ Reject All
        </button>
      </div>
    </div>
  );
}

export default function MessageItem({ message, onConfirmAction, onRejectAction, onConfirmAllActions, onRejectAllActions, onExecuteNextAction }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isError = message.role === 'error';

  // Remove action blocks from displayed content for cleaner rendering
  const displayContent = message.actions && message.actions.length > 0
    ? stripAgentActions(message.content)
    : message.content;

  const hasMultipleActions = message.actions && message.actions.length > 1;
  const hasPendingActions = message.actions && message.actions.some((a) => a.status === 'pending');

  return (
    <div className={`message-item ${message.role}`}>
      <div className="message-avatar">
        {isUser ? '👤' : isSystem ? '⚙️' : isError ? '⚠️' : '🤖'}
      </div>
      <div className="message-content-wrapper">
        <div className="message-role">
          {isUser ? 'You' : isSystem ? 'System' : isError ? 'Error' : 'Assistant'}
          {message.timestamp && (
            <span className="message-time">{formatTime(message.timestamp)}</span>
          )}
        </div>
        <div className="message-content">
          {isUser ? (
            <>
              {message.images && message.images.length > 0 && (
                <div className="message-images">
                  {message.images.map((img) => (
                    <ImagePreview
                      key={img.id}
                      src={img.dataUrl}
                      alt={img.name}
                    />
                  ))}
                </div>
              )}
              <div className="user-text">{message.content}</div>
            </>
          ) : (
            <MarkdownRenderer content={displayContent || '...'} />
          )}
          {message.actions && message.actions.length > 0 && (
            <div className="message-actions">
              {hasMultipleActions && hasPendingActions && (
                <ActionBatchToolbar
                  actions={message.actions}
                  onConfirmAll={() => onConfirmAllActions && onConfirmAllActions(message)}
                  onRejectAll={() => onRejectAllActions && onRejectAllActions(message)}
                  onExecuteNext={() => onExecuteNextAction && onExecuteNextAction(message)}
                />
              )}
              {message.actions.map((action, idx) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  onConfirm={onConfirmAction}
                  onReject={onRejectAction}
                  stepIndex={idx + 1}
                  totalSteps={message.actions.length}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
