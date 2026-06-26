/* ════════════════════════════════════════════════════════════════════
   API Service — KoboldCpp / OpenAI-compatible API client
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from './settings-store.js';
import { localSyncService } from './local-sync-service.js';

class RequestQueue {
  constructor() {
    this.queue = [];
    this.currentActive = null;
  }

  async add(fn, onError, options = {}) {
    const isBackground = options.priority === 'background';

    if (!isBackground) {
      // High-priority request!
      // 1. Clear all queued background requests
      this.queue = this.queue.filter(item => {
        if (item.isBackground) {
          // Trigger onError for the cancelled background request so its promise/caller knows it aborted
          if (item.onError) {
            item.onError(new Error('Aborted: high priority request took precedence'));
          }
          item.resolve(); // Resolve the queue promise so we don't have unhandled rejections
          return false;
        }
        return true;
      });

      // 2. Abort active background request if one is running
      if (this.currentActive && this.currentActive.isBackground) {
        console.log('Aborting active background LLM request for high-priority request');
        this.currentActive.abortController.abort();
      }
    }

    const internalAbortController = new AbortController();

    return new Promise((resolve) => {
      const queueItem = {
        fn,
        isBackground,
        abortController: internalAbortController,
        onError,
        resolve
      };

      this.queue.push(queueItem);
      this.process();
    });
  }

  async process() {
    if (this.currentActive || this.queue.length === 0) return;

    const item = this.queue.shift();
    this.currentActive = item;

    try {
      if (item.abortController.signal.aborted) {
        throw new Error('Aborted before starting');
      }

      await item.fn(item.abortController.signal);
      item.resolve();
    } catch (err) {
      if (item.onError) {
        item.onError(err);
      }
      item.resolve();
    } finally {
      this.currentActive = null;
      this.process();
    }
  }
}

const llmQueue = new RequestQueue();

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
  async streamChat(messages, signal, onChunk, onDone, onError, options = {}, onThinkingChunk = null) {
    return llmQueue.add(async (internalSignal) => {
      const settings = settingsStore.get();

      // Combine caller's signal and our queue's internal signal
      const combinedController = new AbortController();
      const onAbort = () => {
        combinedController.abort();
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort);
        }
      }

      if (internalSignal) {
        if (internalSignal.aborted) {
          onAbort();
        } else {
          internalSignal.addEventListener('abort', onAbort);
        }
      }

      const body = {
        messages,
        stream: true,
        max_tokens: options.max_tokens || settings.max_tokens,
        temperature: options.temperature || settings.temperature,
        top_p: options.top_p || settings.top_p,
        top_k: options.top_k || settings.top_k,
        repeat_penalty: options.rep_penalty || settings.rep_penalty,
      };

      // Add reasoning_effort parameter (KoboldCpp parameter for thinking budget)
      const effort = options.reasoning_effort ?? settings.reasoning_effort ?? 'none';
      if (effort) {
        body.reasoning_effort = effort;
      }


      // Removed jinja_kwargs override to avoid conflict with manual system prompt token prefill

      try {
        if (combinedController.signal.aborted) {
          onDone();
          return;
        }

        // Use relay URL when connected to a host, otherwise direct LLM
        const effectiveUrl = localSyncService.isClientMode
          ? localSyncService.getRelayUrl()
          : `${settings.api_url}/v1/chat/completions`;

        if (localSyncService.isClientMode) {
          const invoke = window.__TAURI_INTERNALS__?.invoke;
          if (!invoke) {
            onError(new Error('Tauri invoke not available in client mode'));
            return;
          }

          const eventId = 'relay_' + Date.now() + '_' + Math.floor(Math.random() * 1000000);
          let unlisten = null;
          let doneUnlisten = null;
          let buffer = '';

          // 1. Set up event listener for the stream chunks
          if (window.__TAURI__ && window.__TAURI__.event) {
            unlisten = await window.__TAURI__.event.listen(`relay-chunk-${eventId}`, (event) => {
              const text = event.payload;
              buffer += text;
              const lines = buffer.split('\n');
              buffer = lines.pop(); // Keep incomplete line in buffer

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;

                const data = trimmed.slice(6);
                if (data === '[DONE]') {
                  continue;
                }

                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta;
                  if (delta?.reasoning_content && onThinkingChunk) {
                    onThinkingChunk(delta.reasoning_content);
                  }
                  if (delta?.content) {
                    onChunk(delta.content);
                  }
                } catch {
                  // Skip malformed JSON
                }
              }
            });
          }

          if (window.__TAURI__ && window.__TAURI__.event) {
            doneUnlisten = await window.__TAURI__.event.listen(`relay-done-${eventId}`, () => {
              if (unlisten) unlisten();
              if (doneUnlisten) doneUnlisten();
              onDone();
            });
          }

          // Handle abort signal
          const handleAbort = () => {
            invoke('cancel_client_relay', { eventId }).catch(() => {});
            if (unlisten) unlisten();
            if (doneUnlisten) doneUnlisten();
          };

          combinedController.signal.addEventListener('abort', handleAbort);

          try {
            await invoke('client_relay_stream', {
              url: effectiveUrl,
              body: JSON.stringify(body),
              eventId,
              headers: localSyncService.getSyncHeaders(),
            });
          } catch (err) {
            if (!combinedController.signal.aborted) {
              onError(new Error(err));
            }
          } finally {
            combinedController.signal.removeEventListener('abort', handleAbort);
            if (unlisten) unlisten();
            if (doneUnlisten) doneUnlisten();
          }
          return;
        }

        const resp = await fetch(effectiveUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: combinedController.signal,
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
              if (delta?.reasoning_content && onThinkingChunk) {
                onThinkingChunk(delta.reasoning_content);
              }
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
        if (err.name === 'AbortError' || combinedController.signal.aborted) {
          onDone();
        } else {
          onError(err);
        }
      } finally {
        // Clean up listeners
        if (signal) signal.removeEventListener('abort', onAbort);
        if (internalSignal) internalSignal.removeEventListener('abort', onAbort);
      }
    }, onError, options);
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

  /**
   * Generates a new game scene in JSON format for the Interactive Game Mode
   */
  async generateGameScene(currentStats, previousSceneText, playerAction, prompt, noteToGM = '', gameSummary = '', remainingHistory = [], onChunk = null, language = 'English', storyPrompt = '', existingCharacters = []) {
    const settings = settingsStore.get();
    const customPrompt = settings.game_system_prompt || "You are a Game Master in an interactive text RPG.";
    let lengthPrompt = "";
    if (settings.game_response_length === 'short') {
      lengthPrompt = "Keep the scene_text brief and compact, limited to a single short paragraph.";
    } else if (settings.game_response_length === 'long') {
      lengthPrompt = "Write a rich, detailed, and highly atmospheric scene_text containing 3 to 4 immersive paragraphs.";
    } else {
      lengthPrompt = "Write a moderately detailed scene_text containing 1 to 2 paragraphs.";
    }

    let historyContext = "";
    if (gameSummary) {
      historyContext += `SUMMARY OF PREVIOUS ADVENTURE:\n${gameSummary}\n\n`;
    }

    if (remainingHistory && remainingHistory.length > 0) {
      historyContext += `DETAILED RECENT ADVENTURE HISTORY:\n`;
      remainingHistory.forEach((scene, i) => {
        historyContext += `Scene ${i+1}:\n${scene.scene_text}\n`;
        if (scene.player_action) {
          historyContext += `Player Action: ${scene.player_action}\n`;
        }
        if (scene.player_note) {
          historyContext += `Player Note to GM: ${scene.player_note}\n`;
        }
        historyContext += `\n`;
      });
    }

    const storyPremiseBlock = storyPrompt ? `\nSTORY PREMISE:\n${storyPrompt}\n` : '';

    let existingCharsBlock = '';
    if (existingCharacters && existingCharacters.length > 0) {
      existingCharsBlock = `\nKNOWN CHARACTERS:\n${existingCharacters.map(c => {
        let block = `- ${c.name}: ${c.short_description || 'No description yet'}`;
        if (c.system_prompt) {
          block += `\n  Behavioral Directive/Prompt: ${c.system_prompt}`;
        }
        return block;
      }).join('\n')}\n`;
    }

    const systemPrompt = `${customPrompt}
${storyPremiseBlock}
You must return your response ONLY as a valid JSON object. Do not include any explanations, greetings, or markdown code blocks outside the JSON.
${lengthPrompt}
You MUST write the entire generated RPG content (including "scene_text", all items inside "text_states" array, all labels inside "extra_actions" array, and all choices button texts inside "choices" array) strictly and exclusively in the ${language} language. All user-visible narrative text and controls MUST be fully in ${language}.

    IMPORTANT: When referring to named characters (NPCs) in scene_text, you MUST wrap their name with the {{char:Name}} tag. For example: "{{char:Lena}} looked at you." To display a different text (like a pronoun or alias), use {{char:Name|alias}}. For example: "{{char:Lena|She}} looked at you." or "{{char:Guard|The tall man}} stood there." This applies to ALL character names and meaningful references in the scene_text ONLY. Do NOT use the {{char:}} syntax inside choices, actions, text_states, or extra_actions. Write character names normally there. Do NOT use {{char:}} for the player character.
${existingCharsBlock}

The user currently has these stats:
${JSON.stringify(currentStats)}

${historyContext ? `--- ADVENTURE CONTEXT ---
${historyContext}
------------------------\n` : ''}
${previousSceneText ? `The previous scene was:
"${previousSceneText}"

The player decided to:
"${playerAction}"` : `The initial starting scenario is:
"${prompt || 'The game is just starting.'}"`}
${noteToGM ? `\nNOTE FROM THE PLAYER TO THE GAME MASTER:\n"${noteToGM}"\nYou MUST incorporate this request or guidance into the next scene.` : ''}

Generate the next scene. Your JSON must strictly follow this schema:
{
  "scene_text": "Detailed and atmospheric description of what happens next. Use {{char:Name}} for character references.",
  "stats_changes": {
    "hp": 0, // change in hp, negative for damage
    "stress": 0, // change in stress
    "lust": 0,
    "money": 0
  },
  "text_states": [
    {"text": "Brief textual status condition like: Hunger, Pain in arm, Euphoria, etc.", "color": "red|white|green"}
  ],
  "extra_actions": [
    "Short visual physical actions player can perform under textual states (e.g. smile, pinch, scratch, stroke)"
  ],
  "choices": [
     {"id": "action1", "text": "Short label for button 1", "prompt_intent": "What the player tries to do in detail"},
     {"id": "action2", "text": "Short label for button 2", "prompt_intent": "What the player tries to do in detail"}
  ]
}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: "Generate the next scene in JSON." }
    ];

    return new Promise((resolve, reject) => {
      let fullResponse = '';
      this.streamChat(
        messages,
        null, // signal
        (chunk) => {
          fullResponse += chunk;
          if (onChunk) {
            onChunk(fullResponse);
          }
        },
        () => {
          try {
            let cleanText = fullResponse.trim();
            if (cleanText.startsWith('```json')) {
              cleanText = cleanText.replace(/^```json/m, '').replace(/```$/m, '').trim();
            } else if (cleanText.startsWith('```')) {
              cleanText = cleanText.replace(/^```/m, '').replace(/```$/m, '').trim();
            }
            resolve(JSON.parse(cleanText));
          } catch (err) {
            console.error('Failed to parse final JSON from game scene stream:', err, fullResponse);
            reject(err);
          }
        },
        (err) => reject(err),
        { temperature: 0.7, max_tokens: 2048 }
      );
    });
  },

  /**
   * Extracts and updates game characters from the latest scene (separate API call after scene generation)
   * Returns an array of character objects: [{ name, short_description }]
   */
  async updateGameCharacters(sceneText, existingCharacters = [], gameSummary = '', language = 'English') {
    let existingCharsBlock = '';
    if (existingCharacters && existingCharacters.length > 0) {
      existingCharsBlock = `\nCurrently known characters:\n${existingCharacters.map(c => `- ${c.name}: ${c.short_description || 'No description'}`).join('\n')}\n`;
    }

    const systemPrompt = `You are an expert RPG Character Tracker. Analyze the latest scene text and identify ALL characters (NPCs) that appear or are mentioned.
${existingCharsBlock}
For each character (new or existing), provide:
- "name": The character's name or identifier (e.g. "Лена", "Guard", "Старик у ворот")
- "short_description": A concise description (20-40 words) of the character based on what is known so far. Write in ${language}.

Return ONLY a valid JSON array. Do NOT include the player character. Include both new and existing characters that appear in this scene (update their descriptions if something new was learned about them).
If no characters appear, return an empty array [].
Do not include any formatting, markdown code blocks, or greetings. Just the clean JSON array.

Example response:
[{"name": "Лена", "short_description": "Молодая женщина с рыжими волосами, работает в таверне. Выглядит настороженной, но доброжелательной."}]`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Latest scene text:\n${sceneText}\n\nIdentify and describe all characters from this scene.` }
    ];

    try {
      const response = await this.chatCompletion(messages, { temperature: 0.3, max_tokens: 1536 });
      let cleanText = response.trim();
      if (cleanText.startsWith('```json')) {
        cleanText = cleanText.replace(/^```json/m, '').replace(/```$/m, '').trim();
      } else if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```/m, '').replace(/```$/m, '').trim();
      }
      return JSON.parse(cleanText);
    } catch (err) {
      console.error('Failed to update game characters:', err);
      return [];
    }
  },

  /**
   * Generates a condensed summary of past adventure scenes
   */
  async generateAdventureSummary(previousSummary, newScenes, language = 'Russian') {
    let scenesText = "";
    newScenes.forEach((scene, i) => {
      scenesText += `Scene ${i+1}:\n${scene.scene_text}\n`;
      if (scene.player_action) {
        scenesText += `Player Action: ${scene.player_action}\n`;
      }
      if (scene.player_note) {
        scenesText += `Player Note to GM: ${scene.player_note}\n`;
      }
      scenesText += `\n`;
    });

    let systemPrompt = "";
    if (previousSummary) {
      systemPrompt = `You are a professional RPG Chronicler. You are tasked with UPDATING an existing adventure summary with new events that occurred after it.
Here is the EXISTING SUMMARY of the adventure so far:
"""
${previousSummary}
"""

Here are the NEW SCENES and choices that occurred after the existing summary:
"""
${scenesText}
"""

Please write a new, comprehensive, cohesive, and highly atmospheric summary of the entire adventure from the very beginning up to the latest scenes.
Do not omit important historical plot points from the existing summary, but integrate the new events seamlessly.
Keep the summary under 300 words. Write only the summary itself in ${language}, without any introductory remarks, greetings, or meta-commentary.`;
    } else {
      systemPrompt = `You are a professional RPG Chronicler. You are tasked with writing a concise, comprehensive, and highly atmospheric summary of a roleplaying game session.
Here are the SCENES and choices that occurred during the adventure:
"""
${scenesText}
"""

Please write a cohesive summary of the adventure from the very beginning up to the latest scenes.
Highlight key plot points, major actions taken, and critical developments.
Keep the summary under 300 words. Write only the summary itself in ${language}, without any introductory remarks, greetings, or meta-commentary.`;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Generate the adventure summary in ${language}.` }
    ];

    try {
      return await this.chatCompletion(messages, { temperature: 0.5, max_tokens: 1536 });
    } catch (err) {
      console.error('Adventure summarization failed:', err);
      throw err;
    }
  },

  /**
   * Generates a condensed summary of past chat messages
   */
  async generateChatSummary(previousSummary, newMessages, userName, characterName, language = 'Russian') {
    let newMessagesText = "";
    newMessages.forEach((msg) => {
      const name = msg.role === 'user' ? userName : characterName;
      const content = msg.role === 'user' ? (msg.translated_content || msg.content) : (msg.original_text || msg.content);
      newMessagesText += `${name}: ${content}\n\n`;
    });

    let systemPrompt = "";
    if (previousSummary) {
      systemPrompt = `You are a professional assistant. You are tasked with UPDATING an existing conversation summary with new messages that occurred after it.
Here is the EXISTING SUMMARY of the conversation so far:
"""
${previousSummary}
"""

Here are the NEW MESSAGES:
"""
${newMessagesText}
"""

Please write a new, comprehensive, cohesive, and detailed summary of the entire conversation from the very beginning up to the latest messages.
Integrate the new events seamlessly with the old summary.
The summary should be approximately 500 words long. Write only the summary itself in ${language}, without any introductory remarks, greetings, or meta-commentary.`;
    } else {
      systemPrompt = `You are a professional assistant. You are tasked with writing a detailed summary of the following conversation.
Here are the MESSAGES in the conversation:
"""
${newMessagesText}
"""

Please write a cohesive and detailed summary of the entire conversation from the very beginning up to the latest messages.
Highlight key events, major dialogue points, and critical developments.
The summary should be approximately 500 words long. Write only the summary itself in ${language}, without any introductory remarks, greetings, or meta-commentary.`;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Generate the conversation summary in ${language}.` }
    ];

    try {
      return await this.chatCompletion(messages, { temperature: 0.5, max_tokens: 2048 });
    } catch (err) {
      console.error('Chat summarization failed:', err);
      throw err;
    }
  },

  /**
   * Generates a list of characters mentioned in the adventure history
   */
  async extractGameCharacters(gameSummary, history) {
    let scenesText = "";
    if (gameSummary) {
      scenesText += `SUMMARY OF PREVIOUS ADVENTURE:\n${gameSummary}\n\n`;
    }
    history.forEach((scene, i) => {
      scenesText += `Scene ${i+1}:\n${scene.scene_text}\n`;
      if (scene.player_action) {
        scenesText += `Player Action: ${scene.player_action}\n`;
      }
      scenesText += `\n`;
    });

    const systemPrompt = `You are an expert RPG Assistant. Analyze the following story summary and history, and identify all characters (both main and supporting) that participated or were mentioned in the game.
This includes both named characters (e.g. "John", "Lena") and unnamed/generic characters if they played a notable role in the scene (e.g. "Some guy", "Mysterious stranger", "Tavern keeper", "Goblin scout").
Do not include the player character ("Player", "Герой", "Игрок") unless they have a specific named identity mentioned in the history.
Return your response ONLY as a JSON array of strings containing the character names/descriptions in English (e.g. ["John", "Some guy", "Tavern keeper"]). Do not include any formatting, markdown code blocks, or greetings. Just the clean JSON array.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Story content:\n${scenesText}` }
    ];

    try {
      const response = await this.chatCompletion(messages, { temperature: 0.3, max_tokens: 1024 });
      let cleanText = response.trim();
      if (cleanText.startsWith('```json')) {
        cleanText = cleanText.replace(/^```json/m, '').replace(/```$/m, '').trim();
      } else if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```/m, '').replace(/```$/m, '').trim();
      }
      return JSON.parse(cleanText);
    } catch (err) {
      console.error('Failed to extract characters:', err);
      return [];
    }
  },

  /**
   * Generates a detailed profile description for a given character based on adventure history
   */
  async generateCharacterDetails(characterName, gameSummary, history) {
    let scenesText = "";
    if (gameSummary) {
      scenesText += `SUMMARY OF PREVIOUS ADVENTURE:\n${gameSummary}\n\n`;
    }
    history.forEach((scene, i) => {
      scenesText += `Scene ${i+1}:\n${scene.scene_text}\n`;
      if (scene.player_action) {
        scenesText += `Player Action: ${scene.player_action}\n`;
      }
      scenesText += `\n`;
    });

    const systemPrompt = `You are an expert RPG Chronicler. Write a detailed profile for the character named "${characterName}" based on the adventure history.
Your response MUST be in English and should describe:
1. Appearance
2. Personality/Traits
3. Actions/Role in story

Focus ONLY on what is known or can be directly inferred from the history. Keep the profile structured, atmospheric, and under 250 words. Do not include any introductory remarks, greetings, or meta-commentary. Just start directly with the character details.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Story history:\n${scenesText}\n\nProvide details for character: ${characterName}` }
    ];

    try {
      return await this.chatCompletion(messages, { temperature: 0.5, max_tokens: 1536 });
    } catch (err) {
      console.error('Failed to generate character details:', err);
      throw err;
    }
  },

  /**
   * Count tokens for a given text using KoboldCpp's or llama.cpp's native token counter,
   * falling back to Cyrillic-aware character estimation if both fail.
   * @param {string} text
   * @returns {Promise<number>}
   */
  async countTokens(text) {
    if (!text) return 0;
    const settings = settingsStore.get();
    
    // Extract base URL (remove trailing /v1 or /v1/)
    let baseUrl = settings.api_url || 'http://localhost:5001';
    baseUrl = baseUrl.replace(/\/v1\/?$/, '');

    // 1. Try KoboldCpp's native tokencount
    try {
      const resp = await fetch(`${baseUrl}/api/extra/tokencount`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (typeof data.value === 'number') {
          return data.value;
        }
      }
    } catch (e) {
      // Fail silently and try next endpoint
    }

    // 2. Try llama.cpp's native tokenize
    try {
      const resp = await fetch(`${baseUrl}/tokenize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.tokens && Array.isArray(data.tokens)) {
          return data.tokens.length;
        }
      }
    } catch (e) {
      // Fail silently and use fallback
    }

    // Fallback to modern token characters-per-token ratio (Llama 3, Gemma 2, Qwen 2, Gemini)
    // English: ~3.3 chars/token. Cyrillic: ~2.3 chars/token.
    return Math.ceil(text.length / (/[а-яА-ЯёЁ]/.test(text) ? 2.3 : 3.3));
  },

  /**
   * Count tokens for a messages array by formatting it into a single prompt string
   * @param {Array} messages
   * @returns {Promise<number>}
   */
  async countMessagesTokens(messages) {
    if (!messages || messages.length === 0) return 0;
    
    // Format the messages array into a single ChatML-like string
    let formattedText = '';
    for (const msg of messages) {
      const role = msg.role || 'user';
      let contentText = '';
      if (Array.isArray(msg.content)) {
        contentText = msg.content.map(part => {
          if (part && part.type === 'text') return part.text || '';
          return '';
        }).join(' ');
      } else {
        contentText = msg.content || '';
      }
      formattedText += `<|im_start|>${role}\n${contentText}<|im_end|>\n`;
    }
    formattedText += `<|im_start|>assistant\n`;
    
    return await this.countTokens(formattedText);
  },

  /**
   * Fetch current max context length configured in KoboldCpp or llama.cpp properties
   * @returns {Promise<number>}
   */
  async getMaxContextLength() {
    const settings = settingsStore.get();
    
    // Extract base URL (remove trailing /v1 or /v1/)
    let baseUrl = settings.api_url || 'http://localhost:5001';
    baseUrl = baseUrl.replace(/\/v1\/?$/, '');

    // 1. Try KoboldCpp config endpoint
    try {
      const resp = await fetch(`${baseUrl}/api/v1/config/max_context_length`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (typeof data.value === 'number') {
          return data.value;
        }
      }
    } catch (e) {
      // Fail silently
    }

    // 2. Try llama.cpp props endpoint
    try {
      const resp = await fetch(`${baseUrl}/props`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.default_generation_settings && typeof data.default_generation_settings.n_ctx === 'number') {
          return data.default_generation_settings.n_ctx;
        }
      }
    } catch (e) {
      // Fail silently
    }

    return settings.prompt_token_limit || 4096;
  }
};

