import { useState, useCallback, useRef } from 'react';
import { sendChatRequest } from '../services/openai';
import {
  loadConversations,
  saveConversations,
  loadActiveConversationId,
  saveActiveConversationId,
  generateId,
} from '../utils/storage';
import { buildAgentSystemPrompt, parseAgentActions, actionToCommand } from '../utils/agentActions';

const MAX_AUTO_TITLE_LENGTH = 40;
const DEFAULT_TITLE = 'New Conversation';
const IMAGE_TITLE = '📷 Image conversation';

function createConversation(title) {
  return {
    id: generateId(),
    title: title || DEFAULT_TITLE,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function useChat(settings) {
  const [conversations, setConversations] = useState(() => {
    const saved = loadConversations();
    return saved.length > 0 ? saved : [createConversation(DEFAULT_TITLE)];
  });

  const [activeConversationId, setActiveConversationId] = useState(() => {
    const savedId = loadActiveConversationId();
    const saved = loadConversations();
    if (savedId && saved.some((c) => c.id === savedId)) {
      return savedId;
    }
    return saved.length > 0 ? saved[0].id : conversations[0].id;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortControllerRef = useRef(null);

  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) || conversations[0];

  const persistConversations = useCallback((convs) => {
    setConversations(convs);
    saveConversations(convs);
  }, []);

  const switchConversation = useCallback(
    (id) => {
      setActiveConversationId(id);
      saveActiveConversationId(id);
      setError(null);
    },
    []
  );

  const createNewConversation = useCallback(() => {
    const conv = createConversation(DEFAULT_TITLE);
    const updated = [conv, ...conversations];
    persistConversations(updated);
    switchConversation(conv.id);
    return conv.id;
  }, [conversations, persistConversations, switchConversation]);

  const deleteConversation = useCallback(
    (id) => {
      const updated = conversations.filter((c) => c.id !== id);
      if (updated.length === 0) {
        const newConv = createConversation(DEFAULT_TITLE);
        persistConversations([newConv]);
        switchConversation(newConv.id);
      } else {
        persistConversations(updated);
        if (id === activeConversationId) {
          switchConversation(updated[0].id);
        }
      }
    },
    [conversations, activeConversationId, persistConversations, switchConversation]
  );

  const renameConversation = useCallback(
    (id, newTitle) => {
      const updated = conversations.map((c) =>
        c.id === id ? { ...c, title: newTitle, updatedAt: Date.now() } : c
      );
      persistConversations(updated);
    },
    [conversations, persistConversations]
  );

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }, []);

  const sendMessage = useCallback(
    async (content, images = []) => {
      if ((!content.trim() && images.length === 0) || isLoading) return;
      setError(null);

      const userMessage = {
        id: generateId(),
        role: 'user',
        content: content.trim(),
        images: images.length > 0 ? images : undefined,
        timestamp: Date.now(),
      };

      // Add user message
      let currentMessages = [...(activeConversation?.messages || []), userMessage];

      // Auto-title based on first user message
      let autoTitle = activeConversation?.title;
      if (
        activeConversation?.messages.length === 0 &&
        autoTitle === DEFAULT_TITLE
      ) {
        const titleText = content.trim() || (images.length > 0 ? IMAGE_TITLE : DEFAULT_TITLE);
        autoTitle = titleText.substring(0, MAX_AUTO_TITLE_LENGTH) + (titleText.length > MAX_AUTO_TITLE_LENGTH ? '...' : '');
      }

      const updateConvs = (msgs, title) =>
        conversations.map((c) =>
          c.id === activeConversationId
            ? { ...c, messages: msgs, title: title || c.title, updatedAt: Date.now() }
            : c
        );

      // Standard execution
      const assistantMessage = {
        id: generateId(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      currentMessages = [...currentMessages, assistantMessage];

      persistConversations(updateConvs(currentMessages, autoTitle));

      setIsLoading(true);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        // Build API messages array
        const apiMessages = [];
        // In agent mode, build an enhanced system prompt with available skills
        const isAgentMode = settings.chatMode === 'agent';
        let systemPromptToUse = isAgentMode
          ? buildAgentSystemPrompt(settings.systemPrompt, settings._agentSkills, settings._terminalCwd, settings.customAgentPrompt, settings.terminalAgentPrompt, settings._mcpTools)
          : settings.systemPrompt;

        // Include memories in system prompt for main chat window
        if (settings.includeMemories !== false) {
          try {
            const raw = localStorage.getItem('agent-chat-memories');
            if (raw) {
              const memories = JSON.parse(raw);
              if (Array.isArray(memories) && memories.length > 0) {
                const memoryText = memories.map((m) => `- [${m.category}] ${m.key}: ${m.value}`).join('\n');
                systemPromptToUse = (systemPromptToUse || '') + `\n\n记忆信息：\n${memoryText}`;
              }
            }
          } catch {
            // ignore memory loading errors
          }
        }

        if (systemPromptToUse) {
          apiMessages.push({ role: 'system', content: systemPromptToUse });
        }
        for (const msg of currentMessages) {
          if (msg.role === 'user' || (msg.role === 'assistant' && msg.content)) {
            // Build multimodal content if images are present
            if (msg.role === 'user' && msg.images && msg.images.length > 0) {
              const contentParts = [];
              if (msg.content) {
                contentParts.push({ type: 'text', text: msg.content });
              }
              for (const img of msg.images) {
                contentParts.push({
                  type: 'image_url',
                  image_url: { url: img.dataUrl },
                });
              }
              apiMessages.push({ role: msg.role, content: contentParts });
            } else {
              apiMessages.push({ role: msg.role, content: msg.content });
            }
          }
        }
        // Remove the last assistant message (empty placeholder)
        if (apiMessages.length > 0 && apiMessages[apiMessages.length - 1].role === 'assistant') {
          apiMessages.pop();
        }

        // In agent mode, prepend CWD context to the latest user message for the API
        if (isAgentMode && settings._terminalCwd) {
          for (let i = apiMessages.length - 1; i >= 0; i--) {
            if (apiMessages[i].role === 'user') {
              const cwdPrefix = `[当前目录：${settings._terminalCwd}]\n`;
              if (typeof apiMessages[i].content === 'string') {
                apiMessages[i] = { ...apiMessages[i], content: cwdPrefix + apiMessages[i].content };
              }
              break;
            }
          }
        }

        let accumulatedContent = '';

        await sendChatRequest(
          apiMessages,
          settings,
          (chunk, isDone) => {
            if (isDone) {
              // After streaming completes, parse agent actions if in agent mode
              if (isAgentMode && accumulatedContent) {
                const actions = parseAgentActions(accumulatedContent);
                if (actions.length > 0) {
                  // Pre-resolve commands so users can preview what will be executed
                  const actionsWithCommands = actions.map((a) => ({
                    ...a,
                    command: actionToCommand(a, settings._agentSkills) || null,
                  }));
                  const updatedMessages = currentMessages.map((m) =>
                    m.id === assistantMessage.id
                      ? { ...m, content: accumulatedContent, actions: actionsWithCommands }
                      : m
                  );
                  currentMessages = updatedMessages;
                  persistConversations(updateConvs(updatedMessages, autoTitle));
                }
              }
              return;
            }
            accumulatedContent += chunk;
            const updatedMessages = currentMessages.map((m) =>
              m.id === assistantMessage.id
                ? { ...m, content: accumulatedContent }
                : m
            );
            currentMessages = updatedMessages;
            persistConversations(updateConvs(updatedMessages, autoTitle));
          },
          abortController.signal
        );
      } catch (err) {
        if (err.name === 'AbortError') {
          // User cancelled - keep partial content
        } else {
          setError(err.message);
          // Remove the empty assistant message on error
          const cleaned = currentMessages.filter(
            (m) => !(m.id === assistantMessage.id && !m.content)
          );
          persistConversations(updateConvs(cleaned, autoTitle));
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [
      isLoading,
      activeConversation,
      activeConversationId,
      conversations,
      settings,
      persistConversations,
    ]
  );

  const clearMessages = useCallback(() => {
    const updated = conversations.map((c) =>
      c.id === activeConversationId
        ? { ...c, messages: [], updatedAt: Date.now() }
        : c
    );
    persistConversations(updated);
    setError(null);
  }, [activeConversationId, conversations, persistConversations]);

  // Update the status of a specific action in a message
  const updateMessageAction = useCallback(
    (messageId, actionId, updates) => {
      const updated = conversations.map((c) => {
        if (c.id !== activeConversationId) return c;
        return {
          ...c,
          messages: c.messages.map((m) => {
            if (m.id !== messageId || !m.actions) return m;
            return {
              ...m,
              actions: m.actions.map((a) =>
                a.id === actionId ? { ...a, ...updates } : a
              ),
            };
          }),
          updatedAt: Date.now(),
        };
      });
      persistConversations(updated);
    },
    [activeConversationId, conversations, persistConversations]
  );

  // Batch update multiple actions in a single message (avoids stale-closure race conditions)
  const updateMultipleMessageActions = useCallback(
    (messageId, actionUpdates) => {
      // actionUpdates: Array<{ actionId, updates }>
      if (!actionUpdates || actionUpdates.length === 0) return;
      const updatesMap = new Map(actionUpdates.map((u) => [u.actionId, u.updates]));
      const updated = conversations.map((c) => {
        if (c.id !== activeConversationId) return c;
        return {
          ...c,
          messages: c.messages.map((m) => {
            if (m.id !== messageId || !m.actions) return m;
            return {
              ...m,
              actions: m.actions.map((a) =>
                updatesMap.has(a.id) ? { ...a, ...updatesMap.get(a.id) } : a
              ),
            };
          }),
          updatedAt: Date.now(),
        };
      });
      persistConversations(updated);
    },
    [activeConversationId, conversations, persistConversations]
  );

  const importConversations = useCallback(
    (imported) => {
      if (!Array.isArray(imported) || imported.length === 0) return;
      const merged = [...imported, ...conversations];
      persistConversations(merged);
      switchConversation(merged[0].id);
    },
    [conversations, persistConversations, switchConversation]
  );

  return {
    conversations,
    activeConversation,
    activeConversationId,
    isLoading,
    error,
    sendMessage,
    stopGeneration,
    createNewConversation,
    deleteConversation,
    renameConversation,
    switchConversation,
    clearMessages,
    importConversations,
    updateMessageAction,
    updateMultipleMessageActions,
  };
}
