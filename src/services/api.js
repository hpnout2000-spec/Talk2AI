/* ════════════════════════════════════════════════════════════════════
   API Service — KoboldCpp / OpenAI-compatible API client
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from './settings-store.js';
import { localSyncService } from './local-sync-service.js';
import { appState } from '../state.js';
import { formatTextCompletionPrompt } from '../utils/text-completion-formatter.js';

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

/**
 * Preprocess messages for Legacy Jinja Support:
 * If enabled, converts 'system' role messages to 'user' and merges consecutive
 * messages with the same role.
 */
function preprocessMessages(messages, settings) {
  if (!settings?.legacy_jinja_support || !messages || messages.length === 0) {
    return messages;
  }

  // 1. Convert 'system' role to 'user'
  const converted = messages.map(msg => {
    if (msg.role === 'system') {
      return { ...msg, role: 'user' };
    }
    return msg;
  });

  // 2. Merge consecutive messages with the same role
  const merged = [];
  for (const msg of converted) {
    if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
      const prev = merged[merged.length - 1];
      let newContent = '';

      const getMsgContentString = (content) => {
        if (typeof content === 'string') {
          return content;
        }
        if (Array.isArray(content)) {
          return content.map(part => {
            if (part && part.type === 'text') return part.text || '';
            return '';
          }).join(' ');
        }
        return content ? String(content) : '';
      };

      const prevText = getMsgContentString(prev.content);
      const msgText = getMsgContentString(msg.content);
      
      newContent = prevText + '\n\n' + msgText;

      merged[merged.length - 1] = {
        ...prev,
        content: newContent
      };
    } else {
      merged.push({ ...msg });
    }
  }

  return merged;
}

export function stripThinkingTags(text) {
  if (!text) return '';
  let clean = String(text).trim();

  // 1. Strip standard <think>...</think> blocks
  clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // 2. Strip <|channel>thought or <|channel|>thought blocks completely
  clean = clean.replace(/<\|?channel\|?>?thought[\s\S]*?(?=<\|?channel\|?>?commentary|<\|?channel\|?>?call|<\|?channel\|?>?final_response|\n\n[A-Z0-9#*-]|\n\n\S|$)/gi, '');
  clean = clean.replace(/<\|?channel\|?>?thought/gi, '');

  // 3. Strip any prefill strings inserted by system
  clean = clean.replace(/^The user[\s\S]*?(?=\n\n|$)/gi, '');
  clean = clean.replace(/^Okay, let me think really quickly[\s\S]*?(?=\n\n|$)/gi, '');

  // 4. Strip any remaining <|channel... tags
  clean = clean.replace(/<\|?channel\|?>?[a-z_]*/gi, '');
  clean = clean.replace(/<\/think>/gi, '');
  clean = clean.replace(/<think>/gi, '');

  return clean.trim();
}

export function extractJsonFromText(text) {
  if (!text) return null;
  let clean = stripThinkingTags(text);

  // 2. Extract contents of markdown ```json ... ``` or ``` ... ``` if present
  const markdownMatches = [...clean.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)];
  for (const m of markdownMatches) {
    if (m[1]) {
      try {
        const parsed = JSON.parse(m[1].trim());
        if (parsed) return parsed;
      } catch (e) {
        // try next match
      }
    }
  }

  // 3. Extract all candidate JSON array/object blocks using a parser loop
  const candidates = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (char === '}' || char === ']') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          candidates.push(clean.substring(start, i + 1));
          start = -1;
        }
      }
    }
  }

  // Try parsing candidates (reverse order first to get final response if multiple)
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i]);
      if (parsed !== null && parsed !== undefined) return parsed;
    } catch (e) {
      // ignore
    }
  }

  // Fallback: search simple boundary
  const firstBrace = clean.search(/[\{\[]/);
  if (firstBrace !== -1) {
    const isArray = clean[firstBrace] === '[';
    const lastBrace = isArray ? clean.lastIndexOf(']') : clean.lastIndexOf('}');
    if (lastBrace > firstBrace) {
      const fallback = clean.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(fallback);
      } catch (e) {
        // ignore
      }
    }
  }

  console.error("extractJsonFromText failed to find valid JSON in text:", text);
  return null;
}

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

      let finalMessages = preprocessMessages(messages, settings);
      let clonedMessages = JSON.parse(JSON.stringify(messages));
      let effort = options.reasoning_effort ?? settings.reasoning_effort ?? 'none';
      if (settings.gemma4_support && options.reasoning_effort === undefined && (!effort || effort === 'none')) {
        effort = 'minimal';
      }
      const isGenAI = options.isGenAI || false;
      const activePresetId = isGenAI ? (settings.active_genai_generation_preset_id || 'default') : (settings.active_generation_preset_id || 'default');
      const completionMode = isGenAI ? (settings.genai_completion_mode || 'chat_completion') : (settings.completion_mode || 'chat_completion');

      let temp = options.temperature ?? (isGenAI ? settings.genai_temperature : settings.temperature);
      let topP = options.top_p ?? (isGenAI ? settings.genai_top_p : settings.top_p);
      let topK = options.top_k ?? (isGenAI ? settings.genai_top_k : settings.top_k);
      let minP = options.min_p ?? (isGenAI ? settings.genai_min_p : settings.min_p) ?? 0.05;
      let minPEnabled = options.min_p_enabled ?? (isGenAI ? settings.genai_min_p_enabled : settings.min_p_enabled) ?? true;

      if (settings.qwen35_thinking_support && activePresetId === 'qwen3') {
        const isThinking = effort === 'medium' || effort === 'high';
        const tag = isThinking ? '/think' : '/no_think';
        
        if (finalMessages.length > 0) {
          const lastMsgIndex = finalMessages.length - 1;
          if (finalMessages[lastMsgIndex].role === 'user' || finalMessages[lastMsgIndex].role === 'tool') {
            if (Array.isArray(finalMessages[lastMsgIndex].content)) {
              const textPart = finalMessages[lastMsgIndex].content.find(p => p.type === 'text');
              if (textPart) textPart.text += `\n${tag}`;
              else finalMessages[lastMsgIndex].content.push({ type: 'text', text: `\n${tag}` });
            } else {
              finalMessages[lastMsgIndex].content += `\n${tag}`;
            }
          }
        }
        if (clonedMessages.length > 0) {
          const lastMsgIndex = clonedMessages.length - 1;
          if (clonedMessages[lastMsgIndex].role === 'user' || clonedMessages[lastMsgIndex].role === 'tool') {
            if (Array.isArray(clonedMessages[lastMsgIndex].content)) {
              const textPart = clonedMessages[lastMsgIndex].content.find(p => p.type === 'text');
              if (textPart) textPart.text += `\n${tag}`;
              else clonedMessages[lastMsgIndex].content.push({ type: 'text', text: `\n${tag}` });
            } else {
              clonedMessages[lastMsgIndex].content += `\n${tag}`;
            }
          }
        }

        if (isThinking) {
          temp = 0.6;
          minP = 0.0;
          minPEnabled = false;
          topP = 0.95;
          topK = 20;
        } else {
          temp = 0.7;
          minP = 0.0;
          minPEnabled = false;
          topP = 0.8;
          topK = 20;
          
          if (finalMessages.length > 0) {
            const lastMsgIndex = finalMessages.length - 1;
            if (finalMessages[lastMsgIndex].role === 'user' || finalMessages[lastMsgIndex].role === 'tool') {
              finalMessages.push({
                role: 'assistant',
                content: "<think>\n\n</think>\n"
              });
            }
          }
          if (clonedMessages.length > 0) {
            const lastMsgIndex = clonedMessages.length - 1;
            if (clonedMessages[lastMsgIndex].role === 'user' || clonedMessages[lastMsgIndex].role === 'tool') {
              clonedMessages.push({
                role: 'assistant',
                content: "<think>\n\n</think>\n"
              });
              const prefillStr = "<think>\n\n</think>\n";
              if (onChunk) {
                onChunk(prefillStr);
              }
            }
          }
        }
      } else if (settings.qwen35_thinking_support) {
        if (effort === 'high') {
          effort = 'medium';
        }
      } else if (settings.change_gemma4_thinking_style) {
        if (effort === 'high') {
          effort = 'medium';
          if (finalMessages.length > 0 && (finalMessages[finalMessages.length - 1].role === 'user' || finalMessages[finalMessages.length - 1].role === 'tool')) {
            finalMessages.push({
              role: 'assistant',
              content: "<|channel>thought\nThe user"
            });
            const prefillStr = "<|channel>thought\nThe user";
            if (onChunk) {
              onChunk(prefillStr);
            }
          }
        } else if (effort === 'medium') {
          if (finalMessages.length > 0 && (finalMessages[finalMessages.length - 1].role === 'user' || finalMessages[finalMessages.length - 1].role === 'tool')) {
            finalMessages.push({
              role: 'assistant',
              content: "<|channel>thought\nOkay, let me think really quickly from a first-person perspective."
            });
            const prefillStr = "<|channel>thought\nOkay, let me think really quickly from a first-person perspective.";
            if (onChunk) {
              onChunk(prefillStr);
            }
          }
        }
      }

      const maxTokens = options.max_tokens || (isGenAI ? settings.genai_max_tokens : settings.max_tokens);
      const repPenalty = options.rep_penalty ?? (isGenAI ? settings.genai_rep_penalty : settings.rep_penalty);
      const presPenalty = options.presence_penalty ?? (isGenAI ? settings.genai_presence_penalty : settings.presence_penalty) ?? 0.0;

      let body;
      if (completionMode === 'text_completion') {
        const instructId = isGenAI ? (settings.genai_active_instruct_template_id || 'gemma2') : (settings.active_instruct_template_id || 'gemma2');
        const contextId = isGenAI ? (settings.genai_active_context_template_id || 'gemma2') : (settings.active_context_template_id || 'gemma2');
        const instructTemplate = (settings.instruct_templates || []).find(t => t.id === instructId) || (settings.instruct_templates || [])[0] || {};
        const contextTemplate = (settings.context_templates || []).find(t => t.id === contextId) || (settings.context_templates || [])[0] || {};

        const formatted = formatTextCompletionPrompt(clonedMessages, contextTemplate, instructTemplate, {
          charName: options.charName || appState.currentCharacter?.name || 'Assistant',
          userName: options.userName || settings.user_name || 'User',
          charDescription: options.charDescription || appState.currentCharacter?.description || '',
          charPersonality: options.charPersonality || appState.currentCharacter?.personality || '',
          scenario: options.scenario || appState.currentCharacter?.scenario || '',
          persona: options.persona || appState.activePersona?.description || '',
          systemPrompt: options.systemPrompt || '',
        });

        body = {
          prompt: formatted.prompt,
          stop: formatted.stop,
          stream: true,
          max_tokens: maxTokens,
          temperature: temp,
          top_p: topP,
          top_k: topK,
          repeat_penalty: repPenalty,
          presence_penalty: presPenalty,
        };
      } else {
        body = {
          messages: finalMessages,
          stream: true,
          max_tokens: maxTokens,
          temperature: temp,
          top_p: topP,
          top_k: topK,
          repeat_penalty: repPenalty,
          presence_penalty: presPenalty,
        };
      }

      const sf = options.smoothing_factor ?? (isGenAI ? settings.genai_smoothing_factor : settings.smoothing_factor) ?? 0;
      if (sf > 0) {
        body.smoothing_factor = sf;
      }
      
      if (minPEnabled) {
        body.min_p = minP;
      }

      const adaptiveTargetEnabled = options.adaptive_target_enabled ?? (isGenAI ? settings.genai_adaptive_target_enabled : settings.adaptive_target_enabled) ?? true;
      if (adaptiveTargetEnabled) {
        body.adaptive_target = options.adaptive_target ?? (isGenAI ? settings.genai_adaptive_target : settings.adaptive_target) ?? 0.8;
      }

      const adaptiveDecayEnabled = options.adaptive_decay_enabled ?? (isGenAI ? settings.genai_adaptive_decay_enabled : settings.adaptive_decay_enabled) ?? true;
      if (adaptiveDecayEnabled) {
        body.adaptive_decay = options.adaptive_decay ?? (isGenAI ? settings.genai_adaptive_decay : settings.adaptive_decay) ?? 0.9;
      }

      const dryEnabled = options.dry_multiplier_enabled ?? (isGenAI ? settings.genai_dry_multiplier_enabled : settings.dry_multiplier_enabled) ?? false;
      if (dryEnabled) {
        body.dry_multiplier = options.dry_multiplier ?? (isGenAI ? settings.genai_dry_multiplier : settings.dry_multiplier) ?? 0.8;
        body.dry_base = options.dry_base ?? (isGenAI ? settings.genai_dry_base : settings.dry_base) ?? 1.75;
        body.dry_allowed_length = options.dry_allowed_length ?? (isGenAI ? settings.genai_dry_allowed_length : settings.dry_allowed_length) ?? 2;
        
        let breakers = options.dry_sequence_breakers ?? (isGenAI ? settings.genai_dry_sequence_breakers : settings.dry_sequence_breakers);
        if (typeof breakers === 'string') {
          try {
            breakers = JSON.parse(breakers);
          } catch (e) {
            breakers = ["\n", ":", "\"", "*"];
          }
        }
        body.dry_sequence_breakers = Array.isArray(breakers) ? breakers : ["\n", ":", "\"", "*"];
      }

      // Sampler Order
      const samplerOrderEnabled = options.sampler_order_enabled ?? (isGenAI ? settings.genai_sampler_order_enabled : settings.sampler_order_enabled);
      if (samplerOrderEnabled) {
        let order = options.sampler_order ?? (isGenAI ? settings.genai_sampler_order : settings.sampler_order);
        if (typeof order === 'string') {
          try {
            order = JSON.parse(order);
          } catch (e) {
            order = [6, 0, 1, 3, 4, 2, 5];
          }
        }
        const parsedOrder = Array.isArray(order) ? order : [6, 0, 1, 3, 4, 2, 5];
        body.sampler_order = parsedOrder;
        body.samplers = parsedOrder;
      }

      // Extended samplers
      const getSamplerOpt = (key, defaultVal = null) => {
        const isEnabled = options[`${key}_enabled`] ?? (isGenAI ? settings[`genai_${key}_enabled`] : settings[`${key}_enabled`]);
        if (isEnabled) {
          return options[key] ?? (isGenAI ? settings[`genai_${key}`] : settings[key]) ?? defaultVal;
        }
        return null;
      };

      const typicalP = getSamplerOpt('typical_p');
      if (typicalP !== null) { body.typical_p = typicalP; body.typical = typicalP; }
      const freqPen = getSamplerOpt('frequency_penalty');
      if (freqPen !== null) body.frequency_penalty = freqPen;
      const topA = getSamplerOpt('top_a');
      if (topA !== null) body.top_a = topA;
      const tfs = getSamplerOpt('tfs');
      if (tfs !== null) body.tfs = tfs;

      const mirostatEnabled = options.mirostat_enabled ?? (isGenAI ? settings.genai_mirostat_enabled : settings.mirostat_enabled);
      if (mirostatEnabled) {
        body.mirostat_mode = options.mirostat_mode ?? (isGenAI ? settings.genai_mirostat_mode : settings.mirostat_mode) ?? 0;
        body.mirostat_tau = options.mirostat_tau ?? (isGenAI ? settings.genai_mirostat_tau : settings.mirostat_tau) ?? 5.0;
        body.mirostat_eta = options.mirostat_eta ?? (isGenAI ? settings.genai_mirostat_eta : settings.mirostat_eta) ?? 0.1;
      }
      const xtcEnabled = options.xtc_enabled ?? (isGenAI ? settings.genai_xtc_enabled : settings.xtc_enabled);
      if (xtcEnabled) {
        body.xtc_threshold = options.xtc_threshold ?? (isGenAI ? settings.genai_xtc_threshold : settings.xtc_threshold) ?? 0.1;
        body.xtc_probability = options.xtc_probability ?? (isGenAI ? settings.genai_xtc_probability : settings.xtc_probability) ?? 0.0;
      }
      const dynatempEnabled = options.dynatemp_enabled ?? (isGenAI ? settings.genai_dynatemp_enabled : settings.dynatemp_enabled);
      if (dynatempEnabled) {
        body.dynatemp_range = options.dynatemp_range ?? (isGenAI ? settings.genai_dynatemp_range : settings.dynatemp_range) ?? 0.0;
        body.dynatemp_exponent = options.dynatemp_exponent ?? (isGenAI ? settings.genai_dynatemp_exponent : settings.dynatemp_exponent) ?? 1.0;
      }
      const topNSigma = getSamplerOpt('top_n_sigma');
      if (topNSigma !== null) { body.top_n_sigma = topNSigma; body.nsigma = topNSigma; }
      const repPenRangeEnabled = options.rep_pen_range_enabled ?? (isGenAI ? settings.genai_rep_pen_range_enabled : settings.rep_pen_range_enabled);
      if (repPenRangeEnabled) {
        body.rep_pen_range = options.rep_pen_range ?? (isGenAI ? settings.genai_rep_pen_range : settings.rep_pen_range) ?? 0;
        body.rep_pen_slope = options.rep_pen_slope ?? (isGenAI ? settings.genai_rep_pen_slope : settings.rep_pen_slope) ?? 1.0;
      }
      const minTokens = getSamplerOpt('min_tokens');
      if (minTokens !== null) body.min_tokens = minTokens;
      const cfgEnabled = options.guidance_scale_enabled ?? (isGenAI ? settings.genai_guidance_scale_enabled : settings.guidance_scale_enabled);
      if (cfgEnabled) {
        body.guidance_scale = options.guidance_scale ?? (isGenAI ? settings.genai_guidance_scale : settings.guidance_scale) ?? 1.0;
        const negPrompt = options.negative_prompt ?? (isGenAI ? settings.genai_negative_prompt : settings.negative_prompt);
        if (negPrompt) body.negative_prompt = negPrompt;
      }
      const ignoreEos = options.ignore_eos ?? (isGenAI ? settings.genai_ignore_eos : settings.ignore_eos);
      if (ignoreEos) { body.ignore_eos = true; body.ban_eos_token = true; }
      const bannedStrings = options.banned_strings ?? (isGenAI ? settings.genai_banned_strings : settings.banned_strings);
      if (bannedStrings) {
        body.banned_strings = typeof bannedStrings === 'string' ? bannedStrings.split(',').map(s => s.trim()).filter(Boolean) : bannedStrings;
      }

      // Add reasoning_effort parameter (KoboldCpp parameter for thinking budget)
      if (effort) {
        body.reasoning_effort = effort;
      }
      if (options.thinking_budget !== undefined) {
        body.thinking_budget = options.thinking_budget;
      }

      if (settings.jinja_adaptive_thinking ?? true) {
        body.chat_template_kwargs = {
          enable_thinking: !!(effort && effort !== 'none')
        };
      }

      try {
        if (combinedController.signal.aborted) {
          onDone();
          return;
        }

        const endpointPath = completionMode === 'text_completion' ? '/v1/completions' : '/v1/chat/completions';
        const effectiveUrl = localSyncService.isClientMode
          ? localSyncService.getRelayUrl()
          : `${settings.api_url}${endpointPath}`;

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

          if (window.__TAURI__ && window.__TAURI__.event) {
            unlisten = await window.__TAURI__.event.listen(`relay-chunk-${eventId}`, (event) => {
              const text = event.payload;
              buffer += text;
              const lines = buffer.split('\n');
              buffer = lines.pop();

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;

                const data = trimmed.slice(6);
                if (data === '[DONE]') {
                  continue;
                }

                try {
                  const parsed = JSON.parse(data);
                  const choice = parsed.choices?.[0];
                  const textChunk = choice?.text !== undefined ? choice.text : (choice?.delta?.content !== undefined ? choice.delta.content : null);
                  const reasoningChunk = choice?.delta?.reasoning_content || choice?.reasoning_content;

                  if (reasoningChunk && onThinkingChunk) {
                    onThinkingChunk(reasoningChunk);
                  }
                  if (textChunk) {
                    onChunk(textChunk);
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
          buffer = lines.pop();

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
              const choice = parsed.choices?.[0];
              const textChunk = choice?.text !== undefined ? choice.text : (choice?.delta?.content !== undefined ? choice.delta.content : null);
              const reasoningChunk = choice?.delta?.reasoning_content || choice?.reasoning_content;

              if (reasoningChunk && onThinkingChunk) {
                onThinkingChunk(reasoningChunk);
              }
              if (textChunk) {
                onChunk(textChunk);
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }

        onDone();
      } catch (err) {
        if (err.name === 'AbortError' || combinedController.signal.aborted) {
          const abortErr = new Error('Aborted');
          abortErr.name = 'AbortError';
          onError(abortErr);
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
  async generateGameScene(currentStats, previousSceneText, playerAction, prompt, noteToGM = '', gameSummary = '', remainingHistory = [], onChunk = null, language = 'English', storyPrompt = '', existingCharacters = [], options = {}) {
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
      const chatOptions = { ...options };
      if (chatOptions.reasoning_effort === undefined && settings.reasoning_effort) {
        chatOptions.reasoning_effort = settings.reasoning_effort;
      }
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
            const parsed = extractJsonFromText(fullResponse);
            if (parsed) {
              resolve(parsed);
            } else {
              reject(new Error("Failed to parse game scene JSON"));
            }
          } catch (err) {
            console.error('Failed to parse final JSON from game scene stream:', err, fullResponse);
            reject(err);
          }
        },
        (err) => reject(err),
        chatOptions
      );
    });
  },

  /**
   * Extracts and updates game characters from the latest scene (separate API call after scene generation)
   * Returns an array of character objects: [{ name, short_description }]
   */
  async updateGameCharacters(sceneText, existingCharacters = [], gameSummary = '', language = 'English', options = {}) {
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
      const response = await this.chatCompletion(messages, { ...options });
      const parsed = extractJsonFromText(response);
      return Array.isArray(parsed) ? parsed : [];
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
  async generateChatSummary(previousSummary, newMessages, userName, characterName, options = {}) {
    const summaryLength = options.summaryLength || 'default';
    const enableThinking = options.enableThinking ?? false;

    let lengthInstruction = "";
    if (summaryLength === 'short') {
      lengthInstruction = "Write a short, concise summary of key events and final outcome.";
    } else if (summaryLength === 'long') {
      lengthInstruction = "Write a detailed and comprehensive summary of ALL events in approximately 5 paragraphs.";
    } else {
      lengthInstruction = "Write a concise summary of ALL events, minor details, and outcome in approximately 2-3 paragraphs.";
    }

    const mandatoryRules = `MANDATORY RULES:
1. Write only the summary itself in the same language as the conversation, without any introductory remarks, greetings, or meta-commentary.
2. ALWAYS use explicit character names for all participants (who did what, who talked to whom, etc.). Give clear, direct descriptions of actions and events without vague metaphors or ambiguous pronouns.
3. ${lengthInstruction}
4. Do NOT continue chat or roleplay. You are writing a SUMMARY.`;

    let newMessagesText = "";
    newMessages.forEach((msg) => {
      const name = msg.role === 'user' ? userName : characterName;
      const content = msg.role === 'user' ? (msg.translated_content || msg.content) : (msg.original_text || msg.content);
      newMessagesText += `${name}: ${content}\n\n`;
    });

    let systemPrompt = "";
    if (previousSummary) {
      systemPrompt = `You are a professional chronicler and summarization agent.
${mandatoryRules}

Here is the EXISTING SUMMARY of the conversation so far:
"""
${previousSummary}
"""

Here are the NEW MESSAGES:
"""
${newMessagesText}
"""

Please update the existing summary with the new messages following all mandatory rules.`;
    } else {
      systemPrompt = `You are a professional chronicler and summarization agent.
${mandatoryRules}

Here are the MESSAGES in the conversation:
"""
${newMessagesText}
"""

Please write the summary of the conversation following all mandatory rules.`;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Generate the conversation summary.` }
    ];

    const settings = settingsStore.get();
    const reasoningEffort = enableThinking
      ? (settings.reasoning_effort && settings.reasoning_effort !== 'none' ? settings.reasoning_effort : 'medium')
      : 'none';

    try {
      return await this.chatCompletion(messages, {
        temperature: 0.5,
        max_tokens: summaryLength === 'long' ? 4096 : 2048,
        reasoning_effort: reasoningEffort
      });
    } catch (err) {
      console.error("Failed to generate chat summary:", err);
      throw err;
    }
  },

  /**
   * Generates a list of characters mentioned in the adventure history
   */
  async extractGameCharacters(gameSummary, history, options = {}) {
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
Return your response ONLY as a JSON array of strings or objects containing the character names/descriptions. Do not include any formatting, markdown code blocks, or greetings. Just the clean JSON array.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Story content:\n${scenesText}` }
    ];

    try {
      const response = await this.chatCompletion(messages, { ...options });
      const parsed = extractJsonFromText(response);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') {
        const arrayProp = Object.values(parsed).find(val => Array.isArray(val));
        if (arrayProp) return arrayProp;
      }
      return [];
    } catch (err) {
      console.error('Failed to extract characters:', err);
      return [];
    }
  },

  /**
   * Generates a detailed profile description for a given character based on adventure history
   */
  async generateCharacterDetails(characterName, gameSummary, history, options = {}) {
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
      const response = await this.chatCompletion(messages, { ...options });
      return stripThinkingTags(response);
    } catch (err) {
      console.error('Failed to generate character details:', err);
      throw err;
    }
  },

  /**
   * Count tokens for a given text using KoboldCpp's or llama.cpp's native token counter,
   * returning both the value and whether the calculation was precise (via API) or approximate.
   * @param {string} text
   * @param {AbortSignal} signal - Optional abort signal
   * @returns {Promise<{value: number, precise: boolean}>}
   */
  async countTokensDetailed(text, signal = null) {
    if (!text) return { value: 0, precise: true };

    // Safety check: if currently generating, do not request token counting from the LLM backend
    // to avoid overloading or crashing KoboldCpp. Use local character-based estimation instead.
    if (appState.isGenerating || (llmQueue && llmQueue.currentActive)) {
      return {
        value: Math.ceil(text.length / (/[а-яА-ЯёЁ]/.test(text) ? 2.3 : 3.3)),
        precise: false
      };
    }

    const settings = settingsStore.get();
    
    // Extract base URL (remove trailing /v1 or /v1/)
    let baseUrl = settings.api_url || 'http://localhost:5001';
    baseUrl = baseUrl.replace(/\/v1\/?$/, '');

    // Setup signal with timeout
    let fetchSignal = AbortSignal.timeout(2000);
    if (signal) {
      if (typeof AbortSignal.any === 'function') {
        fetchSignal = AbortSignal.any([signal, AbortSignal.timeout(2000)]);
      } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        signal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          controller.abort();
        });
        fetchSignal = controller.signal;
      }
    }

    // 1. Try KoboldCpp's native tokencount
    try {
      const resp = await fetch(`${baseUrl}/api/extra/tokencount`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
        signal: fetchSignal,
      });
      if (resp.ok) {
        const data = await resp.json();
        if (typeof data.value === 'number') {
          return { value: data.value, precise: true };
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
        signal: fetchSignal,
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.tokens && Array.isArray(data.tokens)) {
          return { value: data.tokens.length, precise: true };
        }
      }
    } catch (e) {
      // Fail silently and use fallback
    }

    // Fallback to modern token characters-per-token ratio (Llama 3, Gemma 2, Qwen 2, Gemini)
    // English: ~3.3 chars/token. Cyrillic: ~2.3 chars/token.
    return {
      value: Math.ceil(text.length / (/[а-яА-ЯёЁ]/.test(text) ? 2.3 : 3.3)),
      precise: false
    };
  },

  /**
   * Count tokens for a given text (compatibility wrapper)
   * @param {string} text
   * @returns {Promise<number>}
   */
  async countTokens(text) {
    const res = await this.countTokensDetailed(text);
    return res.value;
  },

  /**
   * Count tokens for a messages array by formatting it into a ChatML prompt
   * returning both the value and whether the calculation was precise or approximate.
   * @param {Array} messages
   * @param {AbortSignal} signal - Optional abort signal
   * @returns {Promise<{value: number, precise: boolean}>}
   */
  async countMessagesTokensDetailed(messages, signal = null) {
    if (!messages || messages.length === 0) return { value: 0, precise: true };
    
    const settings = settingsStore.get();
    const processedMessages = preprocessMessages(messages, settings);

    // Format the messages array into a single ChatML-like string
    let formattedText = '';
    for (const msg of processedMessages) {
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
      if (msg.tool_calls) {
        contentText += ' ' + JSON.stringify(msg.tool_calls);
      }
      formattedText += `<|im_start|>${role}\n${contentText}<|im_end|>\n`;
    }
    formattedText += `<|im_start|>assistant\n`;
    
    return await this.countTokensDetailed(formattedText, signal);
  },

  /**
   * Count tokens for a messages array (compatibility wrapper)
   * @param {Array} messages
   * @returns {Promise<number>}
   */
  async countMessagesTokens(messages) {
    const res = await this.countMessagesTokensDetailed(messages);
    return res.value;
  },

  /**
   * Fetch current max context length configured in KoboldCpp or llama.cpp properties
   * @returns {Promise<number>}
   */
  async getMaxContextLength() {
    const settings = settingsStore.get();
    
    // Safety check: if currently generating, do not request config settings from the LLM backend
    // to avoid overloading/crashing KoboldCpp. Use local settings fallback.
    if (appState.isGenerating || (llmQueue && llmQueue.currentActive)) {
      return settings.prompt_token_limit || 4096;
    }
    
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
  },

  async generateChatName(messages, isCharacterChat = true) {
    // Collect recent messages (up to 8) to evaluate context and language
    const recentMessages = messages.slice(-8).map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`).join('\n');
    
    let prompt = `You are an AI that creates very short, concise titles for chat sessions based on the provided conversation excerpt.\n`;
    if (isCharacterChat) {
      prompt += `Focus on the user's interaction and the AI's response, rather than the initial character greeting or description.\n`;
    }
    prompt += `CRITICAL RULE: The chat title MUST be written in the primary language in which the majority of the messages in the conversation are written (for example, if the majority of messages are in Russian, the title MUST be in Russian).\n`;
    prompt += `Return ONLY the short title (maximum 3-4 words), without quotes, punctuation, or any other commentary.\n\nConversation excerpt:\n${recentMessages}\n\nTitle:`;

    try {
      const response = await this.chatCompletion([
        { role: 'system', content: prompt }
      ], {
        max_tokens: 30,
        reasoning_effort: 'none',
        thinking_budget: 0,
        isGenAI: !isCharacterChat
      });
      
      let title = response.trim();
      // Remove any surrounding quotes
      title = title.replace(/^["']|["']$/g, '').trim();
      return title || 'New Chat';
    } catch (e) {
      console.error('Failed to generate chat name:', e);
      return 'New Chat';
    }
  }
};

