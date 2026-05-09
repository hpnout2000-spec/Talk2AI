/* ════════════════════════════════════════════════════════════════════
   Chat Component — Main chat interface
   ════════════════════════════════════════════════════════════════════ */

import { showToast, checkConnection, showConfirm, showPrompt, openWindow, closeWindow } from '../main.js';
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
import { perf } from '../utils/perf.js';

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

    // Abort pending suggestions generation if any
    if (appState.suggestionsAbortController) {
      appState.suggestionsAbortController.abort();
      appState.suggestionsAbortController = null;
    }

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

  // Chat History Toggle
  const btnToggleHistory = document.getElementById('btn-toggle-history');
  const historyList = document.getElementById('chat-history-list');
  const historyChevron = document.getElementById('history-chevron');

  if (btnToggleHistory && historyChevron) {
    btnToggleHistory.addEventListener('click', () => {
      const section = btnToggleHistory.closest('.sidebar-section');
      if (section) {
        section.classList.toggle('collapsed');
        const isCollapsed = section.classList.contains('collapsed');
        historyChevron.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
      }
    });
  }

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

  setupAiCommentsSidebar();
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

    <div class="indicator-management-section">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <h4 style="margin: 0;">Mood Indicators</h4>
        ${(() => {
      if (appState.currentChat && !appState.currentChat.indicators) {
        appState.currentChat.indicators = { enabled: false, list: [] };
      }
      return '';
    })()}
        <label class="toggle-switch small">
          <input type="checkbox" id="toggle-indicators" ${appState.currentChat?.indicators?.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="indicator-preset-list">
        ${settings.indicator_presets.map(p => `
          <div class="indicator-preset-item" data-preset-id="${p.id}">
            <span class="indicator-preset-name">${p.name}</span>
          </div>
        `).join('')}
        ${settings.custom_indicator_presets.map((p, idx) => `
          <div class="indicator-preset-item" data-custom-idx="${idx}">
            <span class="indicator-preset-name">${p.name}</span>
            <button class="btn-delete-preset" style="background:none; border:none; color:var(--text-tertiary); padding:4px; cursor:pointer;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px; height:12px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        `).join('')}
      </div>

      <button id="btn-add-indicator" class="btn-add-indicator-preset">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px; height:14px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Add Custom Indicators</span>
      </button>
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

  // Handlers for length
  inputSettingsPopover.querySelectorAll('.length-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const newLength = btn.dataset.length;
      settingsStore.save({ ...settingsStore.get(), response_length: newLength });
      renderInputSettings();
    });
  });

  // Handlers for depth
  const slider = inputSettingsPopover.querySelector('#input-depth-slider');
  slider.addEventListener('input', () => {
    const newDepth = parseInt(slider.value);
    settingsStore.save({ ...settingsStore.get(), description_depth: newDepth });
  });

  // Toggle indicators
  const toggleIndicators = inputSettingsPopover.querySelector('#toggle-indicators');
  toggleIndicators?.addEventListener('change', () => {
    if (!appState.currentChat) return;
    if (!appState.currentChat.indicators) {
      appState.currentChat.indicators = { enabled: false, list: [] };
    }
    appState.currentChat.indicators.enabled = toggleIndicators.checked;
    chatStore.saveCurrentSession();
    renderIndicators();
  });

  // Preset selection
  inputSettingsPopover.querySelectorAll('.indicator-preset-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-preset')) {
        const idx = item.dataset.customIdx;
        const currentSettings = settingsStore.get();
        currentSettings.custom_indicator_presets.splice(idx, 1);
        settingsStore.save(currentSettings);
        renderInputSettings();
        return;
      }

      if (!appState.currentChat) return;
      const presetId = item.dataset.presetId;
      const customIdx = item.dataset.customIdx;

      let indicatorsList = [];
      if (presetId) {
        const preset = settings.indicator_presets.find(p => p.id === presetId);
        indicatorsList = preset.indicators.map(name => ({ name, value: 50 }));
      } else if (customIdx !== undefined) {
        const preset = settings.custom_indicator_presets[customIdx];
        indicatorsList = preset.indicators.map(name => ({ name, value: 50 }));
      }

      appState.currentChat.indicators = {
        enabled: true,
        list: indicatorsList
      };
      chatStore.saveCurrentSession();
      renderIndicators();
      renderInputSettings(); // refresh to show toggle as checked
    });
  });

  // Add custom indicators
  const btnAdd = inputSettingsPopover.querySelector('#btn-add-indicator');
  btnAdd?.addEventListener('click', async () => {
    const names = await showPrompt('Add Indicators', 'Enter indicator names separated by commas (e.g. Trust, Fear, Anger)');
    if (names) {
      const list = names.split(',').map(s => s.trim()).filter(s => s !== '');
      if (list.length > 0) {
        const presetName = await showPrompt('Save Preset', 'Enter a name for this preset', 'My Preset');
        if (presetName) {
          const currentSettings = settingsStore.get();
          currentSettings.custom_indicator_presets.push({
            name: presetName,
            indicators: list
          });
          settingsStore.save(currentSettings);
          renderInputSettings();
        }
      }
    }
  });

  const btnAdv = inputSettingsPopover.querySelector('#btn-open-advanced');
  btnAdv?.addEventListener('click', () => {
    inputSettingsPopover.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('open-advanced-settings'));
  });
}

export function renderIndicators() {
  const container = document.getElementById('chat-indicators');
  if (!container) return;

  const session = appState.currentChat;
  if (!session || !session.indicators?.enabled || !session.indicators.list?.length) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = session.indicators.list.map(ind => `
    <div class="indicator-item" title="${escapeHtml(ind.name)}: ${ind.value}%">
      <div class="indicator-label">
        <span>${escapeHtml(ind.name)}</span>
        <span class="indicator-value">${ind.value}%</span>
      </div>
      <div class="indicator-bar-container">
        <div class="indicator-bar-fill" style="width: ${ind.value}%"></div>
      </div>
    </div>
  `).join('');
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
    renderIndicators();
  }

  // Show first message if character has one
  if (char.first_message) {
    const settings = settingsStore.get();
    const userName = settings.user_name || 'User';
    let content = char.first_message.replace(/\{\{user\}\}/gi, userName);
    content = content.replace(/\{\{char\}\}/gi, char.name);

    const msg = chatStore.addMessage('assistant', content, null, session);
    characterStore.updateLastChat(char.id);
    window.dispatchEvent(new CustomEvent('character-list-updated'));
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

  const settings = settingsStore.get();
  const toggleBtn = document.getElementById('btn-toggle-ai-comments-sidebar');
  if (toggleBtn) {
    if (settings.ai_comments_history_enabled) {
      toggleBtn.classList.remove('hidden');
    } else {
      toggleBtn.classList.add('hidden');
    }
  }

  renderAiCommentsHistory();
  renderIndicators();
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
  renderIndicators();
  window.dispatchEvent(new CustomEvent('character-selected', { detail: { id: charId } }));
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

  if (appState.isGenerating) return;

  // Abort pending suggestions generation if any
  if (appState.suggestionsAbortController) {
    appState.suggestionsAbortController.abort();
    appState.suggestionsAbortController = null;
  }

  const settings = settingsStore.get();
  const character = appState.currentCharacter;
  if (!character) {
    showToast('Select a character first', 'error');
    return;
  }

  let session = appState.currentChat;

  if (!content) {
    // If input is empty, check if we should regenerate (last message is user)
    if (session && session.messages.length > 0) {
      const lastMsg = session.messages[session.messages.length - 1];
      if (lastMsg.role === 'user') {
        triggerAssistantGeneration();
        return;
      }
    }
    return;
  }

  if (!session) {
    startNewChat(character);
    session = appState.currentChat;
  }

  // Add user message
  const userMsg = chatStore.addMessage('user', content, null, session);
  characterStore.updateLastChat(character.id);
  window.dispatchEvent(new CustomEvent('character-list-updated'));
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
            html = injectCursor(html);
          }

          const temp = document.createElement('div');
          temp.className = contentEl.className;
          temp.innerHTML = html;

          perf.start('morphdom-patch');
          morphdom(contentEl, temp, {
            childrenOnly: true,
            getNodeKey: (node) => node.dataset?.wordIndex || node.id || node.className
          });
          perf.end('morphdom-patch');
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

        perf.start('morphdom-final-patch');
        morphdom(contentEl, tempFinal, {
          childrenOnly: true,
          getNodeKey: (node) => node.dataset?.wordIndex || node.id || node.className
        });
        perf.end('morphdom-final-patch');

        let originalContent = parsed.content;
        // No more applyIndicatorUpdates here, it's now a separate call

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
          // 1. Update indicators (separate call)
          await triggerIndicatorUpdate(character, session, content, originalContent);

          // 2. Extract memory
          await extractAndShowMemory(character, session, content, originalContent, msgElement);

          // 3. Generate suggestions
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

  // Inject mood indicators if enabled
  if (session.indicators?.enabled && session.indicators.list?.length > 0) {
    const statusStr = session.indicators.list.map(ind => `${ind.name}: ${ind.value}%`).join('\n');
    messages.push({
      role: 'system',
      content: `[CURRENT MOOD STATUS]\n${statusStr}`
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              <text x="12" y="15" font-family="sans-serif" font-size="10" font-weight="bold" text-anchor="middle" stroke="none" fill="currentColor">あ</text>
            </svg>
          </button>
          <button class="btn-copy" title="Copy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button class="btn-ai-comment" title="AI Comment">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
              <path d="M12 7l1.5 3 3.5.5-2.5 2.5.5 3.5-3-1.5-3 1.5.5-3.5-2.5-2.5 3.5-.5z"/>
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

    // Abort suggestions generation if any
    if (appState.suggestionsAbortController) {
      appState.suggestionsAbortController.abort();
      appState.suggestionsAbortController = null;
    }

    // Clear visible suggestions if they were for this message or because list changed
    const options = messagesContainer.querySelectorAll('.continuation-options');
    options.forEach(opt => opt.remove());
  });

  // Edit button
  el.querySelector('.btn-edit-msg')?.addEventListener('click', () => {
    enterEditMode(msg, el);
  });

  // AI Comment button
  el.querySelector('.btn-ai-comment')?.addEventListener('click', () => {
    requestAiComment(msg, character || appState.currentCharacter);
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

  // Abort pending suggestions generation if any
  if (appState.suggestionsAbortController) {
    appState.suggestionsAbortController.abort();
    appState.suggestionsAbortController = null;
  }

  const character = appState.currentCharacter;
  const session = appState.currentChat;
  const settings = settingsStore.get();

  // Start generation
  appState.isGenerating = true;
  appState.abortController = new AbortController();

  // Update last chat timestamp
  characterStore.updateLastChat(character.id);
  window.dispatchEvent(new CustomEvent('character-list-updated'));

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

        let originalContent = parsed.content;

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
          const lastUserMsg = session.messages.slice().reverse().find(m => m.role === 'user');
          if (lastUserMsg) {
            // 1. Update indicators
            await triggerIndicatorUpdate(character, session, lastUserMsg.content, originalContent);

            // 2. Extract memory
            await extractAndShowMemory(character, session, lastUserMsg.content, originalContent, msgElement);
          }
          // 3. Generate suggestions
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

  perf.start('updateChatHistory');
  const list = document.getElementById('chat-history-list');
  const sessions = chatStore.getSessions(appState.currentCharacter.id);
  const currentId = appState.currentChat?.id;

  const html = sessions.map(session => {
    const firstUserMsg = session.messages.find(m => m.role === 'user');
    const title = firstUserMsg
      ? firstUserMsg.content.substring(0, 40) + (firstUserMsg.content.length > 40 ? '...' : '')
      : 'New Chat';
    const isActive = session.id === currentId;

    return `
      <div class="chat-history-item ${isActive ? 'active' : ''}" data-chat-id="${session.id}" id="chat-history-item-${session.id}">
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

  const temp = document.createElement('div');
  temp.id = list.id;
  temp.innerHTML = html;

  perf.start('morphdom-history');
  morphdom(list, temp, {
    childrenOnly: true,
    getNodeKey: (node) => node.id || node.dataset?.chatId
  });
  perf.end('morphdom-history');

  // Event delegation initialized once
  if (!list._listenersAttached) {
    list._listenersAttached = true;
    list.addEventListener('click', async (e) => {
      const deleteBtn = e.target.closest('[data-delete-chat]');
      if (deleteBtn) {
        e.stopPropagation();
        const chatId = deleteBtn.dataset.deleteChat;
        const confirmed = await showConfirm('Delete Chat', 'Are you sure you want to delete this chat history?');
        if (confirmed) {
          await chatStore.deleteSession(appState.currentCharacter.id, chatId);
          updateChatHistory();
          if (appState.currentChat?.id === chatId) {
            clearMessages();
            const container = document.getElementById('chat-messages');
            container.innerHTML = `
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
        return;
      }

      const item = e.target.closest('.chat-history-item');
      if (item) {
        const chatId = item.dataset.chatId;
        const currentSessions = chatStore.getSessions(appState.currentCharacter.id);
        const session = currentSessions.find(s => s.id === chatId);
        if (session) {
          loadChat(session);
          updateChatHistory();
        }
      }
    });
  }

  perf.end('updateChatHistory');
}

// ─── Continuation Options ───────────────────────────────────────────

async function generateContinuationOptions(character, session, msgElement) {
  try {
    const messages = buildApiMessages(character, session);
    if (messages.length === 0) return;

    const settings = settingsStore.get();
    if (!settings.suggestions_enabled) return;

    const suggestionsLang = settings.suggestions_language || 'Russian';

    // Abort previous suggestions generation if any
    if (appState.suggestionsAbortController) {
      appState.suggestionsAbortController.abort();
    }
    const controller = new AbortController();
    appState.suggestionsAbortController = controller;
    const signal = controller.signal;

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

    const response = await api.chatCompletion(messages, {
      max_tokens: 300,
      temperature: 0.7,
      signal: signal
    });

    // CRITICAL: Check if we were aborted while waiting for the network
    if (signal.aborted || !msgElement.isConnected) return;

    // Check if user started typing in the meantime
    if (messageInput.value.trim().length > 0) return;

    // Strip thinking blocks just in case
    const cleanResponse = response.replace(/(?:<\|?think\|?>|<reasoning>)([\s\S]*?)(?:<\|?\/think\|?>|<\/reasoning>)/g, '');

    const jsonMatch = cleanResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const options = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(options) || options.length === 0) return;

    // Check if the message still exists in the session before saving
    const msgId = msgElement.dataset.messageId;
    if (session && !session.messages.some(m => m.id === msgId)) {
      return;
    }

    // Save options to store using captured session
    chatStore.updateLastAssistantOptions(options, session);
    chatStore.saveSession(session);

    // Only render if the element is still in the DOM and belongs to this character
    if (msgElement.isConnected && appState.currentCharacter?.id === character.id) {
      renderContinuationOptions(msgElement, options, character, session);
    }

    appState.suggestionsAbortController = null;
  } catch (err) {
    if (err.name === 'AbortError' || (err.message && err.message.includes('abort'))) return;
    console.warn('Failed to generate continuation options:', err);
    appState.suggestionsAbortController = null;
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

// ─── AI Comment Feature ─────────────────────────────────────────────

async function requestAiComment(msg, character) {
  const settings = settingsStore.get();
  const session = chatStore.getCurrentSession();
  if (!session || !character || !settings.ai_comments_enabled) return;

  const modal = document.getElementById('ai-comment-modal');
  const contentEl = document.getElementById('ai-comment-content');
  const btnOk = document.getElementById('btn-ok-ai-comment');
  const btnCopy = document.getElementById('btn-copy-ai-comment');
  const btnClose = document.getElementById('btn-close-ai-comment');
  const btnAdvice = document.getElementById('btn-advice-ai-comment');

  btnAdvice.classList.add('hidden');
  btnOk.disabled = false; // Always enabled as "Hide"

  openWindow(modal);
  contentEl.innerHTML = injectCursor('');
  btnCopy.classList.add('hidden');

  // Build API messages up to this point
  const msgIndex = session.messages.findIndex(m => m.id === msg.id);
  let contextMessages = [];
  if (msgIndex !== -1) {
    const relevantMsgs = session.messages.slice(0, msgIndex + 1);
    const tempSession = { ...session, messages: relevantMsgs };
    contextMessages = buildApiMessages(character, tempSession);
  } else {
    contextMessages = buildApiMessages(character, session);
  }

  // Append the comment prompt
  let commentPrompt = settings.ai_comments_prompt || 'Comment on the last action.';

  const commentLang = settings.ai_comments_language || 'Auto';
  if (commentLang === 'Auto') {
    commentPrompt += ` Respond in the current conversation language (${settings.target_language || 'Russian'}).`;
  } else {
    commentPrompt += ` Respond strictly in ${commentLang}.`;
  }

  contextMessages.push({
    role: 'user',
    content: `[SYSTEM COMMAND] ${commentPrompt}`
  });

  const abortController = new AbortController();

  const cleanup = () => {
    abortController.abort();
    closeWindow(modal);
    btnOk.onclick = null;
    btnClose.onclick = null;
    btnCopy.onclick = null;
    btnAdvice.onclick = null;
  };

  btnOk.onclick = cleanup;
  btnClose.onclick = cleanup;

  let fullComment = '';

  try {
    await api.streamChat(
      contextMessages,
      abortController.signal,
      (chunk) => {
        fullComment += chunk;
        contentEl.innerHTML = injectCursor(renderMarkdown(fullComment));
      },
      async () => {
        contentEl.innerHTML = renderMarkdown(fullComment);
        btnCopy.classList.remove('hidden');
        btnAdvice.classList.remove('hidden');

        if (settings.ai_comments_history_enabled) {
          const snippet = msg.content ? msg.content.substring(0, 60).replace(/\n/g, ' ') + (msg.content.length > 60 ? '...' : '') : '...';
          chatStore.addAiComment(msg.id, snippet, fullComment, session);
          chatStore.saveSession(session);
          renderAiCommentsHistory();
        }

        btnCopy.onclick = () => {
          navigator.clipboard.writeText(fullComment);
          btnCopy.textContent = 'Copied!';
          setTimeout(() => btnCopy.textContent = 'Copy', 2000);
        };

        btnAdvice.onclick = async () => {
          btnAdvice.classList.add('hidden');

          let adviceTextPrefix = "посоветуй, что мне стоит делать дальше?"; // Default
          let adviceInstruction = "";

          const commentLang = settings.ai_comments_language || 'Auto';
          if (commentLang === 'Auto') {
            adviceTextPrefix = "What should I do next?";
            adviceInstruction = ` Respond in the current conversation language (${settings.target_language || 'Russian'}).`;
          } else if (commentLang === 'English') {
            adviceTextPrefix = "What should I do next?";
            adviceInstruction = " Respond in English.";
          } else if (commentLang === 'Russian') {
            adviceTextPrefix = "посоветуй, что мне стоит делать дальше?";
            adviceInstruction = " Respond in Russian.";
          } else if (commentLang === 'Spanish') {
            adviceTextPrefix = "¿Qué debo hacer a continuación?";
            adviceInstruction = " Respond in Spanish.";
          }

          contextMessages.push({ role: 'assistant', content: fullComment });
          contextMessages.push({ role: 'user', content: `[SYSTEM COMMAND] ${adviceTextPrefix}${adviceInstruction}` });

          const separator = '<hr style="margin: 1.5rem 0; border: none; border-top: 1px solid var(--border-subtle); opacity: 0.5;">';
          let adviceText = '';

          try {
            await api.streamChat(
              contextMessages,
              abortController.signal,
              (chunk) => {
                adviceText += chunk;
                contentEl.innerHTML = renderMarkdown(fullComment) + separator + injectCursor(renderMarkdown(adviceText));
              },
              () => {
                contentEl.innerHTML = renderMarkdown(fullComment) + separator + renderMarkdown(adviceText);
                const combinedText = fullComment + "\n\n---\n\n" + adviceText;
                btnCopy.onclick = () => {
                  navigator.clipboard.writeText(combinedText);
                  btnCopy.textContent = 'Copied!';
                  setTimeout(() => btnCopy.textContent = 'Copy', 2000);
                };
              }
            );
          } catch (err) {
            if (err.name !== 'AbortError') {
              contentEl.innerHTML += `<p style="color: var(--error)">Error: ${escapeHtml(err.message)}</p>`;
            }
            btnOk.disabled = false;
          }
        };
      },
      (err) => {
        if (err.name !== 'AbortError') {
          contentEl.innerHTML = `<p style="color: var(--error)">Error: ${escapeHtml(err.message)}</p>`;
        }
      }
    );
  } catch (err) {
    if (err.name !== 'AbortError') {
      contentEl.innerHTML = `<p style="color: var(--error)">Error: ${escapeHtml(err.message)}</p>`;
    }
  }
}

function injectCursor(html) {
  const cursorHtml = '<span class="streaming-cursor"></span>';
  if (html.includes('</')) {
    // Inject before the last closing tag
    return html.replace(/(<\/([a-z0-9]+)>)$/i, cursorHtml + '$1');
  }
  return html + cursorHtml;
}

export function renderAiCommentsHistory() {
  const listEl = document.getElementById('ai-comments-list');
  if (!listEl) return;

  const session = chatStore.getCurrentSession();
  listEl.innerHTML = '';

  if (!session || !session.ai_comments || session.ai_comments.length === 0) {
    listEl.innerHTML = '<div style="text-align: center; color: var(--text-tertiary); padding: 20px; font-size: var(--text-sm);">No comments yet.</div>';
    return;
  }

  const comments = [...session.ai_comments].reverse();

  comments.forEach(comment => {
    const item = document.createElement('div');
    item.className = 'ai-comment-history-item';

    // Format timestamp
    const date = new Date(comment.timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    item.innerHTML = `
      <div class="ai-comment-history-target">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
        </svg>
        <span>${escapeHtml(comment.target_content_snippet || '...')}</span>
      </div>
      <div class="ai-comment-history-content">
        ${renderMarkdown(comment.content)}
      </div>
      <div class="ai-comment-history-meta">${timeStr}</div>
    `;
    listEl.appendChild(item);
  });
}

function setupAiCommentsSidebar() {
  const toggleBtn = document.getElementById('btn-toggle-ai-comments-sidebar');
  const sidebar = document.getElementById('ai-comments-sidebar');
  const closeBtn = document.getElementById('btn-close-ai-comments-sidebar');
  const mainContent = document.getElementById('main-content');
  
  if (!toggleBtn || !sidebar || !closeBtn || !mainContent) return;
  
  // Принудительно очищаем старый класс при запуске
  sidebar.classList.remove('hidden');
  toggleBtn.classList.remove('hidden');
  const setSidebarState = (open) => {
    mainContent.classList.add('is-animating');
    
    if (open) {
      document.body.classList.add('ai-sidebar-open');
      
      setTimeout(() => {
        renderAiCommentsHistory();
      }, 300);
    } else {
      document.body.classList.remove('ai-sidebar-open');
    }
    
    setTimeout(() => {
      mainContent.classList.remove('is-animating');
    }, 600);
  };
  
  toggleBtn.addEventListener('click', () => {
    // Теперь проверяем наличие глобального класса
    const isCurrentlyOpen = document.body.classList.contains('ai-sidebar-open');
    setSidebarState(!isCurrentlyOpen);
  });
  
  closeBtn.addEventListener('click', () => {
    setSidebarState(false);
  });
}

async function triggerIndicatorUpdate(character, session, lastUserMsg, lastAssistantMsg) {
  if (!session?.indicators?.enabled || !session.indicators.list?.length) return;

  // Build a focused context for the update call
  // We use the character's core info but minimal history to keep it fast and focused
  const settings = settingsStore.get();
  const userName = settings.user_name || 'User';

  const context = [
    {
      role: 'system',
      content: `You are a character state analyzer. Your task is to update mood indicators based on the last interaction.\nCharacter: ${character.name}\nUser: ${userName}`
    }
  ];

  // Add last few messages for context
  const recentMsgs = session.messages.slice(-4);
  for (const m of recentMsgs) {
    context.push({ role: m.role, content: m.translated_content || m.content });
  }

  // Add the special command
  const statusStr = session.indicators.list.map(ind => `${ind.name}: ${ind.value}%`).join('\n');
  context.push({
    role: 'user',
    content: `[SYSTEM COMMAND] Analyze the character's response and update the indicators.
Current status:
${statusStr}

Instructions:
1. Return ONLY a JSON block.
2. Use relative changes (e.g. +10, -5, 0).
3. Be realistic based on the character's personality and the conversation.

Example: {"indicators": {"Trust": +5, "Fear": -10}}`
  });

  try {
    const response = await api.chatCompletion(context, { max_tokens: 150, temperature: 0.1 });
    // More flexible JSON extraction (greedy to capture nested braces)
    const jsonMatch = response.match(/\{[\s\S]*"indicators"[\s\S]*\}/);
    if (jsonMatch) {
      const cleanedJson = jsonMatch[0].replace(/:\s*\+([0-9]+)/g, ': $1'); // Remove '+' signs before parsing
      try {
        const data = JSON.parse(cleanedJson);
        if (data.indicators) {
          let changed = false;
          for (const [name, change] of Object.entries(data.indicators)) {
            const ind = session.indicators.list.find(i => i.name.toLowerCase() === name.toLowerCase());
            if (ind) {
              const numericChange = parseInt(change);
              if (!isNaN(numericChange)) {
                ind.value = Math.max(0, Math.min(100, ind.value + numericChange));
                changed = true;
              }
            }
          }
          if (changed) {
            renderIndicators();
            chatStore.saveCurrentSession();
          }
        }
      } catch (parseErr) {
        console.warn('JSON parse error in indicators:', parseErr, cleanedJson);
      }
    }
  } catch (e) {
    console.warn('Indicator update failed:', e);
  }
}

function applyIndicatorUpdates(text, session) {
  // This is now redundant but keeping for backward compatibility if needed, 
  // though we'll remove calls to it.
  return text;
}
