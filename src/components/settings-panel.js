/* ════════════════════════════════════════════════════════════════════
   Settings Panel — Configuration UI
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from '../services/settings-store.js';
import { showToast, checkConnection, applyGlobalSettingsStyles, openWindow, closeWindow } from '../main.js';
import { api } from '../services/api.js';

let currentSettings;
let editingGamePresetId = null;

export function initSettingsPanel() {
  const panel = document.getElementById('settings-panel');
  const btnOpen = document.getElementById('btn-settings');
  const btnClose = document.getElementById('btn-close-settings');
  const btnTestConnection = document.getElementById('btn-test-connection');

  // Sub-modal mapping
  const categories = [
    { id: 'card-connection', modalId: 'modal-settings-connection' },
    { id: 'card-features', modalId: 'modal-settings-features' },
    { id: 'card-language', modalId: 'modal-settings-language' },
    { id: 'card-interface', modalId: 'modal-settings-interface' },
    { id: 'card-advanced', modalId: 'advanced-settings-modal' },
    { id: 'card-genai', modalId: 'modal-settings-genai' },
    { id: 'card-game', modalId: 'modal-settings-game' }
  ];

  categories.forEach(cat => {
    const card = document.getElementById(cat.id);
    if (card) {
      card.addEventListener('click', () => {
        loadSettingsToUI();
        openWindow(cat.modalId);
      });
    }
  });

  // Global open settings menu
  btnOpen.addEventListener('click', () => {
    loadSettingsToUI();
    openWindow(panel);
    closeWindow('memory-panel');
  });
  btnClose.addEventListener('click', () => closeWindow(panel));

  // Save buttons in sub-modals
  const saveButtons = document.querySelectorAll('.btn-save-settings');
  saveButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      await saveSettings();
      const modal = e.target.closest('.modal');
      if (modal) closeWindow(modal);
    });
  });

  // Close sub-modals via X button
  const subModalCloseButtons = document.querySelectorAll('.btn-close-submodal');
  subModalCloseButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal');
      if (modal) closeWindow(modal);
    });
  });

  // Test connection
  if (btnTestConnection) {
    btnTestConnection.addEventListener('click', testConnection);
  }

  // Range inputs: show values in real-time
  setupRangeInput('setting-font-size', 'font-size-value', v => v);
  setupRangeInput('adv-setting-max-tokens', 'adv-max-tokens-value', v => v);
  setupRangeInput('adv-setting-temperature', 'adv-temperature-value', v => parseFloat(v).toFixed(2));
  setupRangeInput('adv-setting-top-p', 'adv-top-p-value', v => parseFloat(v).toFixed(2));
  setupRangeInput('adv-setting-top-k', 'adv-top-k-value', v => v);
  setupRangeInput('adv-setting-rep-penalty', 'adv-rep-penalty-value', v => parseFloat(v).toFixed(2));

  // Syncing toggles
  const syncToggles = [
    { id: 'setting-thinking', target: 'thinking-toggle' }
  ];
  syncToggles.forEach(sync => {
    const el = document.getElementById(sync.id);
    if (el) {
      el.addEventListener('change', (e) => {
        const target = document.getElementById(sync.target);
        if (target) target.checked = e.target.checked;
      });
    }
  });

  // Bind GM prompt presets editor events
  const btnAddGamePreset = document.getElementById('btn-add-game-preset');
  if (btnAddGamePreset) {
    btnAddGamePreset.addEventListener('click', createNewGamePreset);
  }

  const settingGamePresetName = document.getElementById('setting-game-preset-name');
  if (settingGamePresetName) {
    settingGamePresetName.addEventListener('input', updateEditingGamePreset);
  }

  const settingGameSystemPrompt = document.getElementById('setting-game-system-prompt');
  if (settingGameSystemPrompt) {
    settingGameSystemPrompt.addEventListener('input', updateEditingGamePreset);
  }

  // Load initial values
  loadSettingsToUI();
  initVibeDropdowns();

  // Listen for global settings updates
  window.addEventListener('settings-updated', () => {
    loadSettingsToUI();
    applyGlobalSettingsStyles();
  });
}

function setupRangeInput(inputId, valueId, formatter) {
  const input = document.getElementById(inputId);
  const valueEl = document.getElementById(valueId);
  if (!input || !valueEl) return;

  const updateValue = () => {
    valueEl.textContent = formatter(input.value);
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const val = parseFloat(input.value);
    const pct = ((val - min) / (max - min)) * 100;
    input.style.setProperty('--range-fill', `${pct}%`);
  };

  input.addEventListener('input', updateValue);
  updateValue();
}

function loadSettingsToUI() {
  const settings = settingsStore.get();

  const apiUrlInput = document.getElementById('setting-api-url');
  if (apiUrlInput) apiUrlInput.value = settings.api_url;

  const promptTokenLimitInput = document.getElementById('setting-prompt-token-limit');
  if (promptTokenLimitInput) promptTokenLimitInput.value = settings.prompt_token_limit;
  
  setRangeValue('setting-font-size', 'font-size-value', settings.font_size);

  const checkField = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  };
  const setField = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };

  checkField('setting-thinking', settings.thinking_enabled);
  checkField('setting-thinking-snippets', settings.thinking_snippets);
  setRangeValue('adv-setting-max-tokens', 'adv-max-tokens-value', settings.max_tokens);
  setRangeValue('adv-setting-temperature', 'adv-temperature-value', settings.temperature?.toFixed(2));
  setRangeValue('adv-setting-top-p', 'adv-top-p-value', settings.top_p?.toFixed(2));
  setRangeValue('adv-setting-top-k', 'adv-top-k-value', settings.top_k);
  setRangeValue('adv-setting-rep-penalty', 'adv-rep-penalty-value', settings.repeat_penalty?.toFixed(2));
  checkField('setting-memory', settings.memory_enabled);
  checkField('setting-auto-translate', settings.auto_translate);
  checkField('setting-translate-user', settings.translate_user_messages);
  checkField('setting-italic-asterisks', settings.italic_asterisks);
  checkField('setting-ai-comments', settings.ai_comments_enabled);
  checkField('setting-suggestions-enabled', settings.suggestions_enabled);
  
  setField('setting-target-lang', settings.target_language || 'Russian');
  setField('setting-outgoing-lang', settings.outgoing_target_language || 'English');
  setField('setting-suggestions-lang', settings.suggestions_language || 'Russian');
  setField('setting-ai-comments-lang', settings.ai_comments_language || 'Auto');
  
  setField('setting-genai-response-length', settings.genai_response_length || 'default');
  setField('setting-genai-speech-style', settings.genai_speech_style || 'default');
  checkField('setting-genai-safe-mode', settings.genai_safe_mode);

  currentSettings = settings;
  editingGamePresetId = settings.active_game_prompt_preset_id || 'default-game-1';
  
  // Make sure game_prompt_presets exists in memory to prevent crashes
  if (!currentSettings.game_prompt_presets) {
    currentSettings.game_prompt_presets = [
      {
        id: 'default-game-1',
        name: 'Standard GM',
        content: 'You are a Game Master in an interactive text RPG.'
      },
      {
        id: 'default-game-2',
        name: 'Dark Fantasy',
        content: 'You are a dark fantasy Game Master. The world is gritty, dangerous, and unforgiving. Choices have severe consequences, and victory is hard-earned.'
      },
      {
        id: 'default-game-3',
        name: 'Space Opera',
        content: 'You are a sci-fi Space Opera Game Master. The setting is filled with advanced technologies, space exploration, galactic empires, and high-tech combat.'
      }
    ];
  }

  selectGamePreset(editingGamePresetId);
  setField('setting-game-response-length', settings.game_response_length || 'default');

  // Update custom dropdown triggers
  updateVibeDropdownTriggers();
}

function setRangeValue(inputId, valueId, value) {
  const input = document.getElementById(inputId);
  const valueEl = document.getElementById(valueId);
  if (input) {
    input.value = value;
    if (valueEl) valueEl.textContent = value;
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const pct = ((value - min) / (max - min)) * 100;
    input.style.setProperty('--range-fill', `${pct}%`);
  }
}

async function saveSettings() {
  const current = settingsStore.get();
  
  const getChecked = (id) => {
    const el = document.getElementById(id);
    return el ? el.checked : current[id.replace('setting-', '').replace(/-/g, '_')];
  };
  const getVal = (id) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : current[id.replace('setting-', '').replace(/-/g, '_')];
  };

  const newSettings = {
    ...current,
    api_url: getVal('setting-api-url') || current.api_url,
    prompt_token_limit: parseInt(getVal('setting-prompt-token-limit')) || current.prompt_token_limit,
    thinking_enabled: getChecked('setting-thinking'),
    thinking_snippets: getChecked('setting-thinking-snippets'),
    memory_enabled: getChecked('setting-memory'),
    auto_translate: getChecked('setting-auto-translate'),
    translate_user_messages: getChecked('setting-translate-user'),
    italic_asterisks: getChecked('setting-italic-asterisks'),
    ai_comments_enabled: getChecked('setting-ai-comments'),
    suggestions_enabled: getChecked('setting-suggestions-enabled'),
    target_language: getVal('setting-target-lang'),
    outgoing_target_language: getVal('setting-outgoing-lang'),
    suggestions_language: getVal('setting-suggestions-lang'),
    ai_comments_language: getVal('setting-ai-comments-lang'),
    genai_response_length: getVal('setting-genai-response-length'),
    genai_speech_style: getVal('setting-genai-speech-style'),
    genai_safe_mode: getChecked('setting-genai-safe-mode'),
    game_prompt_presets: currentSettings.game_prompt_presets,
    active_game_prompt_preset_id: currentSettings.active_game_prompt_preset_id,
    game_system_prompt: getVal('setting-game-system-prompt') || 'You are a Game Master in an interactive text RPG.',
    game_response_length: getVal('setting-game-response-length') || 'default',
    font_size: parseInt(document.getElementById('setting-font-size')?.value || current.font_size),
  };

  await settingsStore.save(newSettings);

  // Apply font size
  document.documentElement.style.setProperty('--text-base', `${newSettings.font_size / 16}rem`);

  applyGlobalSettingsStyles();

  // Sync header thinking toggle
  const headerThinking = document.getElementById('thinking-toggle');
  if (headerThinking) headerThinking.checked = newSettings.thinking_enabled;

  showToast('Settings saved');
  checkConnection();
}

async function testConnection() {
  const urlEl = document.getElementById('setting-api-url');
  if (!urlEl) return;
  
  const url = urlEl.value.trim();
  const btn = document.getElementById('btn-test-connection');
  const existingResult = btn.parentElement.querySelector('.connection-result');
  if (existingResult) existingResult.remove();

  btn.textContent = 'Testing...';
  btn.disabled = true;

  const origSettings = settingsStore.get();
  settingsStore.update('api_url', url || origSettings.api_url);

  const resultEl = document.createElement('div');

  try {
    const connected = await api.checkConnection();
    if (connected) {
      const model = await api.getModel();
      resultEl.className = 'connection-result success';
      resultEl.textContent = `✓ Connected${model ? ` — Model: ${model}` : ''}`;
    } else {
      resultEl.className = 'connection-result error';
      resultEl.textContent = '✗ Could not connect to server';
    }
  } catch (err) {
    resultEl.className = 'connection-result error';
    resultEl.textContent = `✗ Error: ${err.message}`;
  }

  settingsStore.update('api_url', origSettings.api_url);

  btn.textContent = 'Test Connection';
  btn.disabled = false;
  btn.parentElement.appendChild(resultEl);
}

/* ─── Custom Vibe Dropdown Logic ────────────────────────────────── */

function initVibeDropdowns() {
  const dropdowns = document.querySelectorAll('.vibe-dropdown');
  
  dropdowns.forEach(dropdown => {
    const trigger = dropdown.querySelector('.vibe-dropdown-trigger');
    const menu = dropdown.querySelector('.vibe-dropdown-menu');
    const hiddenSelect = dropdown.querySelector('select');
    
    if (!trigger || !menu || !hiddenSelect) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close others
      document.querySelectorAll('.vibe-dropdown.open').forEach(d => {
        if (d !== dropdown) d.classList.remove('open');
      });
      dropdown.classList.toggle('open');
    });

    const items = menu.querySelectorAll('.vibe-dropdown-item');
    items.forEach(item => {
      item.addEventListener('click', () => {
        const val = item.dataset.value;
        const label = item.textContent;
        
        // Update trigger & select
        trigger.textContent = label;
        trigger.dataset.value = val;
        hiddenSelect.value = val;
        
        // Update selected class
        items.forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        
        dropdown.classList.remove('open');
        
        // Dispatch change event to hidden select so other listeners work
        hiddenSelect.dispatchEvent(new Event('change'));
      });
    });
  });

  // Close when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.vibe-dropdown.open').forEach(d => d.classList.remove('open'));
  });
}

function updateVibeDropdownTriggers() {
  const dropdowns = document.querySelectorAll('.vibe-dropdown');
  dropdowns.forEach(dropdown => {
    const trigger = dropdown.querySelector('.vibe-dropdown-trigger');
    const hiddenSelect = dropdown.querySelector('select');
    const menu = dropdown.querySelector('.vibe-dropdown-menu');
    
    if (trigger && hiddenSelect) {
      const currentVal = hiddenSelect.value;
      const matchingItem = Array.from(dropdown.querySelectorAll('.vibe-dropdown-item'))
        .find(i => i.dataset.value === currentVal);
      
      if (matchingItem) {
        trigger.textContent = matchingItem.textContent;
        trigger.dataset.value = currentVal;
        
        // Sync selected class in menu
        dropdown.querySelectorAll('.vibe-dropdown-item').forEach(i => {
          i.classList.toggle('selected', i === matchingItem);
        });
      }
    }
  });
}

function renderGamePresets() {
  const presetsList = document.getElementById('game-presets-list');
  if (!presetsList) return;
  presetsList.innerHTML = '';
  
  if (!currentSettings || !currentSettings.game_prompt_presets) return;

  currentSettings.game_prompt_presets.forEach(preset => {
    const item = document.createElement('div');
    item.className = `preset-item ${preset.id === editingGamePresetId ? 'active' : ''}`;
    item.dataset.id = preset.id;

    const isDefault = preset.id.startsWith('default-game-');

    item.innerHTML = `
      <span class="preset-item-name">${preset.name}</span>
      ${!isDefault ? `
        <button class="btn-delete-preset btn-icon" title="Delete preset" style="background: none; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      ` : ''}
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-preset')) {
        deleteGamePreset(preset.id);
        return;
      }
      selectGamePreset(preset.id);
    });

    presetsList.appendChild(item);
  });
}

function selectGamePreset(id) {
  editingGamePresetId = id;
  if (currentSettings) {
    currentSettings.active_game_prompt_preset_id = id;
    const preset = currentSettings.game_prompt_presets.find(p => p.id === id);
    if (preset) {
      const nameInput = document.getElementById('setting-game-preset-name');
      const promptInput = document.getElementById('setting-game-system-prompt');
      if (nameInput) {
        nameInput.value = preset.name;
        nameInput.disabled = id.startsWith('default-game-');
      }
      if (promptInput) {
        promptInput.value = preset.content;
        promptInput.disabled = id.startsWith('default-game-');
      }
    }
  }
  renderGamePresets();
}

function createNewGamePreset() {
  if (!currentSettings) return;
  const id = 'custom-game-' + Date.now();
  const newPreset = {
    id,
    name: 'New GM Preset',
    content: "You are a Game Master in an interactive text RPG."
  };
  currentSettings.game_prompt_presets.push(newPreset);
  selectGamePreset(id);
}

function deleteGamePreset(id) {
  if (id.startsWith('default-game-') || !currentSettings) return;
  const confirmDel = confirm('Are you sure you want to delete this preset?');
  if (confirmDel) {
    currentSettings.game_prompt_presets = currentSettings.game_prompt_presets.filter(p => p.id !== id);
    if (editingGamePresetId === id) {
      selectGamePreset(currentSettings.game_prompt_presets[0].id);
    } else {
      renderGamePresets();
    }
  }
}

function updateEditingGamePreset() {
  if (!currentSettings) return;
  const nameInput = document.getElementById('setting-game-preset-name');
  const promptInput = document.getElementById('setting-game-system-prompt');
  const preset = currentSettings.game_prompt_presets.find(p => p.id === editingGamePresetId);
  if (preset && !editingGamePresetId.startsWith('default-game-')) {
    if (nameInput) preset.name = nameInput.value;
    if (promptInput) preset.content = promptInput.value;
    renderGamePresets(); // update names dynamically
  } else if (preset && editingGamePresetId.startsWith('default-game-')) {
    // Revert edits for default ones to avoid visual desync
    if (nameInput) nameInput.value = preset.name;
    if (promptInput) promptInput.value = preset.content;
  }
}
