/* ════════════════════════════════════════════════════════════════════
   API Service — KoboldCpp / OpenAI-compatible API client
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from './settings-store.js';

export const api = {
  /**
   * Check if the API server is reachable
   */
  async checkConnection() {
    const settings = settingsStore.get();
    try {
      const resp = await fetch(`${settings.api_url}/v1/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  },

  /**
   * Get model info
   */
  async getModel() {
    const settings = settingsStore.get();
    try {
      const resp = await fetch(`${settings.api_url}/v1/models`);
      if (resp.ok) {
        const data = await resp.json();
        return data.data?.[0]?.id || 'unknown';
      }
    } catch {
      // ignore
    }
    return null;
  },

  /**
   * Send a chat completion request with streaming
   * @param {Array} messages - Array of {role, content} objects
   * @param {AbortSignal} signal - AbortController signal
   * @param {Function} onChunk - Callback for each text chunk
   * @param {Function} onDone - Callback when generation is complete
   * @param {Function} onError - Callback on error
   */
  async streamChat(messages, signal, onChunk, onDone, onError, options = {}) {
    const settings = settingsStore.get();

    const body = {
      messages,
      stream: true,
      max_tokens: options.max_tokens || settings.max_tokens,
      temperature: options.temperature || settings.temperature,
      top_p: options.top_p || settings.top_p,
      top_k: options.top_k || settings.top_k,
      repeat_penalty: options.rep_penalty || settings.rep_penalty,
    };

    // Inject thinking mode via jinja_kwargs (matching SillyTavern's Ji.Kwargs)
    if (settings.thinking_enabled) {
      body.jinja_kwargs = { enable_thinking: true };
    } else {
      body.jinja_kwargs = { enable_thinking: false };
    }

    try {
      const resp = await fetch(`${settings.api_url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });

      if (!resp.ok) {
        const errText = await resp.text();
        onError(new Error(`API error ${resp.status}: ${errText}`));
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            onDone();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              onChunk(delta.content);
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      onDone();
    } catch (err) {
      if (err.name === 'AbortError') {
        onDone();
      } else {
        onError(err);
      }
    }
  },

  /**
   * Non-streaming chat completion (used for memory extraction)
   * @param {Array} messages
   * @returns {string} The assistant's response
   */
  async chatCompletion(messages, options = {}) {
    const signal = options.signal;
    
    // Fail immediately if already aborted
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }

    return new Promise((resolve, reject) => {
      let fullResponse = '';
      this.streamChat(
        messages,
        signal,
        (chunk) => { fullResponse += chunk; },
        () => resolve(fullResponse),
        (err) => reject(err),
        options
      );
    });
  },


  /**
   * Translate text to a target language
   * @param {string} text
   * @param {string} targetLang
   * @returns {Promise<string>}
   */
  async translate(text, targetLang = 'Russian') {
    const messages = [
      {
        role: 'system',
        content: `Translate the following text to ${targetLang}. Return ONLY the translation, no explanations, no original text, and no quotes. Keep any Markdown formatting (italics, bold, etc.) as is.`,
      },
      { role: 'user', content: text },
    ];
    try {
      return await this.chatCompletion(messages, { temperature: 0.1, max_tokens: 2048 });
    } catch (err) {
      console.warn('Translation failed:', err);
      return text; // Return original text on failure
    }
  },

  /**
   * Stream translation of text to a target language
   * @param {string} text
   * @param {string} targetLang
   * @param {Function} onChunk
   * @param {Function} onDone
   * @param {Function} onError
   */
  async streamTranslate(text, targetLang, onChunk, onDone, onError, signal = null) {
    const messages = [
      {
        role: 'system',
        content: `Translate the following text to ${targetLang}. Return ONLY the translation, no explanations, no original text, and no quotes. Keep any Markdown formatting (italics, bold, etc.) as is.`,
      },
      { role: 'user', content: text },
    ];
    await this.streamChat(messages, signal || new AbortController().signal, onChunk, onDone, onError);
  },
};
