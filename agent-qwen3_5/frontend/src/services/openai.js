/**
 * OpenAI-compatible API service with streaming support.
 */

/* Strip model thinking content from responses.
 * If a </think> closing tag exists, extract only the content after the last
 * </think> tag.  Otherwise fall back to removing any unclosed <think> prefix. */
function stripThinkTags(text) {
  if (!text) return text;
  // Prefer content after the last </think> tag (case-insensitive)
  const lower = text.toLowerCase();
  const closeTag = '</think>';
  const closeIdx = lower.lastIndexOf(closeTag);
  if (closeIdx !== -1) {
    return text.substring(closeIdx + closeTag.length).trim();
  }
  // Handle unclosed <think> — remove from the tag onwards
  const openIdx = lower.indexOf('<think>');
  if (openIdx !== -1) {
    return text.substring(0, openIdx).trim();
  }
  return text.trim();
}

export async function sendChatRequest(messages, settings, onChunk, abortSignal) {
  const { apiKey, baseUrl, model, temperature, maxTokens, topP, presencePenalty, topK, stream, enableThinking } = settings;

  if (!apiKey) {
    throw new Error('API Key is required. Please configure it in Settings.');
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream,
  };

  // Add optional parameters if they have meaningful values
  if (topP != null) body.top_p = topP;
  if (presencePenalty != null) body.presence_penalty = presencePenalty;
  if (topK != null) body.extra_body = { top_k: topK };

  // Control model thinking mode via chat_template_kwargs
  if (enableThinking != null) {
    body.chat_template_kwargs = { enable_thinking: !!enableThinking };
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: abortSignal,
  });

  if (!response.ok) {
    let errorMessage;
    try {
      const errorData = await response.json();
      errorMessage =
        errorData.error?.message || errorData.message || `HTTP ${response.status}`;
    } catch {
      errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    }
    throw new Error(errorMessage);
  }

  if (!stream) {
    const data = await response.json();
    // Use only message.content; ignore reasoning_content (Qwen3 thinking field)
    const rawContent = data.choices?.[0]?.message?.content || '';
    const content = stripThinkTags(rawContent);
    const toolCalls = data.choices?.[0]?.message?.tool_calls || null;
    if (typeof onChunk === 'function') {
      onChunk(content, false, toolCalls);
      onChunk('', true, null);
    }
    return { content, toolCalls };
  }

  // Handle streaming response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      const data = trimmed.slice(6);
      if (data === '[DONE]') {
        if (typeof onChunk === 'function') onChunk('', true, null);
        return { content: stripThinkTags(fullContent), toolCalls: null };
      }

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        // Only accumulate main content; skip reasoning_content (Qwen3 thinking field)
        if (delta?.content) {
          fullContent += delta.content;
          if (typeof onChunk === 'function') onChunk(delta.content, false, null);
        }
      } catch {
        // skip malformed JSON lines
      }
    }
  }

  if (typeof onChunk === 'function') onChunk('', true, null);
  return { content: stripThinkTags(fullContent), toolCalls: null };
}

/**
 * Fetch available models from the API.
 */
export async function fetchModels(settings) {
  const { apiKey, baseUrl } = settings;

  if (!apiKey) {
    throw new Error('API Key is required.');
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/models`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: HTTP ${response.status}`);
  }

  const data = await response.json();
  return (data.data || []).map((m) => m.id).sort();
}
