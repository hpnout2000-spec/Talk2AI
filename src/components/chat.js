/* ════════════════════════════════════════════════════════════════════
   Chat Component — Main chat interface
   ════════════════════════════════════════════════════════════════════ */

import { showToast, checkConnection, showConfirm } from '../main.js';
import { appState } from '../state.js';
import { chatStore } from '../services/chat-store.js';
import { characterStore } from '../services/character-store.js';
import { api } from '../services/api.js';
import { settingsStore } from '../services/settings-store.js';
import { memoryService } from '../services/memory-service.js';
import {
  renderMarkdown,
  parseThinking,
  autoResizeTextarea,
  formatTime,
  escapeHtml,
  wrapWordsInSpans,
} from '../utils/helpers.js';
import morphdom from '../vendor/morphdom.js';

// ─── DOM Elements ───────────────────────────────────────────────────

let messagesContainer;
let messageInput;
let btnSend;
let btnStop;
let emptyState;
let headerCharName;
let headerCharStatus;
let headerAvatar;
let thinkingToggle;
let btnInputSettings;
let inputSettingsPopover;

// ─── Init ───────────────────────────────────────────────────────────

export function initChat() {
  messagesContainer = document.getElementById('chat-messages');
  messageInput = document.getElementById('message-input');
  btnSend = document.getElementById('btn-send');
  btnStop = document.getElementById('btn-stop');
  emptyState = document.getElementById('empty-state');
  headerCharName = document.getElementById('header-char-name');
  headerCharStatus = document.getElementById('header-char-status');
  headerAvatar = document.getElementById('header-avatar');
  thinkingToggle = document.getElementById('thinking-toggle');
  btnInputSettings = document.getElementById('btn-input-settings');
  inputSettingsPopover = document.getElementById('input-settings-popover');

  // Send message
  btnSend.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize input
  messageInput.addEventListener('input', () => {
    autoResizeTextarea(messageInput);

    // Fade out continuation options when typing
    if (messageInput.value.trim().length > 0) {
      const options = messagesContainer.querySelectorAll('.continuation-options:not(.fade-out)');
      options.forEach(opt => {
        opt.classList.add('fade-out');
        setTimeout(() => opt.remove(), 400); // match animation duration

        // Also clear options from the store for the corresponding message
        const msgEl = opt.closest('.message');
        if (msgEl) {
          const msgId = msgEl.dataset.messageId;
          const session = chatStore.getCurrentSession();
          if (session) {
            const msg = session.messages.find(m => m.id === msgId);
            if (msg) {
              delete msg.options;
              chatStore.saveCurrentSession();
            }
          }
        }
      });
    }
  });

  // Stop generation
  btnStop.addEventListener('click', stopGeneration);

  // Thinking toggle
  thinkingToggle.addEventListener('change', () => {
    const settings = settingsStore.get();
    settingsStore.save({ ...settings, thinking_enabled: thinkingToggle.checked });

    // Sync settings panel toggle
    const settingsThinking = document.getElementById('setting-thinking');
    if (settingsThinking) settingsThinking.checked = thinkingToggle.checked;
  });

  // New chat button
  document.getElementById('btn-new-chat').addEventListener('click', () => {
    if (!appState.currentCharacter) {
      showToast('Select a character first', 'error');
      return;
    }
    startNewChat();
  });

  // Input Settings Popover
  if (btnInputSettings) {
    btnInputSettings.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleInputSettings();
    });
  }

  document.addEventListener('click', (e) => {
    if (inputSettingsPopover && !inputSettingsPopover.contains(e.target) && (!btnInputSettings || !btnInputSettings.contains(e.target))) {
      inputSettingsPopover.classList.add('hidden');
    }
  });
}

function toggleInputSettings() {
  const isHidden = inputSettingsPopover.classList.contains('hidden');
  if (isHidden) {
    renderInputSettings();
    inputSettingsPopover.classList.remove('hidden');
  } else {
    inputSettingsPopover.classList.add('hidden');
  }
}

function renderInputSettings() {
  const settings = settingsStore.get();
  const length = settings.response_length || 'auto';
  const depth = settings.description_depth || 0;

  inputSettingsPopover.innerHTML = `
    <div class="settings-group">
      <h4>Response Length</h4>
      <div class="response-length-selector">
        ${['auto', 'short', 'medium', 'long'].map(l => `
          <button class="length-option ${length === l ? 'active' : ''}" data-length="${l}">
            ${l}
          </button>
        `).join('')}
      </div>
    </div>
    <div class="settings-group">
      <h4>Description Depth</h4>
      <div class="description-depth-slider">
        <input type="range" id="input-depth-slider" min="0" max="4" step="1" value="${depth}">
        <div class="depth-labels">
          <span>Auto</span>
          <span>1</span>
          <span>2</span>
          <span>3</span>
          <span>Max</span>
        </div>
      </div>
    </div>
    <div class="settings-group" style="margin-top: 12px; border-top: 1px solid var(--border-subtle); padding-top: 12px;">
      <button id="btn-open-advanced" class="btn-secondary btn-full" style="gap: 8px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <span>Advanced settings</span>
      </button>
    </div>
  `;

  // Handlers
  inputSettingsPopover.querySelectorAll('.length-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const newLength = btn.dataset.length;
      settingsStore.save({ ...settingsStore.get(), response_length: newLength });
      renderInputSettings();
    });
  });

  const slider = inputSettingsPopover.querySelector('#input-depth-slider');
  slider.addEventListener('input', () => {
    const newDepth = parseInt(slider.value);
    settingsStore.save({ ...settingsStore.get(), description_depth: newDepth });
  });

  const btnAdv = inputSettingsPopover.querySelector('#btn-open-advanced');
  btnAdv.addEventListener('click', () => {
    inputSettingsPopover.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('open-advanced-settings'));
  });
}

// ─── Start New Chat ─────────────────────────────────────────────────

export function startNewChat(character = null) {
  const char = character || appState.currentCharacter;
  if (!char) return;

  const session = chatStore.createSession(char.id);

  // Only update global appState if this character is active
  if (appState.currentCharacter?.id === char.id) {
    appState.currentChat = session;
    clearMessages();
  }

  // Show first message if character has one
  if (char.first_message) {
    const settings = settingsStore.get();
    const userName = settings.user_name || 'User';
    let content = char.first_message.replace(/\{\{user\}\}/gi, userName);
    content = content.replace(/\{\{char\}\}/gi, char.name);

    const msg = chatStore.addMessage('assistant', content, null, session);
    characterStore.updateLastChat(char.id);
    if (appState.currentCharacter?.id === char.id) {
      appendMessage(msg, false, char);
    }
  }

  chatStore.saveSession(session);
  if (appState.currentCharacter?.id === char.id) {
    updateChatHistory();
  }
}

// ─── Load Existing Chat ─────────────────────────────────────────────

export function loadChat(session) {
  if (appState.currentCharacter?.id !== session.character_id) return;
  appState.currentChat = session;
  chatStore.setCurrentSession(session);
  clearMessages();

  for (const msg of session.messages) {
    appendMessage(msg);
  }

  scrollToBottom();
}

// ─── Select Character ───────────────────────────────────────────────

export async function selectCharacter(character) {
  const charId = character.id;
  appState.currentCharacter = character;

  // Update header
  headerCharName.textContent = character.name;
  headerCharStatus.textContent = 'Ready';

  if (character.avatar) {
    headerAvatar.innerHTML = `<img src="${character.avatar}" alt="${escapeHtml(character.name)}">`;
  } else {
    headerAvatar.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
    </svg>`;
  }

  // Load chats for this character
  await chatStore.loadForCharacter(charId);

  // Check if this character is still the active one before proceeding
  if (appState.currentCharacter?.id !== charId) return;

  const sessions = chatStore.getSessions(charId);

  // Load memory
  await memoryService.loadForCharacter(charId);

  if (appState.currentCharacter?.id !== charId) return;

  if (sessions.length > 0) {
    // Load most recent chat
    loadChat(sessions[0]);
  } else {
    // Start a new chat
    startNewChat(character);
  }

  updateChatHistory();
}

// ─── Send Message ───────────────────────────────────────────────────

/**
 * Smoothly replaces text in an element with a translation from a stream
 * @param {HTMLElement} contentEl
 * @param {string} textToTranslate
 * @param {string} targetLang
 * @returns {Promise<string>}
 */
async function performStreamingTranslation(contentEl, textToTranslate, targetLang) {
  let fullTranslatedBuffer = '';

  await new Promise((resolve) => {
    api.streamTranslate(
      textToTranslate,
      targetLang,
      (chunk) => {
        fullTranslatedBuffer += chunk;

        const targetHtml = wrapWordsInSpans(renderMarkdown(fullTranslatedBuffer));
        const temp = document.createElement('div');
        temp.innerHTML = targetHtml;

        morphdom(contentEl, temp, {
          childrenOnly: true,
          getNodeKey: (node) => node.dataset?.wordIndex || node.id || node.className,
          onBeforeElUpdated: (from, to) => {
            if (from.classList.contains('word-blur') && from.textContent !== to.textContent) {
              from.classList.add('word-replacing-out');
              setTimeout(() => {
                from.textContent = to.textContent;
                from.classList.remove('word-replacing-out');
                from.classList.add('word-replacing-in');
                setTimeout(() => from.classList.remove('word-replacing-in'), 400);
              }, 120);
              return false;
            }
            return true;
          },
          onNodeAdded: (node) => {
            if (node.classList?.contains('word-blur')) {
              node.classList.add('word-replacing-in');
              setTimeout(() => node.classList.remove('word-replacing-in'), 400);
            }
          },
        });
      },
      () => resolve(),
      (err) => {
        console.error('Translation stream error:', err);
        resolve();
      }
    );
  });

  return fullTranslatedBuffer;
}

// ─── Send Message ───────────────────────────────────────────────────

async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content || appState.isGenerating) return;

  const settings = settingsStore.get();
  const character = appState.currentCharacter;
  if (!character) {
    showToast('Select a character first', 'error');
    return;
  }

  if (!appState.currentChat) {
    startNewChat(character);
  }
  const session = appState.currentChat;

  // Add user message
  const userMsg = chatStore.addMessage('user', content, null, session);
  characterStore.updateLastChat(character.id);
  const userMsgElement = appendMessage(userMsg, false, character);
  const userContentEl = userMsgElement.querySelector('.message-text');

  // Clear input
  messageInput.value = '';
  autoResizeTextarea(messageInput);

  // If outgoing translation is enabled, translate first
  if (settings.translate_user_messages) {
    headerCharStatus.textContent = 'Translating your message...';
    headerCharStatus.classList.add('generating');
    const target = settings.outgoing_target_language || 'English';
    const translated = await performStreamingTranslation(userContentEl, content, target);
    if (translated) {
      chatStore.updateMessage(userMsg.id, { translated_content: translated });
      await chatStore.saveSession(session);
    }
    headerCharStatus.textContent = 'Ready';
    headerCharStatus.classList.remove('generating');
  }

  // Start generation
  appState.isGenerating = true;
  appState.abortController = new AbortController();
  btnSend.classList.add('hidden');
  btnStop.classList.remove('hidden');
  headerCharStatus.textContent = 'Generating...';
  headerCharStatus.classList.add('generating');

  // Build messages array for API (will use translated_content for user messages if available)
  const apiMessages = buildApiMessages(character, session);

  // Add placeholder assistant message
  const assistantMsg = chatStore.addMessage('assistant', '', null, session);
  const msgElement = appendMessage(assistantMsg, true, character);
  const contentEl = msgElement.querySelector('.message-text');

  let fullResponse = '';
  let thinkingContent = '';
  let isInThinking = false;

  // Dynamic options override
  const apiOptions = {};
  if (settings.response_length === 'short') {
    // Cap max_tokens to prevent long responses, but allow buffer for thinking
    const thinkingBuffer = settings.thinking_enabled ? 1024 : 0;
    apiOptions.max_tokens = Math.min(settings.max_tokens, 256 + thinkingBuffer);
  }

  try {
    await api.streamChat(
      apiMessages,
      appState.abortController.signal,
      // onChunk
      (chunk) => {
        fullResponse += chunk;

        // Throttle UI updates to requestAnimationFrame for maximum smoothness
        if (appState.updateScheduled) return;
        appState.updateScheduled = true;

        requestAnimationFrame(() => {
          appState.updateScheduled = false;
          
          const parsed = parseStreamThinking(fullResponse);
          thinkingContent = parsed.thinking;
          let displayContent = parsed.content;
          isInThinking = parsed.isInThinking;

          if (!isInThinking && displayContent.startsWith('*') && !displayContent.endsWith('*')) {
            displayContent += '*';
          }

          let html = '';
          if (thinkingContent) {
            html += createThinkingBlockHTML(thinkingContent, isInThinking);
          }
          html += wrapWordsInSpans(renderMarkdown(displayContent));

          if (!isInThinking) {
            const cursorHtml = '<span class="streaming-cursor"></span>';
            if (html.includes('</')) {
              html = html.replace(/(<\/([a-z0-9]+)>)$/i, cursorHtml + '$1');
            } else {
              html += cursorHtml;
            }
          }

          const temp = document.createElement('div');
          temp.className = contentEl.className;
          temp.innerHTML = html;
          morphdom(contentEl, temp, { 
            childrenOnly: true,
            getNodeKey: (node) => node.dataset?.wordIndex || node.id || node.className
          });
        });
      },
      // onDone
      async () => {
        let parsed = parseThinking(fullResponse);

        // Final render to remove cursor
        let finalHtml = '';
        if (parsed.thinking) {
          finalHtml += createThinkingBlockHTML(parsed.thinking, false);
        }
        finalHtml += wrapWordsInSpans(renderMarkdown(parsed.content));

        const tempFinal = document.createElement('div');
        tempFinal.className = contentEl.className;
        tempFinal.innerHTML = finalHtml;
        morphdom(contentEl, tempFinal, { 
          childrenOnly: true,
          getNodeKey: (node) => node.dataset?.wordIndex || node.id || node.className
        });

        const originalContent = parsed.content;
        let translatedContent = null;

        // Auto-translation (AI response)
        if (settings.auto_translate && originalContent) {
          headerCharStatus.textContent = 'Translating...';
          headerCharStatus.classList.add('generating');
          translatedContent = await performStreamingTranslation(contentEl, originalContent, settings.target_language);
        }

        chatStore.updateLastAssistantMessage(originalContent, parsed.thinking, session, translatedContent);
        await chatStore.saveSession(session);

        if (appState.currentCharacter?.id === character.id) {
          appState.isGenerating = false;
          appState.abortController = null;
          btnSend.classList.remove('hidden');
          btnStop.classList.add('hidden');
          headerCharStatus.textContent = 'Ready';
          headerCharStatus.classList.remove('generating');
          updateChatHistory();
          scrollToBottom();
        }

        if (originalContent) {
          await extractAndShowMemory(character, session, content, originalContent, msgElement);
          generateContinuationOptions(character, session, msgElement);
        }

        checkConnection();
      },
      // onError
      (err) => {
        console.error('Stream error:', err);
        contentEl.innerHTML = `<p style="color: var(--error)">Error: ${escapeHtml(err.message)}</p>`;

        if (appState.currentCharacter?.id === character.id) {
          appState.isGenerating = false;
          appState.abortController = null;
          btnSend.classList.remove('hidden');
          btnStop.classList.add('hidden');
          headerCharStatus.textContent = 'Error';
          headerCharStatus.classList.remove('generating');
        }
      },
      apiOptions
    );
  } catch (err) {
    console.error('Send error:', err);
    showToast('Failed to send message', 'error');
    if (appState.currentCharacter?.id === character.id) {
      appState.isGenerating = false;
    }
  }
}

// ─── Memory Extraction ──────────────────────────────────────────────

async function extractAndShowMemory(character, session, userMessage, assistantResponse, msgElement) {
  try {
    const newEntries = await memoryService.extractMemories(
      character.id,
      userMessage,
      assistantResponse
    );

    if (newEntries.length > 0) {
      // Show notification only if this message is still in the DOM
      if (msgElement.isConnected) {
        const notification = document.createElement('div');
        notification.className = 'memory-notification';
        notification.innerHTML = `
          <span class="memory-icon">📝</span>
          <span>${newEntries.length} memor${newEntries.length === 1 ? 'y' : 'ies'} saved</span>
        `;
        msgElement.querySelector('.message-body').appendChild(notification);
        scrollToBottom();
      }

      // Refresh memory panel if it belongs to the current character
      if (appState.currentCharacter?.id === character.id) {
        const event = new CustomEvent('memory-updated', {
          detail: { characterId: character.id },
        });
        window.dispatchEvent(event);
      }
    }
  } catch (e) {
    console.warn('Memory extraction background error:', e);
  }
}

// ─── Build API Messages ─────────────────────────────────────────────

function buildApiMessages(character, session) {
  if (!character || !session) return [];

  const settings = settingsStore.get();
  const userName = settings.user_name || 'User';
  const messages = [];

  // System prompt with character info and memory
  let systemContent = '';

  if (character.system_prompt) {
    systemContent = character.system_prompt;
  } else {
    // Use active preset if available, otherwise build from fields
    const activePresetId = settings.active_system_prompt_preset_id;
    const presets = settings.system_prompt_presets || [];
    const activePreset = presets.find(p => p.id === activePresetId);

    if (activePreset) {
      systemContent = activePreset.content;
      // Inject character fields into the preset if they exist
      const description = character.description || '';
      const personality = character.personality ? `Personality: ${character.personality}` : '';
      const scenario = character.scenario ? `Scenario: ${character.scenario}` : '';
      
      // Replace placeholders
      systemContent = systemContent.replace(/\{\{description\}\}/gi, description);
      systemContent = systemContent.replace(/\{\{personality\}\}/gi, personality);
      systemContent = systemContent.replace(/\{\{scenario\}\}/gi, scenario);
    } else {
      // Fallback to building from fields
      const parts = [];
      if (character.description) parts.push(character.description);
      if (character.personality) parts.push(`Personality: ${character.personality}`);
      if (character.scenario) parts.push(`Scenario: ${character.scenario}`);
      systemContent = parts.join('\n\n') || `You are ${character.name}.`;
    }
  }

  // Replace placeholders
  systemContent = systemContent.replace(/\{\{user\}\}/gi, userName);
  systemContent = systemContent.replace(/\{\{char\}\}/gi, character.name);

  // Inject memory context
  const memoryContext = memoryService.getMemoryContext(character.id);
  if (memoryContext) {
    systemContent += memoryContext;
  }

  messages.push({ role: 'system', content: systemContent });

  // Add formatting instructions based on settings
  const formattingInstructions = [];

  // Response Length
  if (settings.response_length === 'short') {
    formattingInstructions.push("Write extremely short, brief, and concise responses. Limit yourself to 1-2 sentences maximum. No fluff.");
  } else if (settings.response_length === 'medium') {
    formattingInstructions.push("Write moderately detailed and balanced responses, typically 2-3 paragraphs.");
  } else if (settings.response_length === 'long') {
    formattingInstructions.push("Write very long, detailed, and expansive responses. Elaborate on everything and be as verbose as possible.");
  }

  // Description Depth
  if (settings.description_depth > 0) {
    const depthPrompts = [
      "",
      "Add brief descriptions of the scene.",
      "Include vivid and clear descriptions of the environment and atmosphere.",
      "Provide highly detailed and immersive scene descriptions with sensory details.",
      "Describe every scene with extreme detail and atmosphere, focusing on deep sensory information, textures, sounds, and intense character introspection. Be extremely descriptive."
    ];
    formattingInstructions.push(depthPrompts[settings.description_depth]);
  }

  if (formattingInstructions.length > 0) {
    messages.push({
      role: 'system',
      content: `[MANDATORY FORMATTING RULES]\n${formattingInstructions.join("\n")}`
    });
  }

  // Chat messages (skip empty assistant messages)
  for (const msg of session.messages) {
    if (msg.role === 'system') continue;
    if (msg.role === 'assistant' && !msg.content) continue;

    // For user messages, use translation (English) if available
    // For assistant messages, we stored original English in content
    let content = msg.role === 'user' ? (msg.translated_content || msg.content) : msg.content;
    messages.push({ role: msg.role, content: content });
  }

  return messages;
}

// ─── Parse Streaming Thinking ───────────────────────────────────────

function parseStreamThinking(text) {
  // Try to find the start tag
  const startMatch = text.match(/<\|?think\|?>|<reasoning>/);
  if (!startMatch) {
    return { thinking: '', content: text, isInThinking: false };
  }

  const thinkStart = startMatch[0];
  const startIdx = startMatch.index;
  const afterStart = startIdx + thinkStart.length;

  // Try to find the end tag
  const endMatch = text.substring(afterStart).match(/<\|?\/think\|?>|<\/reasoning>/);

  if (!endMatch) {
    // Still in thinking
    const thinking = text.substring(afterStart);
    const content = text.substring(0, startIdx);
    return { thinking, content, isInThinking: true };
  } else {
    // Thinking complete
    const endIdx = afterStart + endMatch.index;
    const thinkEnd = endMatch[0];
    const thinking = text.substring(afterStart, endIdx);
    const content = text.substring(0, startIdx) + text.substring(endIdx + thinkEnd.length);
    return { thinking, content: content.trim(), isInThinking: false };
  }
}

// ─── Create Thinking Block HTML ─────────────────────────────────────

function createThinkingBlockHTML(thinkingText, isActive) {
  return `
    <div class="thinking-inline">
      <div class="thinking-inline-header">
        <span class="${isActive ? 'brain-icon' : ''}">🧠</span>
        <span class="${isActive ? 'thinking-text-animated' : ''}">Thinking...</span>
      </div>
      <div class="thinking-inline-content">${escapeHtml(thinkingText)}</div>
    </div>
  `;
}

// ─── Stop Generation ────────────────────────────────────────────────

function stopGeneration() {
  if (appState.abortController) {
    appState.abortController.abort();
  }
}

// ─── DOM Helpers ────────────────────────────────────────────────────

function clearMessages() {
  messagesContainer.innerHTML = '';
  emptyState = null;
}

function appendMessage(msg, isStreaming = false, character = null) {
  // Remove empty state if present
  const empty = messagesContainer.querySelector('.empty-state');
  if (empty) empty.remove();

  const el = document.createElement('div');
  el.className = `message ${msg.role} message-enter`;
  el.dataset.messageId = msg.id;

  const isUser = msg.role === 'user';
  // Use passed character or fallback to global (not ideal but safe for non-leaking cases)
  const char = character || appState.currentCharacter;

  let avatarHtml;
  if (isUser) {
    avatarHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
    </svg>`;
  } else if (char?.avatar) {
    avatarHtml = `<img src="${char.avatar}" alt="${escapeHtml(char.name)}">`;
  } else {
    avatarHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
    </svg>`;
  }

  let contentHtml = '';
  if (msg.thinking) {
    contentHtml += createThinkingBlockHTML(msg.thinking, false);
  }
  const displayContent = msg.translated_content || msg.content;
  contentHtml += renderMarkdown(displayContent);

  el.innerHTML = `
    <div class="message-avatar">${avatarHtml}</div>
    <div class="message-body">
      <div class="message-content">
        <div class="message-text">${contentHtml || (isStreaming ? '<span class="streaming-cursor"></span>' : '')}</div>
      </div>
      <div class="message-meta">
        <span class="message-time">${formatTime(msg.timestamp)}</span>
        <div class="message-actions">
          <button class="btn-regenerate hidden" title="Regenerate">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
          </button>
          <button class="btn-edit-msg" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn-translate-msg" title="Translate">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 8l6 6M19 8l-6 6M5 16l6-6M19 16l-6-6"/>
              <path d="M2 12h20M12 2v20"/>
            </svg>
          </button>
          <button class="btn-copy" title="Copy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button class="btn-delete-msg delete" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;

  // Translate button
  el.querySelector('.btn-translate-msg')?.addEventListener('click', async () => {
    const settings = settingsStore.get();
    const contentEl = el.querySelector('.message-text');
    const target = msg.role === 'user' ? (settings.outgoing_target_language || 'English') : (settings.target_language || 'Russian');

    headerCharStatus.textContent = 'Translating message...';
    headerCharStatus.classList.add('generating');

    // Ensure spans exist for the replacement effect
    if (!contentEl.querySelector('.word-blur')) {
      const displayContent = msg.translated_content || msg.content;
      contentEl.innerHTML = wrapWordsInSpans(renderMarkdown(displayContent));
    }

    const translated = await performStreamingTranslation(contentEl, msg.content, target);
    if (translated) {
      chatStore.updateMessage(msg.id, { translated_content: translated });
      await chatStore.saveSession(appState.currentChat);
    }

    headerCharStatus.textContent = 'Ready';
    headerCharStatus.classList.remove('generating');
  });

  // Copy button
  el.querySelector('.btn-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(msg.translated_content || msg.content);
    showToast('Copied to clipboard');
  });

  // Delete button
  el.querySelector('.btn-delete-msg')?.addEventListener('click', () => {
    chatStore.deleteMessage(msg.id);
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => el.remove(), 300);
    chatStore.saveCurrentSession();
    updateRegenerateVisibility();
  });

  // Edit button
  el.querySelector('.btn-edit-msg')?.addEventListener('click', () => {
    enterEditMode(msg, el);
  });

  // Regenerate button
  const btnRegen = el.querySelector('.btn-regenerate');
  btnRegen?.addEventListener('click', () => {
    regenerateResponse(msg, el);
  });

  messagesContainer.appendChild(el);
  updateRegenerateVisibility();
  scrollToBottom();

  // Render continuation options if they exist
  if (msg.options && msg.options.length > 0) {
    renderContinuationOptions(el, msg.options);
  }

  return el;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

// ─── Edit & Regenerate Logic ────────────────────────────────────────

function updateRegenerateVisibility() {
  // Only the last assistant message should have the regenerate button
  const allMessages = messagesContainer.querySelectorAll('.message');
  allMessages.forEach(m => m.querySelector('.btn-regenerate')?.classList.add('hidden'));

  const lastMsg = allMessages[allMessages.length - 1];
  if (lastMsg && lastMsg.classList.contains('assistant') && !appState.isGenerating) {
    lastMsg.querySelector('.btn-regenerate')?.classList.remove('hidden');
  }
}

function enterEditMode(msg, msgEl) {
  const contentEl = msgEl.querySelector('.message-text');
  const originalHtml = contentEl.innerHTML;
  const originalContent = msg.content;

  // Create editor
  const editor = document.createElement('div');
  editor.className = 'message-edit-container';
  editor.innerHTML = `
    <textarea class="message-edit-textarea">${originalContent}</textarea>
    <div class="edit-actions">
      <button class="btn-cancel-edit btn-secondary small">Cancel</button>
      <button class="btn-save-edit btn-primary small">Save</button>
    </div>
  `;

  contentEl.style.display = 'none';
  msgEl.querySelector('.message-body').insertBefore(editor, msgEl.querySelector('.message-meta'));

  const textarea = editor.querySelector('.message-edit-textarea');
  autoResizeTextarea(textarea);
  textarea.focus();
  textarea.selectionStart = textarea.value.length;

  textarea.addEventListener('input', () => autoResizeTextarea(textarea));

  editor.querySelector('.btn-cancel-edit').addEventListener('click', () => {
    editor.remove();
    contentEl.style.display = 'block';
  });

  editor.querySelector('.btn-save-edit').addEventListener('click', async () => {
    const newContent = textarea.value.trim();
    if (newContent && newContent !== originalContent) {
      chatStore.updateMessage(msg.id, { content: newContent, translated_content: null });
      await chatStore.saveCurrentSession();
      
      // Update UI
      msg.content = newContent;
      msg.translated_content = null;
      contentEl.innerHTML = renderMarkdown(newContent);
    }
    editor.remove();
    contentEl.style.display = 'block';
  });
}

async function regenerateResponse(msg, msgEl) {
  if (appState.isGenerating) return;

  // Remove the message from UI and store
  chatStore.deleteMessage(msg.id);
  msgEl.remove();
  await chatStore.saveCurrentSession();

  // Trigger new generation
  // We need to call sendMessage but without adding a new user message
  // Let's create a specialized trigger for this
  triggerAssistantGeneration();
}

async function triggerAssistantGeneration() {
  if (appState.isGenerating || !appState.currentCharacter || !appState.currentChat) return;

  const character = appState.currentCharacter;
  const session = appState.currentChat;
  const settings = settingsStore.get();

  // Start generation
  appState.isGenerating = true;
  appState.abortController = new AbortController();
  btnSend.classList.add('hidden');
  btnStop.classList.remove('hidden');
  headerCharStatus.textContent = 'Generating...';
  headerCharStatus.classList.add('generating');

  // Build messages
  const apiMessages = buildApiMessages(character, session);

  // Add placeholder
  const assistantMsg = chatStore.addMessage('assistant', '', null, session);
  const msgElement = appendMessage(assistantMsg, true, character);
  const contentEl = msgElement.querySelector('.message-text');

  let fullResponse = '';
  const apiOptions = {};
  if (settings.response_length === 'short') {
    const thinkingBuffer = settings.thinking_enabled ? 1024 : 0;
    apiOptions.max_tokens = Math.min(settings.max_tokens, 256 + thinkingBuffer);
  }

  try {
    await api.streamChat(
      apiMessages,
      appState.abortController.signal,
      (chunk) => {
        fullResponse += chunk;
        const parsed = parseStreamThinking(fullResponse);
        let displayContent = parsed.content;
        const thinkingContent = parsed.thinking;
        const isInThinking = parsed.isInThinking;

        if (!isInThinking && displayContent.startsWith('*') && !displayContent.endsWith('*')) {
          displayContent += '*';
        }

        let html = '';
        if (thinkingContent) html += createThinkingBlockHTML(thinkingContent, isInThinking);
        html += wrapWordsInSpans(renderMarkdown(displayContent));

        if (!isInThinking) {
          const cursorHtml = '<span class="streaming-cursor"></span>';
          if (html.includes('</')) html = html.replace(/(<\/([a-z0-9]+)>)$/i, cursorHtml + '$1');
          else html += cursorHtml;
        }

        const temp = document.createElement('div');
        temp.className = contentEl.className;
        temp.innerHTML = html;
        morphdom(contentEl, temp, { childrenOnly: true });
      },
      async () => {
        const parsed = parseThinking(fullResponse);
        let finalHtml = '';
        if (parsed.thinking) finalHtml += createThinkingBlockHTML(parsed.thinking, false);
        finalHtml += wrapWordsInSpans(renderMarkdown(parsed.content));

        const tempFinal = document.createElement('div');
        tempFinal.className = contentEl.className;
        tempFinal.innerHTML = finalHtml;
        morphdom(contentEl, tempFinal, { childrenOnly: true });

        const originalContent = parsed.content;
        let translatedContent = null;
        if (settings.auto_translate && originalContent) {
          headerCharStatus.textContent = 'Translating...';
          translatedContent = await performStreamingTranslation(contentEl, originalContent, settings.target_language);
        }

        chatStore.updateLastAssistantMessage(originalContent, parsed.thinking, session, translatedContent);
        await chatStore.saveSession(session);

        appState.isGenerating = false;
        appState.abortController = null;
        btnSend.classList.remove('hidden');
        btnStop.classList.add('hidden');
        headerCharStatus.textContent = 'Ready';
        headerCharStatus.classList.remove('generating');
        updateChatHistory();
        updateRegenerateVisibility();
        scrollToBottom();

        if (originalContent) {
          // Note: we don't have the userMessage here easily in regenerate mode, 
          // but we can skip memory extraction for regeneration or fetch last user message
          const lastUserMsg = session.messages.slice().reverse().find(m => m.role === 'user');
          if (lastUserMsg) {
            await extractAndShowMemory(character, session, lastUserMsg.content, originalContent, msgElement);
          }
          generateContinuationOptions(character, session, msgElement);
        }
      },
      (err) => {
        console.error('Regeneration error:', err);
        appState.isGenerating = false;
        btnSend.classList.remove('hidden');
        btnStop.classList.add('hidden');
        headerCharStatus.textContent = 'Error';
        headerCharStatus.classList.remove('generating');
      },
      apiOptions
    );
  } catch (err) {
    console.error('Regeneration try/catch error:', err);
    appState.isGenerating = false;
  }
}

// ─── Update Chat History Sidebar ────────────────────────────────────

export function updateChatHistory() {
  if (!appState.currentCharacter) return;

  const list = document.getElementById('chat-history-list');
  const sessions = chatStore.getSessions(appState.currentCharacter.id);
  const currentId = appState.currentChat?.id;

  list.innerHTML = sessions.map(session => {
    // Get first user message as title, or use date
    const firstUserMsg = session.messages.find(m => m.role === 'user');
    const title = firstUserMsg
      ? firstUserMsg.content.substring(0, 40) + (firstUserMsg.content.length > 40 ? '...' : '')
      : 'New Chat';
    const isActive = session.id === currentId;

    return `
      <div class="chat-history-item ${isActive ? 'active' : ''}" data-chat-id="${session.id}">
        <div class="chat-history-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="chat-history-item-info">
          <div class="chat-history-item-title">${escapeHtml(title)}</div>
          <div class="chat-history-item-date">${formatTime(session.updated_at)}</div>
        </div>
        <button class="chat-history-item-delete" data-delete-chat="${session.id}" title="Delete chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `;
  }).join('');

  // Click handlers
  list.querySelectorAll('.chat-history-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.chat-history-item-delete')) return;
      const chatId = item.dataset.chatId;
      const session = sessions.find(s => s.id === chatId);
      if (session) loadChat(session);
      updateChatHistory();
    });
  });

  list.querySelectorAll('[data-delete-chat]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const chatId = btn.dataset.deleteChat;
      const confirmed = await showConfirm('Delete Chat', 'Are you sure you want to delete this chat history?');
      if (confirmed) {
        await chatStore.deleteSession(appState.currentCharacter.id, chatId);
        updateChatHistory();
        if (appState.currentChat?.id === chatId) {
          clearMessages();
          messagesContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <h2>Start a new chat</h2>
            <p>Click the + button to begin a new conversation.</p>
          </div>
        `;
          appState.currentChat = null;
        }
      }
    });
  });
}

// ─── Continuation Options ───────────────────────────────────────────

async function generateContinuationOptions(character, session, msgElement) {
  try {
    const messages = buildApiMessages(character, session);
    if (messages.length === 0) return;

    const settings = settingsStore.get();
    const suggestionsLang = settings.suggestions_language || 'Russian';

    // Add a system instruction to generate options
    messages.push({
      role: 'system',
      content: `Based on the conversation so far, generate exactly 3 logical and engaging continuation options for the user to reply with.
Return ONLY a valid JSON array of objects with 'label' (short summary, max 4 words) and 'message' (the actual full message to send).

CRITICAL INSTRUCTIONS:
1. The 'label' field must be in ${suggestionsLang}.
2. The 'message' field must be in English.

Example:
[
  { "label": "Спросить про меч", "message": "Where did you find that glowing sword?" },
  { "label": "Убежать", "message": "I don't trust you, I'm leaving!" },
  { "label": "Предложить помощь", "message": "How can I assist you with your quest?" }
]
Do not include any Markdown formatting like \`\`\`json or any other text. Return strictly the raw JSON array.`
    });

    const response = await api.chatCompletion(messages, { max_tokens: 300, temperature: 0.7 });

    // Strip thinking blocks just in case
    const cleanResponse = response.replace(/(?:<\|?think\|?>|<reasoning>)([\s\S]*?)(?:<\|?\/think\|?>|<\/reasoning>)/g, '');

    const jsonMatch = cleanResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const options = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(options) || options.length === 0) return;

    // Save options to store using captured session
    chatStore.updateLastAssistantOptions(options, session);
    chatStore.saveSession(session);

    // Only render if the element is still in the DOM and belongs to this character
    if (msgElement.isConnected && appState.currentCharacter?.id === character.id) {
      renderContinuationOptions(msgElement, options, character, session);
    }
  } catch (err) {
    console.warn('Failed to generate continuation options:', err);
  }
}

function renderContinuationOptions(msgElement, options, character, session) {
  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'continuation-options';

  options.slice(0, 3).forEach((opt, index) => {
    if (!opt.label || !opt.message) return;
    const btn = document.createElement('button');
    btn.className = 'continuation-option-btn';
    btn.textContent = opt.label;
    btn.style.animationDelay = `${index * 0.15}s`;

    btn.addEventListener('click', () => {
      // Remove options when one is clicked
      optionsContainer.remove();

      // Update store using captured session
      const msgId = msgElement.dataset.messageId;
      if (session) {
        const msg = session.messages.find(m => m.id === msgId);
        if (msg) {
          delete msg.options;
          chatStore.saveSession(session);
        }
      }

      // Send the message (this will naturally use appState but we ensure input is set)
      messageInput.value = opt.message;
      sendMessage();
    });

    optionsContainer.appendChild(btn);
  });

  if (optionsContainer.children.length > 0) {
    msgElement.querySelector('.message-body').appendChild(optionsContainer);
    scrollToBottom();
  }
}
