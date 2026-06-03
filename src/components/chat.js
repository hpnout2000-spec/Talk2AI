/* ════════════════════════════════════════════════════════════════════
   Chat Component — Main chat interface
   ════════════════════════════════════════════════════════════════════ */

import { showToast, checkConnection, showConfirm, showPrompt, openWindow, closeWindow } from '../main.js';
import { appState } from '../state.js';
import { chatStore } from '../services/chat-store.js';
import { characterStore } from '../services/character-store.js';
import { gameStore } from '../services/game-store.js';
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
import { groupChatStore } from '../services/group-chat-store.js';
import { buildGroupApiMessages } from './group-chat-view.js';
import { generateImageComfyUI } from '../services/comfyui-service.js';

// Lazy notify GenAI panel when a response arrives (avoids circular import)
function notifyGenAI(response, characterName) {
  import('../components/genai-panel.js').then(m => m.notifyGenAIResponse(response, characterName)).catch(() => { });
}

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

// ─── Suggestions Explorer State ──────────────────────────────────────
let moreSuggestionsAbortController = null;
let moreSuggestionsContext = { character: null, session: null, msgElement: null };
let generatedSuggestionsHistory = [];

// ─── Floating Streaming Cursor ───────────────────────────────────────
// A single absolutely-positioned cursor element that glides smoothly
// to the end of the last rendered word using CSS transition.

let _chatCursor = null;
let _chatCursorRafId = null;

function getOrCreateChatCursor() {
  if (!_chatCursor || !_chatCursor.isConnected) {
    _chatCursor = document.createElement('span');
    _chatCursor.className = 'streaming-cursor streaming-cursor--float';
    document.body.appendChild(_chatCursor);
  }
  return _chatCursor;
}

function repositionChatCursor(contentEl) {
  if (_chatCursorRafId) cancelAnimationFrame(_chatCursorRafId);
  _chatCursorRafId = requestAnimationFrame(() => {
    const cursor = _chatCursor;
    if (!cursor || !cursor.isConnected) return;

    // Walk the contentEl to find the last visible text node
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    });
    let lastTextNode = null;
    while (walker.nextNode()) lastTextNode = walker.currentNode;

    if (lastTextNode) {
      const range = document.createRange();
      range.setStart(lastTextNode, lastTextNode.length);
      range.setEnd(lastTextNode, lastTextNode.length);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return; // not in viewport yet
      const cursorH = cursor.offsetHeight || 16;
      // position:fixed uses viewport coordinates — no scroll offset needed
      cursor.style.transform = `translate(${rect.right}px, ${rect.top + (rect.height - cursorH) / 2}px)`;
    }
  });
}

function removeChatCursor() {
  if (_chatCursorRafId) { cancelAnimationFrame(_chatCursorRafId); _chatCursorRafId = null; }
  if (_chatCursor && _chatCursor.isConnected) _chatCursor.remove();
  _chatCursor = null;
}

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

  // Global click delegation for character mentions in chat
  messagesContainer.addEventListener('click', (e) => {
    const mention = e.target.closest('.char-mention');
    if (mention) {
      const charName = mention.getAttribute('data-char-name');
      const cleanedName = cleanCharacterName(charName);
      
      // 1. Look up in active game characters
      const game = gameStore.get();
      if (game && game.characters) {
        const char = game.characters.find(c => cleanCharacterName(c.name).toLowerCase() === cleanedName.toLowerCase());
        if (char) {
          showCharacterTooltip(mention, char);
          return;
        }
      }
      
      // 2. Fallback to global chatbot directory
      const globalChars = characterStore.getAll();
      const globalChar = globalChars.find(c => cleanCharacterName(c.name).toLowerCase() === cleanedName.toLowerCase());
      if (globalChar) {
        showCharacterTooltip(mention, globalChar);
      }
    }
  });

  // Thinking toggle (element may not exist if removed from header)
  if (thinkingToggle) {
    thinkingToggle.addEventListener('change', () => {
      const settings = settingsStore.get();
      settingsStore.save({ ...settings, thinking_enabled: thinkingToggle.checked });

      // Sync settings panel toggle
      const settingsThinking = document.getElementById('setting-thinking');
      if (settingsThinking) settingsThinking.checked = thinkingToggle.checked;
    });
  }

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
      // Hide other popover
      const chatPlusPopover = document.getElementById('chat-plus-popover');
      if (chatPlusPopover) chatPlusPopover.classList.add('hidden');
    });
  }

  // Chat Plus Popover
  const btnChatPlus = document.getElementById('btn-chat-plus');
  const chatPlusPopover = document.getElementById('chat-plus-popover');
  const btnChatToggleImagegen = document.getElementById('btn-chat-toggle-imagegen');
  const chatImagegenToggleCheck = document.getElementById('chat-imagegen-toggle-check');

  if (btnChatPlus && chatPlusPopover) {
    btnChatPlus.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = chatPlusPopover.classList.contains('hidden');
      if (isHidden) {
        const enabled = settingsStore.get().comfyui_enabled;
        if (chatImagegenToggleCheck) chatImagegenToggleCheck.checked = !!enabled;
        chatPlusPopover.classList.remove('hidden');
        if (inputSettingsPopover) inputSettingsPopover.classList.add('hidden');
      } else {
        chatPlusPopover.classList.add('hidden');
      }
    });

    document.addEventListener('click', (e) => {
      if (chatPlusPopover && !chatPlusPopover.contains(e.target) && (!btnChatPlus || !btnChatPlus.contains(e.target))) {
        chatPlusPopover.classList.add('hidden');
      }
    });
  }

    btnChatToggleImagegen.addEventListener('click', (e) => {
      e.stopPropagation();
      const current = settingsStore.get();
      const newVal = !current.comfyui_enabled;
      settingsStore.save({ ...current, comfyui_enabled: newVal });
      if (window.syncImageGenIndicators) {
        window.syncImageGenIndicators();
      } else {
        const chatInd = document.getElementById('chat-imagegen-indicator');
        const chatGear = document.getElementById('btn-imagegen-gear');
        if (chatInd) chatInd.classList.toggle('hidden', !newVal);
        if (chatGear) chatGear.classList.toggle('hidden', !newVal);
        if (chatImagegenToggleCheck) chatImagegenToggleCheck.checked = newVal;
      }
      setTimeout(() => chatPlusPopover.classList.add('hidden'), 350);
    });

  document.addEventListener('click', (e) => {
    if (inputSettingsPopover && !inputSettingsPopover.contains(e.target) && (!btnInputSettings || !btnInputSettings.contains(e.target))) {
      inputSettingsPopover.classList.add('hidden');
    }
  });
  setupRightSidebarToggle();

  // Init Image Gen indicator based on saved settings and add click handler to open settings modal
  const _chatInd = document.getElementById('chat-imagegen-indicator');
  const _chatGear = document.getElementById('btn-imagegen-gear');
  if (_chatInd) {
    const _igEnabled = settingsStore.get().comfyui_enabled;
    _chatInd.classList.toggle('hidden', !_igEnabled);
    if (_chatGear) _chatGear.classList.toggle('hidden', !_igEnabled);
    
    _chatInd.addEventListener('click', (e) => {
      e.stopPropagation();
      openWindow('modal-settings-imagegen');
    });

    if (_chatGear) {
      _chatGear.addEventListener('click', (e) => {
        e.stopPropagation();
        openWindow('modal-settings-imagegen');
      });
    }
  }

  // Listen for GenAI programmatic message sends
  window.addEventListener('genai-send-chat-message', (e) => {
    if (appState.isGenerating) return;
    const { content } = e.detail;
    if (content) {
      messageInput.value = content;
      sendMessage();
    }
  });

  // Listen for GenAI programmatic chat management
  window.addEventListener('genai-create-new-chat', (e) => {
    const { character_id } = e.detail;
    const character = characterStore.getById(character_id);
    if (character) {
      selectCharacter(character, 'NEW');
    }
  });

  window.addEventListener('genai-switch-chat', (e) => {
    const { chat_id, character_id } = e.detail;
    const character = characterStore.getById(character_id);
    if (character) {
      selectCharacter(character, chat_id);
    }
  });

  window.addEventListener('genai-rename-chat', (e) => {
    const { chat_id, character_id, new_title } = e.detail;
    chatStore.renameSession(chat_id, new_title, character_id).then(() => {
      if (appState.currentCharacter?.id === character_id) {
        updateChatHistory();
      }
    });
  });

  // Make AI comment feature global
  window.requestAiComment = requestAiComment;

  // ─── Suggestions Explorer Modal Event Listeners ────────────────────
  const btnCloseMore = document.getElementById('btn-close-more-suggestions');
  if (btnCloseMore) {
    btnCloseMore.addEventListener('click', () => {
      closeWindow('more-suggestions-modal');
      abortMoreSuggestionsGeneration();
    });
  }

  const btnMoreRefresh = document.getElementById('btn-more-suggestions-refresh');
  if (btnMoreRefresh) {
    btnMoreRefresh.addEventListener('click', () => {
      generateMoreSuggestions();
    });
  }

  const btnMoreSendTopic = document.getElementById('btn-more-suggestions-send-topic');
  const inputMoreTopic = document.getElementById('more-suggestions-topic-input');
  if (btnMoreSendTopic && inputMoreTopic) {
    const handleSendTopic = () => {
      const topic = inputMoreTopic.value.trim();
      if (topic) {
        generateMoreSuggestions(topic);
        inputMoreTopic.value = '';
      }
    };
    btnMoreSendTopic.addEventListener('click', handleSendTopic);
    inputMoreTopic.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSendTopic();
      }
    });
  }
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
  const thinkingEnabled = settings.thinking_enabled || false;

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

    <div class="settings-group" style="border-top: 1px solid var(--border-subtle); padding-top: 12px; margin-top: 4px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 15px;">🧠</span>
          <h4 style="margin: 0;">Think Mode</h4>
        </div>
        <label class="toggle-switch small">
          <input type="checkbox" id="input-thinking-toggle" ${thinkingEnabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding-left: 4px;">
        <span style="font-size: var(--text-xs); color: var(--text-tertiary);">&#x21b3; Show snippets</span>
        <label class="toggle-switch small">
          <input type="checkbox" id="input-snippets-toggle" ${settingsStore.get().thinking_snippets ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
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

  // Think Mode toggle handler
  const thinkingToggleEl = inputSettingsPopover.querySelector('#input-thinking-toggle');
  thinkingToggleEl?.addEventListener('change', () => {
    const newVal = thinkingToggleEl.checked;
    settingsStore.save({ ...settingsStore.get(), thinking_enabled: newVal });
    const settingsThinking = document.getElementById('setting-thinking');
    if (settingsThinking) settingsThinking.checked = newVal;
  });

  // Snippets toggle handler
  const snippetsToggleEl = inputSettingsPopover.querySelector('#input-snippets-toggle');
  snippetsToggleEl?.addEventListener('change', () => {
    const newVal = snippetsToggleEl.checked;
    settingsStore.save({ ...settingsStore.get(), thinking_snippets: newVal });
    const settingsSnippets = document.getElementById('setting-thinking-snippets');
    if (settingsSnippets) settingsSnippets.checked = newVal;
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

  const imageGenToggle = inputSettingsPopover.querySelector('#input-imagegen-toggle-check');
  imageGenToggle?.addEventListener('change', () => {
    const newVal = imageGenToggle.checked;
    settingsStore.save({ ...settingsStore.get(), comfyui_enabled: newVal });
    // Sync all indicators + genai popover toggle via global helper
    if (window.syncImageGenIndicators) window.syncImageGenIndicators();
    else {
      const chatInd = document.getElementById('chat-imagegen-indicator');
      const chatGear = document.getElementById('btn-imagegen-gear');
      if (chatInd) chatInd.classList.toggle('hidden', !newVal);
      if (chatGear) chatGear.classList.toggle('hidden', !newVal);
    }
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

    // Support random first message if multiple are available
    let content = char.first_message;
    let greetingIdx = 0;

    // In SillyTavern, users usually want to start with the primary one, 
    // but some apps randomize. We'll start with index 0 (primary).
    session.selected_greeting_index = 0;

    let processedContent = content.replace(/\{\{user\}\}/gi, userName);
    processedContent = processedContent.replace(/\{\{char\}\}/gi, char.name);

    const msg = chatStore.addMessage('assistant', processedContent, null, session);
    characterStore.updateLastChat(char.id);
    window.dispatchEvent(new CustomEvent('character-list-updated'));
    if (appState.currentCharacter?.id === char.id) {
      appendMessage(msg, false, char);
    }
  }

  chatStore.saveSession(session);
  if (appState.currentCharacter?.id === char.id) {
    updateChatHistory();
    if (window.updateUserNameDisplay) {
      window.updateUserNameDisplay();
    }
  }
}

// ─── Load Existing Chat ─────────────────────────────────────────────

export function loadChat(session) {
  if (!session) return;
  if (appState.currentCharacter?.id !== session.character_id) return;
  appState.currentChat = session;
  chatStore.setCurrentSession(session);
  clearMessages();

  if (window.updateUserNameDisplay) {
    window.updateUserNameDisplay();
  }

  for (const msg of session.messages) {
    appendMessage(msg);
  }

  const toggleBtn = document.getElementById('btn-toggle-right-sidebar');
  if (toggleBtn) {
    toggleBtn.classList.remove('hidden');
  }

  const settings = settingsStore.get();
  if (!settings.genai_mode_enabled) {
    renderAiCommentsHistory();
  }
  renderIndicators();
  scrollToBottom();
  updateChatHistory();
}

// ─── Select Character ───────────────────────────────────────────────

export async function selectCharacter(character, sessionId = null) {
  if (!character) {
    appState.currentCharacter = null;
    appState.currentChat = null;
    chatStore.setCurrentSession(null);

    // Update header
    if (headerCharName) headerCharName.textContent = 'Select a character';
    if (headerCharStatus) {
      headerCharStatus.textContent = 'Ready';
      headerCharStatus.classList.remove('generating');
    }
    if (headerAvatar) {
      headerAvatar.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
      </svg>`;
    }

    // Clear messages
    if (messagesContainer) {
      messagesContainer.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>
          </svg>
          <h3>No character selected</h3>
          <p>Select a character from the sidebar or create a new one to start chatting.</p>
        </div>
      `;
    }

    // Clear indicators
    const container = document.getElementById('chat-indicators');
    if (container) {
      container.classList.add('hidden');
    }

    // Clear chat history list
    const historyList = document.getElementById('chat-history-list');
    if (historyList) {
      historyList.innerHTML = '';
    }

    // Update character list active states
    const list = document.getElementById('character-list');
    if (list) {
      const items = list.querySelectorAll('.character-item');
      items.forEach(item => item.classList.remove('active'));
    }

    window.dispatchEvent(new CustomEvent('character-selected', { detail: { id: null } }));
    return;
  }

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

  // 1. Clear history list immediately to provide instant feedback
  const list = document.getElementById('chat-history-list');
  if (list) {
    list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-tertiary); font-size: var(--text-sm);">Loading chats...</div>';
  }

  try {
    // 2. Load chats for this character
    try {
      await chatStore.loadForCharacter(charId);
    } catch (err) {
      console.warn('Failed to load chats:', err);
    }

    // 3. Load memory (don't block UI for this)
    memoryService.loadForCharacter(charId).catch(err => console.warn('Memory load failed:', err));

    // Check if this character is still the active one
    if (appState.currentCharacter?.id !== charId) return;

    const sessions = chatStore.getSessions(charId);
    if (sessionId === 'NEW') {
      startNewChat(character);
    } else if (sessionId) {
      const session = sessions.find(s => s.id === sessionId);
      if (session) {
        loadChat(session);
      } else {
        loadChat(sessions[0] || null);
      }
    } else if (sessions && sessions.length > 0) {
      loadChat(sessions[0]);
    } else {
      startNewChat(character);
    }
  } catch (err) {
    console.error('Critical switch error:', err);
  } finally {
    // 4. ENSURE UI updates even if something failed
    updateChatHistory(charId);
    renderIndicators();
    window.dispatchEvent(new CustomEvent('character-selected', { detail: { id: charId } }));
  }
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
          getNodeKey: (node) => node.dataset?.wordIndex || node.id || null,
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

  // Immediate save to prevent loss if app is closed before AI response
  await chatStore.saveSession(session);

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

          try {
            const parsed = parseStreamThinking(fullResponse);
            thinkingContent = parsed.thinking;
            let displayContent = parsed.content;
            isInThinking = parsed.isInThinking;

            if (!isInThinking && displayContent.startsWith('*') && !displayContent.endsWith('*')) {
              displayContent += '*';
            }

            let html = '';
            // Show thinking block whenever we are inside a think tag (even if content is still empty)
            const showThinkingBlock = isInThinking || (thinkingContent && !displayContent);
            if (showThinkingBlock || thinkingContent) {
              html += createThinkingBlockHTML(thinkingContent, isInThinking);
            }
            const cleaned = stripJsonBlocks(displayContent, true);
            let formatted = renderMarkdown(cleaned);
            formatted = processCharacterMentions(formatted);
            html += wrapWordsInSpans(formatted);

            // No inline cursor injection — we use the floating cursor instead

            const temp = document.createElement('div');
            temp.className = contentEl.className;
            temp.innerHTML = html;

            morphdom(contentEl, temp, {
              childrenOnly: true,
              getNodeKey: (node) => node.dataset?.wordIndex || node.id || null
            });

            // Move the floating cursor to the end of the last rendered word
            if (!isInThinking) {
              getOrCreateChatCursor();
              repositionChatCursor(contentEl);
            }
          } catch (err) {
            console.error("STREAM CHUNK ERROR:", err);
            showToast("Streaming UI error: " + err.message, "error");
          }
        });
      },
      // onDone
      async () => {
        let parsed;
        try {
          parsed = parseThinking(fullResponse);

          // Final render — remove floating cursor first, then do clean render
          removeChatCursor();
          let finalHtml = '';
          if (parsed.thinking) {
            finalHtml += createThinkingBlockHTML(parsed.thinking, false);
          }
          const cleaned = stripJsonBlocks(parsed.content, false);
          let formatted = renderMarkdown(cleaned);
          formatted = processCharacterMentions(formatted);
          finalHtml += wrapWordsInSpans(formatted);

          const tempFinal = document.createElement('div');
          tempFinal.className = contentEl.className;
          tempFinal.innerHTML = finalHtml;

          perf.start('morphdom-final-patch');
          morphdom(contentEl, tempFinal, {
            childrenOnly: true,
            getNodeKey: (node) => node.dataset?.wordIndex || node.id || null
          });
          perf.end('morphdom-final-patch');
        } catch (err) {
          console.error("ON DONE ERROR:", err);
          showToast("Final UI render error: " + err.message, "error");
          parsed = parseThinking(fullResponse);
        }

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
          updateRegenerateVisibility();
          scrollToBottom();
        }

        if (originalContent) {
          // Strict sequential execution IIFE to respect single-concurrency LLM limits
          (async () => {
            try {
              // 1. Generate continuation options replies first (High Priority UI)
              await generateContinuationOptions(character, session, msgElement);
            } catch (e) {
              console.warn('Failed to generate suggestions:', e);
            }

            try {
              // 2. Process Image Gen suggestion popup (High Priority UI)
              const freshSettings = settingsStore.get();
              if (freshSettings.comfyui_enabled && freshSettings.comfyui_auto_chat) {
                await triggerAutomaticImageGeneration(character, session, originalContent);
              } else if (freshSettings.comfyui_enabled && !freshSettings.comfyui_auto_chat) {
                await triggerImageGenerationSuggestion(character, session, originalContent, msgElement);
              }
            } catch (e) {
              console.warn('Failed to handle image generation:', e);
            }

            try {
              // 3. Extract and save memory (Low Priority Background)
              await extractAndShowMemory(character, session, content, originalContent, msgElement);
            } catch (e) {
              console.warn('Failed to extract memory:', e);
            }

            try {
              // 4. Update indicators status (Low Priority Background)
              await triggerIndicatorUpdate(character, session, content, originalContent);
            } catch (e) {
              console.warn('Failed to update indicators:', e);
            }

            // 5. Notify GenAI (for vibe plot mode)
            notifyGenAI(originalContent, character.name);
          })();
        }

        window.dispatchEvent(new CustomEvent('genai-chat-response-finished'));
        checkConnection();
      },
      // onError
      (err) => {
        console.error('Stream error:', err);
        removeChatCursor();
        contentEl.innerHTML = `<p style="color: var(--error)">Error: ${escapeHtml(err.message)}</p>`;

        if (appState.currentCharacter?.id === character.id) {
          appState.isGenerating = false;
          appState.abortController = null;
          btnSend.classList.remove('hidden');
          btnStop.classList.add('hidden');
          headerCharStatus.textContent = 'Error';
          headerCharStatus.classList.remove('generating');
        }
        window.dispatchEvent(new CustomEvent('genai-chat-response-finished', { detail: { error: err.message } }));
      },
      apiOptions
    );
  } catch (err) {
    console.error('Send error:', err);
    showToast('Failed to send message', 'error');
    if (appState.currentCharacter?.id === character.id) {
      appState.isGenerating = false;
    }
    window.dispatchEvent(new CustomEvent('genai-chat-response-finished', { detail: { error: err.message } }));
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
  const userName = session.user_name || settings.user_name || 'User';
  
  const personaId = session.persona_id || settings.active_persona_id || 'default';
  const personas = settings.personas || [];
  const activePersona = personas.find(p => p.id === personaId);
  
  const messages = [];

  // System prompt with character info and memory
  let systemContent = '';

  const charData = {
    description: character.description || '',
    personality: character.personality ? `Personality: ${character.personality}` : '',
    scenario: character.scenario ? `Scenario: ${character.scenario}` : ''
  };

  if (character.system_prompt) {
    systemContent = character.system_prompt;

    // Check if any standard placeholders are used
    const hasPlaceholders = /\{\{description\}\}/gi.test(systemContent) ||
      /\{\{personality\}\}/gi.test(systemContent) ||
      /\{\{scenario\}\}/gi.test(systemContent);

    // Replace placeholders
    systemContent = systemContent.replace(/\{\{description\}\}/gi, charData.description);
    systemContent = systemContent.replace(/\{\{personality\}\}/gi, charData.personality);
    systemContent = systemContent.replace(/\{\{scenario\}\}/gi, charData.scenario);

    // If no placeholders were used, prepend character info automatically to ensure context
    if (!hasPlaceholders) {
      const parts = [charData.description, charData.personality, charData.scenario].filter(Boolean);
      if (parts.length > 0) {
        systemContent = parts.join('\n\n') + '\n\n' + systemContent;
      }
    }
  } else {
    // Use active preset if available, otherwise build from fields
    const activePresetId = settings.active_system_prompt_preset_id;
    const presets = settings.system_prompt_presets || [];
    const activePreset = presets.find(p => p.id === activePresetId);

    if (activePreset) {
      systemContent = activePreset.content;

      // Check if any standard placeholders are used
      const hasPlaceholders = /\{\{description\}\}/gi.test(systemContent) ||
        /\{\{personality\}\}/gi.test(systemContent) ||
        /\{\{scenario\}\}/gi.test(systemContent);

      // Replace placeholders
      systemContent = systemContent.replace(/\{\{description\}\}/gi, charData.description);
      systemContent = systemContent.replace(/\{\{personality\}\}/gi, charData.personality);
      systemContent = systemContent.replace(/\{\{scenario\}\}/gi, charData.scenario);

      // If no placeholders were used, prepend character info automatically to ensure context
      if (!hasPlaceholders) {
        const parts = [charData.description, charData.personality, charData.scenario].filter(Boolean);
        if (parts.length > 0) {
          systemContent = parts.join('\n\n') + '\n\n' + systemContent;
        }
      }
    } else {
      // Fallback to building from fields
      const parts = [charData.description, charData.personality, charData.scenario].filter(Boolean);
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

  // Inject <|think|> token at the very start to activate Thinking Mode
  if (settings.thinking_enabled) {
    systemContent = '<|think|>\n' + systemContent;
  }

  // Inject persona description if active
  if (activePersona && activePersona.description) {
    let personaStr = activePersona.description.replace(/\{\{user\}\}/gi, userName).replace(/\{\{char\}\}/gi, character.name);
    systemContent += `\n\n[USER PERSONA]\nThe user's persona is as follows. Treat the user as this persona:\n${personaStr}`;
  }

  // Add formatting instructions based on settings
  const formattingInstructions = [];

  // Response Length
  if (settings.response_length === 'short') {
    formattingInstructions.push("Write extremely short, brief, and concise responses. Limit yourself to 1-2 sentences maximum. No fluff.");
  } else if (settings.response_length === 'medium') {
    formattingInstructions.push("Write balanced, moderately detailed responses. Strictly limit your response to about 650 characters (letters and spaces) maximum.");
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
    systemContent += `\n\n[MANDATORY FORMATTING RULES]\n${formattingInstructions.join("\n")}`;
  }

  // Inject mood indicators if enabled
  if (session.indicators?.enabled && session.indicators.list?.length > 0) {
    const statusStr = session.indicators.list.map(ind => `${ind.name}: ${ind.value}%`).join('\n');
    systemContent += `\n\n[CURRENT MOOD STATUS]\n${statusStr}`;
  }

  messages.push({ role: 'system', content: systemContent });

  // Chat messages (skip empty assistant messages)
  for (const msg of session.messages) {
    if (msg.role === 'system') continue;
    if (msg.role === 'assistant' && !msg.content) continue;

    // For user messages, use translation (English) if available
    // For assistant messages, we stored original English in content
    let content = msg.role === 'user' ? (msg.translated_content || msg.content) : (msg.original_text || msg.content);
    messages.push({ role: msg.role, content: content });
  }

  return messages;
}

// ─── Parse Streaming Thinking ───────────────────────────────────────

function parseStreamThinking(text) {
  // Try to find the start tag
  const startMatch = text.match(/<\|channel>thought|<\|?think\|?>|<thought>|<reasoning>/);
  if (!startMatch) {
    return { thinking: '', content: text, isInThinking: false };
  }

  const thinkStart = startMatch[0];
  const startIdx = startMatch.index;
  const afterStart = startIdx + thinkStart.length;

  // Try to find the end tag
  const endMatch = text.substring(afterStart).match(/<channel\|>|<\|?\/think\|?>|<\/thought>|<\/reasoning>/);

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
  if (isActive) {
    const s = settingsStore.get();
    let label = 'Thinking...';
    let isSnippet = false;

    if (s.thinking_snippets && thinkingText) {
      const paras = thinkingText.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
      const lastPara = paras[paras.length - 1] || '';
      const firstLine = lastPara.split('\n')[0].trim();
      let snippet = firstLine.replace(/<|>\/?[a-z]*/gi, '').trim();
      if (snippet) {
        if (snippet.length > 80) {
          snippet = snippet.substring(0, 80) + '\u2026';
        }
        label = snippet;
        isSnippet = true;
      }
    }

    const cursor = ' <span class="streaming-cursor"></span>';
    const labelClass = isSnippet ? 'thinking-text-animated thinking-snippet-active' : 'thinking-text-animated';
    return '<div class="thinking-inline thinking-inline-active"><div class="thinking-inline-header"><span class="brain-icon">\u{1F9E0}</span><span class="' + labelClass + '">' + escapeHtml(label) + '</span>' + cursor + '</div></div>';
  }
  return '<div class="thinking-inline"><div class="thinking-inline-header thinking-toggle-header" style="cursor:pointer;" onclick="this.closest(\'.thinking-inline\').classList.toggle(\'thinking-expanded\')"><span>\u{1F9E0}</span><span style="color:var(--text-tertiary);">Thought for a moment</span><span class="thinking-chevron"> ▸</span></div><div class="thinking-inline-content">' + escapeHtml(thinkingText) + '</div></div>';
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

  // Persistence: use translated content if it exists and we're not showing original
  const displayContent = (msg.translated_content && !msg.show_original) ? msg.translated_content : msg.content;
  const cleanedContent = stripJsonBlocks(displayContent, isStreaming);
  let formatted = renderMarkdown(cleanedContent);
  formatted = processCharacterMentions(formatted);
  contentHtml += formatted;

  // Swipe Greetings UI for the first message
  const isFirstMessage = appState.currentChat?.messages?.[0]?.id === msg.id;
  const greetings = char?.alternate_greetings || [];
  const hasAltGreetings = greetings.length > 0;
  const currentIdx = appState.currentChat?.selected_greeting_index || 0;
  const totalGreetings = greetings.length + 1;

  const swipeHtml = (isFirstMessage && hasAltGreetings) ? `
    <div class="swipe-greetings">
      <button class="btn-swipe btn-swipe-left" title="Previous Greeting">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="swipe-index">${currentIdx + 1} / ${totalGreetings}</span>
      <button class="btn-swipe btn-swipe-right" title="Next Greeting">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  ` : '';

  el.innerHTML = `
    <div class="message-avatar">${avatarHtml}</div>
    <div class="message-body">
      <div class="message-content">
        <div class="message-text">${contentHtml || (isStreaming ? '<span class="streaming-cursor"></span>' : '')}</div>
      </div>
      ${swipeHtml}
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

    // If already translated, toggle between original and translated
    if (msg.translated_content) {
      msg.show_original = !msg.show_original;
      chatStore.updateMessage(msg.id, { show_original: msg.show_original });
      await chatStore.saveCurrentSession();

      const newDisplayContent = msg.show_original ? msg.content : msg.translated_content;

      // Update UI with a nice effect
      contentEl.classList.add('block-replacing-out');
      setTimeout(() => {
        let html = '';
        if (msg.thinking) html += createThinkingBlockHTML(msg.thinking, false);
        const cleaned = stripJsonBlocks(newDisplayContent, false);
        let formatted = renderMarkdown(cleaned);
        formatted = processCharacterMentions(formatted);
        html += formatted;
        contentEl.innerHTML = html;
        contentEl.classList.remove('block-replacing-out');
        contentEl.classList.add('block-replacing-in');
        setTimeout(() => contentEl.classList.remove('block-replacing-in'), 400);
      }, 300);
      return;
    }

    headerCharStatus.textContent = 'Translating message...';
    headerCharStatus.classList.add('generating');

    // Ensure spans exist for the replacement effect
    if (!contentEl.querySelector('.word-blur')) {
      const displayContent = (msg.translated_content && !msg.show_original) ? msg.translated_content : msg.content;
      const cleaned = stripJsonBlocks(displayContent, false);
      let formatted = renderMarkdown(cleaned);
      formatted = processCharacterMentions(formatted);
      contentEl.innerHTML = wrapWordsInSpans(formatted);
    }

    const translated = await performStreamingTranslation(contentEl, msg.content, target);
    if (translated) {
      chatStore.updateMessage(msg.id, { translated_content: translated, show_original: false });
      await chatStore.saveSession(appState.currentChat);
    }

    headerCharStatus.textContent = 'Ready';
    headerCharStatus.classList.remove('generating');
  });

  // Copy button
  el.querySelector('.btn-copy')?.addEventListener('click', () => {
    const copyContent = (msg.translated_content && !msg.show_original) ? msg.translated_content : msg.content;
    navigator.clipboard.writeText(copyContent);
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

  // Swipe listeners
  if (isFirstMessage && hasAltGreetings) {
    el.querySelector('.btn-swipe-left')?.addEventListener('click', () => swipeGreeting(msg.id, -1));
    el.querySelector('.btn-swipe-right')?.addEventListener('click', () => swipeGreeting(msg.id, 1));
  }

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

async function swipeGreeting(messageId, direction) {
  if (!appState.currentChat || appState.isGenerating) return;
  const char = appState.currentCharacter;
  if (!char) return;

  const greetings = [char.first_message, ...(char.alternate_greetings || [])];
  if (greetings.length <= 1) return;

  let currentIdx = appState.currentChat.selected_greeting_index || 0;
  currentIdx = (currentIdx + direction + greetings.length) % greetings.length;
  appState.currentChat.selected_greeting_index = currentIdx;

  const newContent = greetings[currentIdx];
  const settings = settingsStore.get();
  const userName = settings.user_name || 'User';
  let processedContent = newContent.replace(/\{\{user\}\}/gi, userName);
  processedContent = processedContent.replace(/\{\{char\}\}/gi, char.name);

  // Update store
  chatStore.updateMessage(messageId, { content: processedContent, translated_content: null });
  await chatStore.saveCurrentSession();

  // Re-render chat
  loadChat(appState.currentChat);
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}
window.scrollToBottom = scrollToBottom;

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
      const cleaned = stripJsonBlocks(newContent, false);
      let formatted = renderMarkdown(cleaned);
      formatted = processCharacterMentions(formatted);
      contentEl.innerHTML = formatted;
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
        // Show thinking block as soon as tag opens, even if content is still empty
        if (isInThinking || thinkingContent) html += createThinkingBlockHTML(thinkingContent, isInThinking);
        html += wrapWordsInSpans(renderMarkdown(displayContent));

        const temp = document.createElement('div');
        temp.className = contentEl.className;
        temp.innerHTML = html;
        morphdom(contentEl, temp, {
          childrenOnly: true,
          getNodeKey: (node) => node.dataset?.wordIndex || node.id || null
        });

        // Move the floating cursor to the end of the last rendered word
        if (!isInThinking) {
          getOrCreateChatCursor();
          repositionChatCursor(contentEl);
        }
      },
      async () => {
        removeChatCursor();
        const parsed = parseThinking(fullResponse);
        let finalHtml = '';
        if (parsed.thinking) finalHtml += createThinkingBlockHTML(parsed.thinking, false);
        finalHtml += wrapWordsInSpans(renderMarkdown(parsed.content));

        const tempFinal = document.createElement('div');
        tempFinal.className = contentEl.className;
        tempFinal.innerHTML = finalHtml;
        morphdom(contentEl, tempFinal, {
          childrenOnly: true,
          getNodeKey: (node) => node.dataset?.wordIndex || node.id || null
        });

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
          // Strict sequential execution IIFE to respect single-concurrency LLM limits
          (async () => {
            try {
              // 1. Generate continuation options replies first (High Priority UI)
              await generateContinuationOptions(character, session, msgElement);
            } catch (e) {
              console.warn('Failed to generate suggestions:', e);
            }

            try {
              // 2. Process Automatic Image Gen if active (High Priority UI)
              const freshSettings = settingsStore.get();
              if (freshSettings.comfyui_enabled && freshSettings.comfyui_auto_chat) {
                await triggerAutomaticImageGeneration(character, session, originalContent);
              } else if (freshSettings.comfyui_enabled && !freshSettings.comfyui_auto_chat) {
                await triggerImageGenerationSuggestion(character, session, originalContent, msgElement);
              }
            } catch (e) {
              console.warn('Failed to handle image generation:', e);
            }

            const lastUserMsg = session.messages.slice().reverse().find(m => m.role === 'user');
            if (lastUserMsg) {
              try {
                // 3. Extract and save memory (Low Priority Background)
                await extractAndShowMemory(character, session, lastUserMsg.content, originalContent, msgElement);
              } catch (e) {
                console.warn('Failed to extract memory:', e);
              }

              try {
                // 4. Update indicators status (Low Priority Background)
                await triggerIndicatorUpdate(character, session, lastUserMsg.content, originalContent);
              } catch (e) {
                console.warn('Failed to update indicators:', e);
              }
            }
          })();
        }
      },
      (err) => {
        console.error('Regeneration error:', err);
        removeChatCursor();
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

export function updateChatHistory() {
  if (!appState.currentCharacter) return;

  const list = document.getElementById('chat-history-list');
  if (!list) return;

  const sessions = chatStore.getSessions(appState.currentCharacter.id);
  const currentChat = appState.currentChat;

  // Напрямую обновляем DOM
  list.innerHTML = sessions.map(session => {
    const firstUserMsg = session.messages.find(m => m.role === 'user');
    let title = session.custom_title;
    if (!title) {
      title = firstUserMsg
        ? firstUserMsg.content.substring(0, 40) + (firstUserMsg.content.length > 40 ? '...' : '')
        : 'New Chat';
    }

    const isActive = currentChat && (session.id === currentChat.id);

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

  // Инициализация обработчиков только один раз
  if (!list._listenersAttached) {
    list._listenersAttached = true;
    list.addEventListener('click', async (e) => {
      // Удаление
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

        // Загружаем только если это другой чат
        if (session && session.id !== appState.currentChat?.id) {
          try {
            loadChat(session);
          } finally {
            updateChatHistory();
          }
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
  { "label": "Ask about sword", "message": "Where did you find that glowing sword?" },
  { "label": "Run away", "message": "I don't trust you, I'm leaving!" },
  { "label": "Offer help", "message": "How can I assist you with your quest?" }
]
Do not include any Markdown formatting like \`\`\`json or any other text. Return strictly the raw JSON array.`
    });

    const response = await api.chatCompletion(messages, {
      max_tokens: 300,
      temperature: 0.7,
      signal: signal,
      priority: 'background'
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

  // Append + button after the options
  const btnPlus = document.createElement('button');
  btnPlus.className = 'continuation-option-btn plus-option-btn';
  btnPlus.title = "Explore more unique options";
  btnPlus.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 14px; height: 14px; display: block;">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  `;
  btnPlus.style.animationDelay = `${options.slice(0, 3).length * 0.15}s`;
  btnPlus.addEventListener('click', () => {
    openMoreSuggestionsModal(character || appState.currentCharacter, session || appState.currentChat, msgElement);
  });
  optionsContainer.appendChild(btnPlus);

  if (optionsContainer.children.length > 0) {
    msgElement.querySelector('.message-body').appendChild(optionsContainer);
    scrollToBottom();
  }
}

// ─── AI Comment Feature ─────────────────────────────────────────────

async function requestAiComment(msg, character) {
  const settings = settingsStore.get();

  // Detect context
  const groupViewEl = document.getElementById('group-chat-view-container');
  const isGroupViewOpen = groupViewEl && !groupViewEl.classList.contains('hidden');

  let session, store, builder;
  if (isGroupViewOpen) {
    session = groupChatStore.getCurrentSession();
    store = groupChatStore;
    const groupId = groupChatStore.getActiveGroupId();
    const group = groupChatStore.getGroupById(groupId);
    const members = (group?.character_ids || []).map(id => characterStore.getById(id)).filter(Boolean);
    builder = (char, sess) => buildGroupApiMessages(char, members, sess);
  } else {
    session = chatStore.getCurrentSession();
    store = chatStore;
    builder = buildApiMessages;
  }

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
    contextMessages = builder(character, tempSession);
  } else {
    contextMessages = builder(character, session);
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
          store.addAiComment(msg.id, snippet, fullComment, session);
          store.saveSession(session);
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
  // Used for non-streaming contexts (e.g. genai-panel, book-view)
  const cursorHtml = '<span class="streaming-cursor"></span>';
  if (html.includes('</')) {
    return html.replace(/(<\/[a-z0-9]+>\s*)+$/i, (match) => cursorHtml + match);
  }
  return html + cursorHtml;
}



export function renderAiCommentsHistory() {
  const listEl = document.getElementById('ai-comments-list');
  if (!listEl) return;

  // Detect context
  const groupViewEl = document.getElementById('group-chat-view-container');
  const isGroupViewOpen = groupViewEl && !groupViewEl.classList.contains('hidden');

  let session;
  if (isGroupViewOpen) {
    session = groupChatStore.getCurrentSession();
  } else {
    session = chatStore.getCurrentSession();
  }

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

export function openAiCommentsSidebar() {
  const sidebar = document.getElementById('ai-comments-sidebar');
  const mainContent = document.getElementById('main-content');
  if (!sidebar) return;

  sidebar.classList.remove('hidden');
  sidebar.classList.remove('panel-bounce');
  void sidebar.offsetWidth;
  sidebar.classList.add('panel-bounce');

  if (mainContent) mainContent.classList.add('is-animating');
  document.body.classList.add('ai-sidebar-open');

  setTimeout(() => {
    renderAiCommentsHistory();
  }, 300);

  setTimeout(() => {
    if (mainContent) mainContent.classList.remove('is-animating');
  }, 600);
}

export function closeAiCommentsSidebar() {
  const mainContent = document.getElementById('main-content');
  if (mainContent) mainContent.classList.add('is-animating');
  document.body.classList.remove('ai-sidebar-open');

  setTimeout(() => {
    if (mainContent) mainContent.classList.remove('is-animating');
    const sidebar = document.getElementById('ai-comments-sidebar');
    if (sidebar) sidebar.classList.add('hidden');
  }, 600);
}

function setupRightSidebarToggle() {
  const toggleBtn = document.getElementById('btn-toggle-right-sidebar');
  const closeBtn = document.getElementById('btn-close-ai-comments-sidebar');

  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      const settings = settingsStore.get();
      const isGenAIMode = settings.genai_mode_enabled;

      if (isGenAIMode) {
        const isCurrentlyOpen = document.body.classList.contains('genai-sidebar-open');
        const genaiModule = await import('./genai-panel.js');
        if (isCurrentlyOpen) {
          genaiModule.closeGenAIPanel();
        } else {
          // Ensure comments are closed
          document.body.classList.remove('ai-sidebar-open');
          const commentsSidebar = document.getElementById('ai-comments-sidebar');
          if (commentsSidebar) commentsSidebar.classList.add('hidden');

          genaiModule.openGenAIPanel();
        }
      } else {
        const isCurrentlyOpen = document.body.classList.contains('ai-sidebar-open');
        if (isCurrentlyOpen) {
          closeAiCommentsSidebar();
        } else {
          // Ensure genai is closed
          document.body.classList.remove('genai-sidebar-open');
          const genaiSidebar = document.getElementById('genai-sidebar');
          if (genaiSidebar) genaiSidebar.classList.add('hidden');

          openAiCommentsSidebar();
        }
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      closeAiCommentsSidebar();
    });
  }
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
    const response = await api.chatCompletion(context, { max_tokens: 150, temperature: 0.1, priority: 'background' });
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

// ─── Character Mentions & JSON Cleaning Helpers ───

function cleanCharacterName(name) {
  if (!name) return '';
  return name.replace(/\{\{char:/g, '').replace(/\}\}/g, '').replace(/char:/g, '').trim();
}

function stripJsonBlocks(text, isStreaming = false) {
  if (!text) return '';
  
  let cleaned = text;

  // 1. Remove complete markdown JSON blocks
  cleaned = cleaned.replace(/```json[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/```[\s\S]*?```/g, (match) => {
    const inner = match.slice(3, -3).trim();
    if ((inner.startsWith('{') && inner.endsWith('}')) || (inner.startsWith('[') && inner.endsWith(']'))) {
      return '';
    }
    return match;
  });

  // 2. If streaming, remove any incomplete markdown code blocks starting with ```json or ```{
  if (isStreaming) {
    const index = cleaned.indexOf('```json');
    if (index !== -1) {
      cleaned = cleaned.substring(0, index);
    }
    const indexPlain = cleaned.indexOf('```');
    if (indexPlain !== -1) {
      const rest = cleaned.substring(indexPlain + 3).trim();
      if (rest.startsWith('{') || rest.startsWith('[')) {
        cleaned = cleaned.substring(0, indexPlain);
      }
    }
    // Hide partial char mentions so they don't leak as raw text during streaming
    cleaned = cleaned.replace(/\{\{[^}]*$/, '');
  }

  // 3. Remove raw trailing JSON objects or arrays
  const lastCurly = cleaned.lastIndexOf('{');
  if (lastCurly !== -1) {
    const candidate = cleaned.substring(lastCurly).trim();
    if (candidate.startsWith('{') && (candidate.includes('":') || candidate.endsWith('}'))) {
      try {
        JSON.parse(candidate + (candidate.endsWith('}') ? '' : '}'));
        cleaned = cleaned.substring(0, lastCurly);
      } catch (e) {
        if (candidate.includes('":') && candidate.endsWith('}')) {
          cleaned = cleaned.substring(0, lastCurly);
        }
      }
    }
  }
  const lastSquare = cleaned.lastIndexOf('[');
  if (lastSquare !== -1) {
    const candidate = cleaned.substring(lastSquare).trim();
    if (candidate.startsWith('[{') && candidate.endsWith('}]')) {
      cleaned = cleaned.substring(0, lastSquare);
    }
  }

  return cleaned.trim();
}

function processCharacterMentions(text) {
  if (!text) return '';
  return text.replace(/\{\{char:([^|}]+)(?:\|([^}]+))?\}\}/g, (match, name, alias) => {
    const displayName = alias ? alias.trim() : name.trim();
    return `<span class="char-mention" data-char-name="${name.trim()}">${displayName}</span>`;
  });
}

function showCharacterTooltip(element, char) {
  // Remove existing tooltips
  document.querySelectorAll('.char-tooltip').forEach(t => t.remove());

  const tooltip = document.createElement('div');
  tooltip.className = 'char-tooltip';
  tooltip.style.position = 'absolute';
  tooltip.style.background = 'rgba(15, 15, 20, 0.95)';
  tooltip.style.backdropFilter = 'blur(10px)';
  tooltip.style.border = '1px solid var(--border-subtle)';
  tooltip.style.borderRadius = 'var(--radius-md)';
  tooltip.style.padding = '12px 16px';
  tooltip.style.zIndex = '9999';
  tooltip.style.maxWidth = '250px';
  tooltip.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
  tooltip.style.color = 'var(--text-primary)';
  tooltip.style.animation = 'fadeIn 0.2s ease';
  
  const shortDesc = char.short_description || char.description || 'No description available.';
  tooltip.innerHTML = `
    <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 4px; color: var(--text-accent);">${char.name}</div>
    <div style="font-size: 0.85rem; line-height: 1.4; color: var(--text-secondary);">${shortDesc}</div>
  `;

  document.body.appendChild(tooltip);

  const rect = element.getBoundingClientRect();
  tooltip.style.top = `${rect.bottom + window.scrollY + 8}px`;
  
  // Center relative to element, but keep inside window bounds
  let left = rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2);
  if (left < 10) left = 10;
  if (left + tooltip.offsetWidth > window.innerWidth - 10) {
    left = window.innerWidth - tooltip.offsetWidth - 10;
  }
  tooltip.style.left = `${left}px`;

  // Close when clicking outside
  const closeHandler = (e) => {
    if (!tooltip.contains(e.target) && e.target !== element) {
      tooltip.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  
  // Use timeout to avoid immediately closing from the current click event
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
  }, 10);
}

// ─── Suggestions Explorer Modal Logic ───────────────────────────────

function openMoreSuggestionsModal(character, session, msgElement) {
  moreSuggestionsContext = { character, session, msgElement };
  generatedSuggestionsHistory = [];
  
  // Also collect the options already shown in the chat so we avoid them too!
  if (session && msgElement) {
    const msgId = msgElement.dataset.messageId;
    const msg = session.messages.find(m => m.id === msgId);
    if (msg && msg.options) {
      msg.options.forEach(opt => {
        if (opt.label) generatedSuggestionsHistory.push(opt.label);
      });
    }
  }
  
  const modal = document.getElementById('more-suggestions-modal');
  const welcome = document.getElementById('more-suggestions-welcome');
  const content = document.getElementById('more-suggestions-content');
  const topicInput = document.getElementById('more-suggestions-topic-input');
  
  if (welcome) welcome.classList.remove('hidden');
  if (content) {
    content.innerHTML = '';
    content.classList.add('hidden');
  }
  if (topicInput) topicInput.value = '';
  
  openWindow(modal);
  
  // Kick off automatic initial generation
  generateMoreSuggestions();
}

async function generateMoreSuggestions(customTopic = null) {
  const { character, session } = moreSuggestionsContext;
  if (!character || !session) return;
  
  // Abort previous generation if any
  abortMoreSuggestionsGeneration();
  
  const welcome = document.getElementById('more-suggestions-welcome');
  const content = document.getElementById('more-suggestions-content');
  const body = document.getElementById('more-suggestions-body');
  
  if (welcome) welcome.classList.add('hidden');
  if (content) {
    content.classList.remove('hidden');
    content.innerHTML = '<span class="streaming-cursor"></span>';
    content.classList.add('generating');
  }
  
  const controller = new AbortController();
  moreSuggestionsAbortController = controller;
  
  try {
    const messages = buildApiMessages(character, session);
    if (messages.length === 0) return;
    
    const settings = settingsStore.get();
    const suggestionsLang = settings.suggestions_language || 'Russian';
    
    let systemInstruction = `Based on the conversation so far, generate several highly unique, engaging, and creative reply options for the user.
For each option:
1. Write a brief narrative description of the option's tone, style, and potential consequences (1-2 sentences).
2. Follow it with a JSON block representing the action/button.

Each JSON block must strictly follow this exact format:
\`\`\`json
{
  "label": "Button Name",
  "message": "Full hidden message to send to the chat"
}
\`\`\`

CRITICAL INSTRUCTIONS:
1. The description and the JSON "label" field (button name, max 4 words) MUST be strictly in ${suggestionsLang}.
2. The JSON "message" field (the actual prompt to send to chat) MUST be strictly in English.
3. You must generate at least 3-4 distinct and highly creative options.`;

    if (customTopic) {
      systemInstruction += `\n\nCRITICAL SPECIAL REQUEST: The user specifically requested that all options should fit this theme or topic: "${customTopic}". Make sure ALL generated choices match this theme!`;
    }

    if (generatedSuggestionsHistory.length > 0) {
      systemInstruction += `\n\nCRITICAL DIVERSITY INSTRUCTION: Avoid generating options that are similar to or duplicate these already generated choices: ${JSON.stringify(generatedSuggestionsHistory)}. Ensure the new reply choices are completely fresh, unique, and present different pathways!`;
    }
    
    messages.push({
      role: 'system',
      content: systemInstruction
    });
    
    let fullText = '';
    
    await api.streamChat(
      messages,
      controller.signal,
      (chunk) => {
        fullText += chunk;
        
        const rendered = renderSuggestionsHTML(fullText);
        content.innerHTML = rendered.html + '<span class="streaming-cursor"></span>';
        
        attachSuggestionButtonListeners(content, rendered.buttonsData);
        
        if (body) {
          body.scrollTop = body.scrollHeight;
        }
      },
      () => {
        moreSuggestionsAbortController = null;
        content.classList.remove('generating');
        
        const rendered = renderSuggestionsHTML(fullText);
        content.innerHTML = rendered.html;
        attachSuggestionButtonListeners(content, rendered.buttonsData);
        
        // Save the newly generated options into the avoid list/history
        if (rendered.buttonsData && rendered.buttonsData.length > 0) {
          rendered.buttonsData.forEach(btn => {
            if (btn.label && !generatedSuggestionsHistory.includes(btn.label)) {
              generatedSuggestionsHistory.push(btn.label);
            }
          });
        }
        
        if (body) {
          body.scrollTop = body.scrollHeight;
        }
      },
      (err) => {
        if (err.name === 'AbortError' || err.message?.includes('abort')) return;
        console.error('Failed to stream more suggestions:', err);
        content.innerHTML = `<p style="color: var(--error);">Error: ${escapeHtml(err.message)}</p>`;
        content.classList.remove('generating');
        moreSuggestionsAbortController = null;
      },
      {
        max_tokens: 1000,
        temperature: 0.85
      }
    );
  } catch (err) {
    console.error('generateMoreSuggestions error:', err);
    if (content) {
      content.innerHTML = `<p style="color: var(--error);">Error: ${escapeHtml(err.message)}</p>`;
      content.classList.remove('generating');
    }
    moreSuggestionsAbortController = null;
  }
}

function abortMoreSuggestionsGeneration() {
  if (moreSuggestionsAbortController) {
    moreSuggestionsAbortController.abort();
    moreSuggestionsAbortController = null;
  }
}

function renderSuggestionsHTML(rawText) {
  // Strip leading whitespace
  let displayContent = rawText.replace(/^[\s\n]+/, '');

  let processedText = displayContent;
  let showPreemptiveWorking = false;

  // Mathematically robust tick block tracking
  const tickCount = (displayContent.match(/```/g) || []).length;
  const isInsideUnclosedCodeBlock = (tickCount % 2 === 1);
  let isInsideUnclosedJsonCodeBlock = false;
  let unclosedTickIndex = -1;

  if (isInsideUnclosedCodeBlock) {
    unclosedTickIndex = displayContent.lastIndexOf('```');
    const afterTick = displayContent.substring(unclosedTickIndex).replace(/\s/g, '').toLowerCase();
    if (['', 'j', 'js', 'jso', 'json'].some(s => afterTick === '```' + s) || afterTick.startsWith('```json')) {
      isInsideUnclosedJsonCodeBlock = true;
    }
  }

  const braceIndex = displayContent.lastIndexOf('{');

  if (isInsideUnclosedJsonCodeBlock) {
    processedText = displayContent.substring(0, unclosedTickIndex);
    showPreemptiveWorking = true;
  } else {
    // If not already preemptively showing, check curly braces
    if (braceIndex !== -1) {
      const afterBrace = displayContent.substring(braceIndex);
      const normalized = afterBrace.replace(/\s/g, '').toLowerCase();

      // Check if it starts like a JSON block
      const isJsonBlock = normalized.startsWith('{"label') || 
                          normalized.startsWith('{"message') || 
                          normalized.startsWith('{"target') ||
                          normalized.includes('label') || 
                          normalized.includes('message');

      if (isJsonBlock || afterBrace.length < 25) {
        processedText = displayContent.substring(0, braceIndex);
        showPreemptiveWorking = true;
      }
    }
  }

  if (showPreemptiveWorking) {
    // Clean up any preceding code block markers so they don't leak either
    const precedingTick = processedText.lastIndexOf('```');
    if (precedingTick !== -1) {
      const afterPreceding = processedText.substring(precedingTick).replace(/\s/g, '').toLowerCase();
      if (['', 'j', 'js', 'jso', 'json'].some(s => afterPreceding === '```' + s)) {
        processedText = processedText.substring(0, precedingTick);
      }
    }
  }

  const blockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  const matches = [...processedText.matchAll(blockRegex)];
  const buttonsData = [];
  let buttonIndex = 0;
  
  matches.forEach(m => {
    const fullBlock = m[0];
    const innerContent = m[1].trim();
    try {
      const json = JSON.parse(innerContent);
      if (json && (json.label || json.message)) {
        const token = `__BUTTON_PLACEHOLDER_${buttonIndex}__`;
        processedText = processedText.replace(fullBlock, token);
        buttonsData.push({
          label: json.label || 'Select option',
          message: json.message || ''
        });
        buttonIndex++;
      }
    } catch (e) {
      // Ignore incomplete / invalid JSON
    }
  });
  
  let finalHtml = renderMarkdown(processedText);
  
  buttonsData.forEach((btnData, i) => {
    const placeholder = `__BUTTON_PLACEHOLDER_${i}__`;
    const btnHtml = `<div class="inline-suggestion-btn-container">
      <button class="continuation-option-btn inline-suggest-btn" data-btn-index="${i}">
        ${escapeHtml(btnData.label)}
      </button>
    </div>`;
    finalHtml = finalHtml.replace(placeholder, btnHtml);
  });

  if (showPreemptiveWorking) {
    finalHtml += `<div class="genai-inline-tool genai-tool-working" style="margin-top: 10px;"><span class="genai-working-text">Working...</span></div>`;
  }
  
  return { html: finalHtml, buttonsData };
}

function attachSuggestionButtonListeners(container, buttonsData) {
  const buttons = container.querySelectorAll('.inline-suggest-btn');
  buttons.forEach(btn => {
    if (btn._listenerBound) return;
    btn._listenerBound = true;
    
    const index = parseInt(btn.getAttribute('data-btn-index'));
    const data = buttonsData[index];
    if (!data) return;
    
    btn.addEventListener('click', () => {
      closeWindow('more-suggestions-modal');
      abortMoreSuggestionsGeneration();
      
      const { msgElement, session } = moreSuggestionsContext;
      if (msgElement) {
        const optionsEl = msgElement.querySelector('.continuation-options');
        if (optionsEl) optionsEl.remove();
        
        const msgId = msgElement.dataset.messageId;
        if (session) {
          const msg = session.messages.find(m => m.id === msgId);
          if (msg) {
            delete msg.options;
            chatStore.saveSession(session);
          }
        }
      }
      
      if (data.message) {
        messageInput.value = data.message;
        sendMessage();
      }
    });
  });
}

async function triggerAutomaticImageGeneration(character, session, assistantReply) {
  // 1. Find the last assistant message to embed in
  const lastMsg = session.messages.slice().reverse().find(m => m.role === 'assistant');
  if (!lastMsg) return;

  // Start image generation state
  appState.isGenerating = true;
  appState.abortController = new AbortController();

  if (appState.currentCharacter?.id === character.id) {
    btnSend.classList.add('hidden');
    btnStop.classList.remove('hidden');
    headerCharStatus.textContent = 'Generating illustration...';
    headerCharStatus.classList.add('generating');
  }

  // Preserve the original text of the message so we can restore/append cleanly
  if (!lastMsg.original_text) {
    lastMsg.original_text = lastMsg.content;
  }

  // Set initial loading state while the LLM is writing the prompt
  lastMsg.content = lastMsg.original_text + '\n\n[[loader:Drafting the scene description...]]';
  loadChat(session); // re-render instantly to show loader

  // Build a complete history context up to settings.prompt_token_limit
  const settings = settingsStore.get();
  const userName = session.user_name || settings.user_name || 'User';

  const historyLines = session.messages
    .filter(m => m.role !== 'system' && (m.content || m.original_text))
    .map(m => {
      const name = m.role === 'user' ? userName : character.name;
      const text = m.role === 'user' ? (m.translated_content || m.content) : (m.original_text || m.content);
      return `${name}: ${text}`;
    });

  const tokenLimit = Math.max(settings.prompt_token_limit || 4096, 2048);
  const charLimit = tokenLimit * 4;

  const charData = `Character: ${character.name}\nDescription: ${character.description || ''}\nPersonality: ${character.personality || ''}\nScenario: ${character.scenario || ''}`;
  const mandatoryTags = (character.image_tags && character.image_tags.trim() !== '') 
    ? `\n\nMANDATORY IMAGE TAGS: ${character.image_tags}\nYou MUST include these exact tags in your final Stable Diffusion prompt.` 
    : '';

  // Base overhead length estimation (prompts, instruction template)
  const baseOverheadLen = charData.length + mandatoryTags.length + 1500;

  let selectedLines = [];
  let currentLen = baseOverheadLen;

  for (let i = historyLines.length - 1; i >= 0; i--) {
    const line = historyLines[i];
    if (currentLen + line.length + 1 > charLimit) {
      break;
    }
    selectedLines.unshift(line);
    currentLen += line.length + 1;
  }

  const formattedHistory = selectedLines.join('\n');

  let contextText = `${charData}\n\nCONVERSATION HISTORY:\n${formattedHistory}`;
  if (character.image_tags && character.image_tags.trim() !== '') {
    contextText += mandatoryTags;
  }
  
  const messages = [
    {
      role: 'system',
      content: `You are an expert prompt engineer and scenic narrator for AI image generators.
Analyze the character profile and the entire conversation history context carefully.
CRITICAL DIRECTIVE: You MUST pay close attention to all visual and narrative context clues, details, and progression in the conversation history (such as the character's attire/clothing, physical pose, emotions, facial expressions, weapons or objects held, background environment, lighting, time of day, and active setting). Do NOT miss or ignore these details! Your generated Stable Diffusion prompt must accurately reflect the CURRENT state and context of the scene.

You must generate two things:
1. An array of 3 creative loading status messages in English describing the drawing process (e.g. "Sketching the forest outline...", "Detailing character clothing...", "Adding volumetric lighting..."). Be very short (3-5 words each).
2. A detailed, highly descriptive illustration prompt for Stable Diffusion (Anima model) in English that incorporates all mandatory tags and the full visual context.

You MUST respond strictly in the following JSON format. Output ONLY raw JSON, do not include markdown codeblocks or conversational text:
{
  "statuses": ["creative message 1", "creative message 2", "creative message 3"],
  "prompt": "detailed stable diffusion keywords in English"
}`
    },
    {
      role: 'user',
      content: `Create an image prompt and status messages for this scene:\n\n${contextText}`
    }
  ];

  let parsed = null;
  try {
    if (appState.abortController.signal.aborted) throw new Error('Stopped by user');
    const rawResponse = await api.chatCompletion(messages, { temperature: 0.7, max_tokens: 250 });
    let cleanText = rawResponse.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json/m, '').replace(/```$/m, '').trim();
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```/m, '').replace(/```$/m, '').trim();
    }
    parsed = JSON.parse(cleanText);
    
    // Strictly enforce tags by prepending them to the generated prompt
    if (parsed.prompt && character.image_tags && character.image_tags.trim() !== '') {
      // Ensure we don't duplicate if the LLM already included them at the start
      if (!parsed.prompt.toLowerCase().includes(character.image_tags.trim().toLowerCase())) {
        parsed.prompt = `${character.image_tags.trim()}, ${parsed.prompt}`;
      }
    }
  } catch (e) {
    console.warn('Failed to parse LLM prompt generation JSON:', e);
    parsed = {
      statuses: ['Generating illustration...', 'Rendering details...', 'Adding final touches...'],
      prompt: `anime illustration, detailed, ${character.name}, ${lastMsg.original_text.substring(0, 150)}`
    };
  }

  if (appState.abortController?.signal?.aborted) {
    cleanupState();
    return;
  }

  // Update loader with the custom neural-network selected status messages
  const statusesStr = Array.isArray(parsed.statuses) ? parsed.statuses.join('|') : (parsed.status || 'Generating...');
  lastMsg.content = lastMsg.original_text + `\n\n[[loader:${statusesStr}]]`;
  chatStore.saveCurrentSession();
  loadChat(session); // re-render instantly to show the custom status message

  function cleanupState() {
    if (appState.currentCharacter?.id === character.id) {
      appState.isGenerating = false;
      appState.abortController = null;
      btnSend.classList.remove('hidden');
      btnStop.classList.add('hidden');
      headerCharStatus.textContent = 'Ready';
      headerCharStatus.classList.remove('generating');
      updateRegenerateVisibility();
      scrollToBottom();
    } else {
      appState.isGenerating = false;
      appState.abortController = null;
    }
  }

  try {
    // 2. Generate the image via ComfyUI service with Abort Signal
    const blobUrl = await generateImageComfyUI(parsed.prompt, null, appState.abortController.signal);

    if (appState.abortController?.signal?.aborted) {
      cleanupState();
      return;
    }

    // 3. Replace loading message with the final image markdown
    lastMsg.content = lastMsg.original_text + `\n\n![${parsed.prompt}](${blobUrl})`;
    chatStore.saveCurrentSession();
    cleanupState();
    loadChat(session); // re-render to display the image!
  } catch (err) {
    console.error('Auto image generation failed:', err);
    
    if (appState.abortController?.signal?.aborted) {
      cleanupState();
      return;
    }

    // Replace loader with the error block
    lastMsg.content = lastMsg.original_text + `\n\n❌ **Ошибка генерации:** ${err.message}`;
    chatStore.saveCurrentSession();
    cleanupState();
    loadChat(session); // re-render to show the error
  }
}

// ─── Auto-Suggest Image Generation ───

async function triggerImageGenerationSuggestion(character, session, assistantReply, msgElement) {
  // Check if a suggestion popup is already active or generation is in progress
  if (appState.isGenerating || !document.getElementById('image-suggestion-wrapper').classList.contains('hidden')) {
    return;
  }

  const contextText = `Character: ${character.name} (${character.description || character.personality || ''})\n\nScene/Action: ${assistantReply}`;
  
  const messages = [
    {
      role: 'system',
      content: 'You are an AI assistant that analyzes a roleplay scene to decide if an image illustration should be generated. If the scene contains strong visual elements, action, or a distinct setting, you should recommend generating an image. If it is just dialogue or internal thoughts with no visual substance, decline.\n\nRespond strictly in the following JSON format:\n{\n  "should_generate": true/false,\n  "suggestion_text": "A very short, 1-sentence prompt suggestion describing what you envision (e.g. \\\'A cozy fireplace scene with the character reading a book\\\')"\n}'
    },
    {
      role: 'user',
      content: `Analyze this scene:\n\n${contextText}`
    }
  ];

  try {
    const rawResponse = await api.chatCompletion(messages, { temperature: 0.5, max_tokens: 200, priority: 'background' });
    let cleanText = rawResponse.trim();
    if (cleanText.startsWith('```json')) cleanText = cleanText.replace(/^```json/m, '').replace(/```$/m, '').trim();
    else if (cleanText.startsWith('```')) cleanText = cleanText.replace(/^```/m, '').replace(/```$/m, '').trim();
    
    const parsed = JSON.parse(cleanText);
    
    if (parsed.should_generate && parsed.suggestion_text) {
      showImageSuggestionPopup(character, session, parsed.suggestion_text);
    }
  } catch (e) {
    console.warn('Failed to parse LLM image suggestion JSON:', e);
  }
}

function showImageSuggestionPopup(character, session, suggestionText) {
  const wrapper = document.getElementById('image-suggestion-wrapper');
  const textEl = document.getElementById('image-suggestion-text');
  const btnDecline = document.getElementById('btn-suggestion-decline');
  const btnGenerate = document.getElementById('btn-suggestion-generate');

  if (!wrapper || !textEl) return;

  textEl.textContent = suggestionText;
  wrapper.classList.remove('hidden');

  // Clear previous listeners
  const newBtnDecline = btnDecline.cloneNode(true);
  const newBtnGenerate = btnGenerate.cloneNode(true);
  btnDecline.replaceWith(newBtnDecline);
  btnGenerate.replaceWith(newBtnGenerate);

  newBtnDecline.addEventListener('click', () => {
    wrapper.classList.add('hidden');
  });

  newBtnGenerate.addEventListener('click', () => {
    wrapper.classList.add('hidden');
    // Find the last assistant message
    const lastMsg = session.messages.slice().reverse().find(m => m.role === 'assistant');
    if (!lastMsg) return;

    // Trigger standard automatic generation flow
    triggerAutomaticImageGeneration(character, session, lastMsg.content);
  });
}

async function triggerAutomaticImageGenerationWithPrompt(character, session, msg, prompt) {
  appState.isGenerating = true;
  appState.abortController = new AbortController();

  if (appState.currentCharacter?.id === character.id) {
    btnSend.classList.add('hidden');
    btnStop.classList.remove('hidden');
    headerCharStatus.textContent = 'Generating illustration...';
    headerCharStatus.classList.add('generating');
  }

  if (!msg.original_text) msg.original_text = msg.content;
  msg.content = msg.original_text + '\n\n[[loader:Generating suggested illustration...|Rendering details...|Adding final touches...]]';
  loadChat(session);

  function cleanupState() {
    if (appState.currentCharacter?.id === character.id) {
      appState.isGenerating = false;
      appState.abortController = null;
      btnSend.classList.remove('hidden');
      btnStop.classList.add('hidden');
      headerCharStatus.textContent = 'Ready';
      headerCharStatus.classList.remove('generating');
      updateRegenerateVisibility();
      scrollToBottom();
    } else {
      appState.isGenerating = false;
      appState.abortController = null;
    }
  }

  try {
    const blobUrl = await generateImageComfyUI(prompt, null, appState.abortController.signal);
    if (appState.abortController?.signal?.aborted) { cleanupState(); return; }

    msg.content = msg.original_text + `\n\n![${prompt}](${blobUrl})`;
    chatStore.saveCurrentSession();
    cleanupState();
    loadChat(session);
  } catch (err) {
    console.error('Auto image generation failed:', err);
    if (appState.abortController?.signal?.aborted) { cleanupState(); return; }

    msg.content = msg.original_text + `\n\n❌ **Ошибка генерации:** ${err.message}`;
    chatStore.saveCurrentSession();
    cleanupState();
    loadChat(session);
  }
}

// Global function to initialize status rotation
window.initStatusRotation = function(container) {
  if (!container || container.dataset.rotatorInited) return;
  container.dataset.rotatorInited = '1';

  const statuses = container.querySelectorAll('.chat-image-loader-status');
  if (statuses.length <= 1) return;

  let currentIndex = 0;

  // Random interval between 4s and 6s
  const getRandomInterval = () => Math.floor(Math.random() * 2000) + 4000;

  const rotate = () => {
    // If element is no longer in DOM, stop rotation
    if (!container.isConnected) return;

    const currentStatus = statuses[currentIndex];
    const nextIndex = (currentIndex + 1) % statuses.length;
    const nextStatus = statuses[nextIndex];

    currentStatus.classList.remove('active');
    currentStatus.classList.add('exit');

    nextStatus.classList.remove('exit');
    nextStatus.classList.add('active');

    currentIndex = nextIndex;

    setTimeout(rotate, getRandomInterval());
  };

  setTimeout(rotate, getRandomInterval());
};

