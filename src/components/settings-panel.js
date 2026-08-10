/* ════════════════════════════════════════════════════════════════════
   Settings Panel — Configuration UI
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from '../services/settings-store.js';
import { showToast, checkConnection, applyGlobalSettingsStyles, openWindow, closeWindow } from '../main.js';
import { api } from '../services/api.js';
import { checkComfyUIConnection } from '../services/comfyui-service.js';
import { localSyncService } from '../services/local-sync-service.js';
import { escapeHtml } from '../utils/helpers.js';

let currentSettings = {};
let editingGamePresetId = null;
let editingLoras = [];

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
    { id: 'card-game', modalId: 'modal-settings-game' },
    { id: 'card-imagegen', modalId: 'modal-settings-imagegen' },
    { id: 'card-storage', modalId: 'modal-settings-storage' }
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

  const gemmaSupportEl = document.getElementById('setting-gemma4-support');
  if (gemmaSupportEl) {
    gemmaSupportEl.addEventListener('change', updateGemmaSubsettingsState);
  }

  // Range inputs: show values in real-time
  setupRangeInput('setting-font-size', 'font-size-value', v => v);
  setupRangeInput('adv-setting-max-tokens', 'adv-max-tokens-value', v => v);
  setupRangeInput('adv-setting-temperature', 'adv-temperature-value', v => parseFloat(v).toFixed(2));
  setupRangeInput('adv-setting-top-p', 'adv-top-p-value', v => parseFloat(v).toFixed(2));
  setupRangeInput('adv-setting-top-k', 'adv-top-k-value', v => v);
  setupRangeInput('adv-setting-rep-penalty', 'adv-rep-penalty-value', v => parseFloat(v).toFixed(2));
  setupRangeInput('setting-music-volume', 'music-volume-value', v => v + '%');

  const syncToggles = [];

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
  initImageGenSettings();
  initLocalNetworkSection();

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

function updateGemmaSubsettingsState() {
  const gemmaSupportEl = document.getElementById('setting-gemma4-support');
  const subsettings = [
    document.getElementById('setting-change-gemma4-thinking-style'),
    document.getElementById('setting-gemma4-google-thinking-preset')
  ];
  if (gemmaSupportEl) {
    const isEnabled = gemmaSupportEl.checked;
    subsettings.forEach(el => {
      if (el) {
        el.disabled = !isEnabled;
        const row = el.closest('.form-group-row');
        if (row) {
          if (isEnabled) {
            row.style.opacity = '1';
            row.style.pointerEvents = 'auto';
          } else {
            row.style.opacity = '0.5';
            row.style.pointerEvents = 'none';
          }
        }
      }
    });
  }
}

function loadSettingsToUI() {
  const settings = settingsStore.get();

  const btnOpenGenaiAdvanced = document.getElementById('btn-open-genai-advanced-settings');
  if (btnOpenGenaiAdvanced) {
    btnOpenGenaiAdvanced.addEventListener('click', () => {
      import('../main.js').then(({ closeModal }) => {
        closeModal(document.getElementById('settings-modal'));
        window.dispatchEvent(new CustomEvent('open-advanced-settings'));
        setTimeout(() => {
          const genaiTabBtn = document.querySelector('.nav-item[data-tab="genai-generation"]');
          if (genaiTabBtn) genaiTabBtn.click();
        }, 50);
      });
    });
  }

  const apiUrlInput = document.getElementById('setting-api-url');
  if (apiUrlInput) apiUrlInput.value = settings.api_url;

  const apiNinjasKeyInput = document.getElementById('setting-apininjas-key');
  if (apiNinjasKeyInput) apiNinjasKeyInput.value = settings.apininjas_key || '';

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

  setRangeValue('adv-setting-max-tokens', 'adv-max-tokens-value', settings.max_tokens);
  setRangeValue('adv-setting-temperature', 'adv-temperature-value', settings.temperature?.toFixed(2));
  setRangeValue('adv-setting-top-p', 'adv-top-p-value', settings.top_p?.toFixed(2));
  setRangeValue('adv-setting-top-k', 'adv-top-k-value', settings.top_k);
  setRangeValue('adv-setting-rep-penalty', 'adv-rep-penalty-value', settings.rep_penalty?.toFixed(2));
  checkField('setting-memory', settings.memory_enabled);
  checkField('setting-auto-naming', settings.auto_naming_enabled);
  checkField('setting-gemma4-support', settings.gemma4_support);
  checkField('setting-change-gemma4-thinking-style', settings.change_gemma4_thinking_style);
  checkField('setting-gemma4-google-thinking-preset', settings.gemma4_google_thinking_preset !== false);
  checkField('setting-glm47-support', settings.glm47_support);
  checkField('setting-qwen35-thinking-support', settings.qwen35_thinking_support);
  checkField('setting-legacy-jinja-support', settings.legacy_jinja_support);
  checkField('setting-jinja-adaptive-thinking', settings.jinja_adaptive_thinking);
  checkField('setting-auto-translate', settings.auto_translate);
  checkField('setting-translate-user', settings.translate_user_messages);
  checkField('setting-italic-asterisks', settings.italic_asterisks);
  checkField('setting-new-streaming-animation', settings.new_streaming_animation);
  checkField('setting-advanced-animations-blur', settings.advanced_animations_blur);
  setRangeValue('setting-streaming-speed', 'streaming-speed-value', settings.streaming_speed || 45);
  checkField('setting-ai-comments', settings.ai_comments_enabled);
  checkField('setting-suggestions-enabled', settings.suggestions_enabled);
  setField('setting-example-messages-mode', settings.example_messages_mode || 'chat');
  
  setField('setting-target-lang', settings.target_language || 'Russian');
  setField('setting-outgoing-lang', settings.outgoing_target_language || 'English');
  setField('setting-suggestions-lang', settings.suggestions_language || 'Russian');
  setField('setting-ai-comments-lang', settings.ai_comments_language || 'Auto');
  setField('setting-summary-chunk-size', settings.summary_chunk_size || 10);
  
  setField('setting-genai-response-length', settings.genai_response_length || 'default');
  setField('setting-genai-speech-style', settings.genai_speech_style || 'default');
  setField('setting-genai-emoji-preferences', settings.genai_emoji_preferences || 'default');
  setField('setting-genai-assent', settings.genai_assent || 'default');
  const speechStyleDropdown = document.getElementById('setting-genai-speech-style');
  checkField('setting-genai-duo-suggestions', settings.genai_duo_suggestions !== false);
  checkField('setting-genai-safe-mode', settings.genai_safe_mode);
  checkField('setting-genai-viewimage-enabled', settings.genai_viewimage_enabled === true);
  checkField('setting-genai-imagered-enabled', settings.genai_imagered_enabled !== false);
  checkField('setting-genai-faster-actions', settings.genai_faster_actions === true);

  // Image Gen settings
  checkField('setting-comfyui-enabled', settings.comfyui_enabled);
  checkField('setting-comfyui-auto-chat', settings.comfyui_auto_chat);
  checkField('setting-comfyui-auto-scale', settings.comfyui_auto_scale);
  checkField('setting-comfyui-better-prompts', settings.comfyui_better_prompts);
  setField('setting-comfyui-reasoning-effort', settings.comfyui_reasoning_effort || 'none');
  setField('setting-comfyui-url', settings.comfyui_url || 'http://localhost:8188');
  setField('setting-comfyui-neg-prompt', settings.comfyui_negative_prompt || '');
  setField('setting-comfyui-sampler', settings.comfyui_sampler || 'euler');
  setField('setting-comfyui-scheduler', settings.comfyui_scheduler || 'normal');
  setField('setting-comfyui-unet', settings.comfyui_unet_name || 'anima_baseV10.safetensors');
  setField('setting-comfyui-clip', settings.comfyui_clip_name || 'qwen_3_06b_base.safetensors');
  setField('setting-comfyui-vae', settings.comfyui_vae_name || 'qwen_image_vae.safetensors');
  setRangeValue('setting-comfyui-steps', 'comfyui-steps-val', settings.comfyui_steps ?? 30);
  setRangeValue('setting-comfyui-cfg', 'comfyui-cfg-val', parseFloat(settings.comfyui_cfg ?? 4.5).toFixed(1));
  const wEl = document.getElementById('setting-comfyui-width');
  const hEl = document.getElementById('setting-comfyui-height');
  if (wEl) wEl.value = settings.comfyui_width ?? 832;
  if (hEl) hEl.value = settings.comfyui_height ?? 1216;
  _updateResolutionButtons(settings.comfyui_width ?? 832, settings.comfyui_height ?? 1216);

  editingLoras = JSON.parse(JSON.stringify(settings.comfyui_loras || []));
  if (typeof renderLorasList === 'function') renderLorasList();

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
  updateGemmaSubsettingsState();
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
    apininjas_key: getVal('setting-apininjas-key'),
    prompt_token_limit: parseInt(getVal('setting-prompt-token-limit')) || current.prompt_token_limit,
    memory_enabled: getChecked('setting-memory'),
    auto_naming_enabled: getChecked('setting-auto-naming'),
    example_messages_mode: getVal('setting-example-messages-mode') || 'chat',
    gemma4_support: getChecked('setting-gemma4-support'),
    change_gemma4_thinking_style: getChecked('setting-change-gemma4-thinking-style'),
    gemma4_google_thinking_preset: getChecked('setting-gemma4-google-thinking-preset'),
    glm47_support: getChecked('setting-glm47-support'),
    qwen35_thinking_support: getChecked('setting-qwen35-thinking-support'),
    legacy_jinja_support: getChecked('setting-legacy-jinja-support'),
    jinja_adaptive_thinking: getChecked('setting-jinja-adaptive-thinking'),
    auto_translate: getChecked('setting-auto-translate'),
    translate_user_messages: getChecked('setting-translate-user'),
    italic_asterisks: getChecked('setting-italic-asterisks'),
    new_streaming_animation: getChecked('setting-new-streaming-animation'),
    advanced_animations_blur: getChecked('setting-advanced-animations-blur'),
    streaming_speed: parseFloat(document.getElementById('setting-streaming-speed')?.value || 45),
    ai_comments_enabled: getChecked('setting-ai-comments'),
    suggestions_enabled: getChecked('setting-suggestions-enabled'),
    target_language: getVal('setting-target-lang'),
    outgoing_target_language: getVal('setting-outgoing-lang'),
    suggestions_language: getVal('setting-suggestions-lang'),
    ai_comments_language: getVal('setting-ai-comments-lang'),
    summary_chunk_size: parseInt(getVal('setting-summary-chunk-size')) || 10,
    genai_response_length: getVal('setting-genai-response-length'),
    genai_speech_style: getVal('setting-genai-speech-style'),
    genai_emoji_preferences: getVal('setting-genai-emoji-preferences'),
    genai_assent: getVal('setting-genai-assent'),
    genai_duo_suggestions: getChecked('setting-genai-duo-suggestions'),
    genai_safe_mode: getChecked('setting-genai-safe-mode'),
    genai_viewimage_enabled: getChecked('setting-genai-viewimage-enabled'),
    genai_imagered_enabled: getChecked('setting-genai-imagered-enabled'),
    genai_faster_actions: getChecked('setting-genai-faster-actions'),
    game_prompt_presets: currentSettings.game_prompt_presets,
    active_game_prompt_preset_id: currentSettings.active_game_prompt_preset_id,
    game_system_prompt: getVal('setting-game-system-prompt') || 'You are a Game Master in an interactive text RPG.',
    game_response_length: getVal('setting-game-response-length') || 'default',
    font_size: parseInt(document.getElementById('setting-font-size')?.value || current.font_size),
    comfyui_enabled: getChecked('setting-comfyui-enabled'),
    comfyui_auto_chat: getChecked('setting-comfyui-auto-chat'),
    comfyui_auto_scale: getChecked('setting-comfyui-auto-scale'),
    comfyui_better_prompts: getChecked('setting-comfyui-better-prompts'),
    comfyui_reasoning_effort: getVal('setting-comfyui-reasoning-effort') || 'none',
    comfyui_url: getVal('setting-comfyui-url') || current.comfyui_url,
    comfyui_steps: parseInt(document.getElementById('setting-comfyui-steps')?.value || current.comfyui_steps),
    comfyui_cfg: parseFloat(document.getElementById('setting-comfyui-cfg')?.value || current.comfyui_cfg),
    comfyui_width: parseInt(document.getElementById('setting-comfyui-width')?.value || current.comfyui_width),
    comfyui_height: parseInt(document.getElementById('setting-comfyui-height')?.value || current.comfyui_height),
    comfyui_negative_prompt: getVal('setting-comfyui-neg-prompt') || current.comfyui_negative_prompt,
    comfyui_sampler: getVal('setting-comfyui-sampler') || current.comfyui_sampler,
    comfyui_scheduler: getVal('setting-comfyui-scheduler') || current.comfyui_scheduler,
    comfyui_unet_name: getVal('setting-comfyui-unet') || current.comfyui_unet_name,
    comfyui_clip_name: getVal('setting-comfyui-clip') || current.comfyui_clip_name,
    comfyui_vae_name: getVal('setting-comfyui-vae') || current.comfyui_vae_name,
    comfyui_loras: editingLoras
  };

  await settingsStore.save(newSettings);

  if (window.refreshThinkingEffortUI) window.refreshThinkingEffortUI();
  if (window.refreshGenAIThinkingEffortUI) window.refreshGenAIThinkingEffortUI();
  if (window.updateReasoningUI) window.updateReasoningUI();

  if (window.updateContextIndicator) {
    window.updateContextIndicator();
  }

  // Apply font size
  document.documentElement.style.setProperty('--text-base', `${newSettings.font_size / 16}rem`);

  applyGlobalSettingsStyles();

  showToast('Settings saved');
  checkConnection();
  // Sync image gen indicators after save
  if (window.syncImageGenIndicators) window.syncImageGenIndicators();
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

function initImageGenSettings() {
  // Slider listeners
  const stepsEl = document.getElementById('setting-comfyui-steps');
  const stepsVal = document.getElementById('comfyui-steps-val');
  if (stepsEl) {
    stepsEl.addEventListener('input', () => {
      if (stepsVal) stepsVal.textContent = stepsEl.value;
      const min = parseFloat(stepsEl.min);
      const max = parseFloat(stepsEl.max);
      const val = parseFloat(stepsEl.value);
      const pct = ((val - min) / (max - min)) * 100;
      stepsEl.style.setProperty('--range-fill', `${pct}%`);
    });
  }

  const cfgEl = document.getElementById('setting-comfyui-cfg');
  const cfgVal = document.getElementById('comfyui-cfg-val');
  if (cfgEl) {
    cfgEl.addEventListener('input', () => {
      if (cfgVal) cfgVal.textContent = parseFloat(cfgEl.value).toFixed(1);
      const min = parseFloat(cfgEl.min);
      const max = parseFloat(cfgEl.max);
      const val = parseFloat(cfgEl.value);
      const pct = ((val - min) / (max - min)) * 100;
      cfgEl.style.setProperty('--range-fill', `${pct}%`);
    });
  }

  // Resolution buttons listener
  const resButtons = document.querySelectorAll('.imagegen-res-btn');
  const wInput = document.getElementById('setting-comfyui-width');
  const hInput = document.getElementById('setting-comfyui-height');

  resButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const w = btn.dataset.w;
      const h = btn.dataset.h;
      if (wInput) wInput.value = w;
      if (hInput) hInput.value = h;
      _updateResolutionButtons(parseInt(w), parseInt(h));
    });
  });

  // Manual resolution inputs listener to sync buttons
  if (wInput) {
    wInput.addEventListener('input', () => {
      const w = parseInt(wInput.value) || 0;
      const h = parseInt(hInput?.value) || 0;
      _updateResolutionButtons(w, h);
    });
  }
  if (hInput) {
    hInput.addEventListener('input', () => {
      const w = parseInt(wInput?.value) || 0;
      const h = parseInt(hInput.value) || 0;
      _updateResolutionButtons(w, h);
    });
  }

  // ComfyUI Test connection button
  const btnTestComfy = document.getElementById('btn-test-comfyui');
  const comfyuiUrlInput = document.getElementById('setting-comfyui-url');
  const connectionResult = document.getElementById('comfyui-connection-result');

  if (btnTestComfy) {
    btnTestComfy.addEventListener('click', async () => {
      const url = comfyuiUrlInput ? comfyuiUrlInput.value.trim() : 'http://localhost:8188';
      btnTestComfy.textContent = 'Testing...';
      btnTestComfy.disabled = true;
      if (connectionResult) {
        connectionResult.className = '';
        connectionResult.textContent = '';
      }

      try {
        const isOk = await checkComfyUIConnection(url);
        if (isOk) {
          if (connectionResult) {
            connectionResult.className = 'connection-result success';
            connectionResult.style.color = 'var(--success)';
            connectionResult.textContent = '✓ Connected successfully to ComfyUI!';
          }
          showToast('ComfyUI connected!');
        } else {
          if (connectionResult) {
            connectionResult.className = 'connection-result error';
            connectionResult.style.color = 'var(--error)';
            connectionResult.innerHTML = '✗ Connection failed. Is ComfyUI running?<br><span style="font-size:11px;opacity:0.8;display:block;margin-top:4px;">Note: You must start ComfyUI with CORS allowed. Add <strong>--enable-cors-header "*"</strong> to your startup command/bat file.</span>';
          }
          showToast('ComfyUI connection failed', 'error');
        }
      } catch (err) {
        if (connectionResult) {
          connectionResult.className = 'connection-result error';
          connectionResult.style.color = 'var(--error)';
          connectionResult.textContent = `✗ Error: ${err.message}`;
        }
        showToast('Error testing connection', 'error');
      } finally {
        btnTestComfy.textContent = 'Test';
        btnTestComfy.disabled = false;
      }
    });
  }

  // ComfyUI Nodes Install handler — WAS Node Suite (Revised) by ltdrdata
  const btnInstallNodes = document.getElementById('btn-install-comfyui-nodes');
  const installResult = document.getElementById('comfyui-install-result');

  if (btnInstallNodes) {
    btnInstallNodes.addEventListener('click', async () => {
      const urlEl = document.getElementById('setting-comfyui-url');
      const url = urlEl ? urlEl.value.trim() : 'http://localhost:8188';
      const baseUrl = url.replace(/\/$/, '');

      btnInstallNodes.disabled = true;
      btnInstallNodes.textContent = 'Installing...';
      if (installResult) {
        installResult.className = '';
        installResult.style.color = 'var(--text-secondary)';
        installResult.textContent = 'Sending install request to ComfyUI Manager...';
      }

      // WAS Node Suite (Revised) — maintained fork by ltdrdata
      const WAS_REVISED_URL = 'https://github.com/ltdrdata/was-node-suite-comfyui';

      try {
        let response = await fetch(`${baseUrl}/customnode/install`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: WAS_REVISED_URL })
        }).catch(() => null);

        if (!response || !response.ok) {
          response = await fetch(`${baseUrl}/customnode/install`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customnode_url: WAS_REVISED_URL })
          }).catch(() => null);
        }

        if (response && response.ok) {
          if (installResult) {
            installResult.style.color = 'var(--success)';
            installResult.innerHTML = '✓ Install command sent! Check your ComfyUI console. <b>Restart ComfyUI</b> when finished.';
          }
          showToast('WAS Node Suite (Revised) install sent!');
        } else {
          throw new Error('ComfyUI Manager API not found or failed');
        }
      } catch (err) {
        console.error(err);
        if (installResult) {
          installResult.style.color = 'var(--error)';
          installResult.innerHTML = `✗ Automatic install failed. Install <b>WAS Node Suite (Revised)</b> manually via ComfyUI Manager (<a href="https://github.com/ltdrdata/was-node-suite-comfyui" target="_blank" style="color:var(--accent-primary)">ltdrdata/was-node-suite-comfyui</a>).`;
        }
      } finally {
        btnInstallNodes.textContent = 'Install Nodes';
        btnInstallNodes.disabled = false;
      }
    });
  }

  // ComfyUI Save button handler
  const btnSaveComfy = document.getElementById('btn-save-imagegen-settings');
  if (btnSaveComfy) {
    btnSaveComfy.addEventListener('click', async () => {
      await saveSettings();
      closeWindow('modal-settings-imagegen');
    });
  }

  // --- Lora Logic ---
  const loraHeader = document.getElementById('setting-comfyui-lora-header');
  const loraContainer = document.getElementById('setting-comfyui-lora-container');
  const loraChevron = document.getElementById('setting-comfyui-lora-chevron');
  if (loraHeader && loraContainer && loraChevron) {
    loraHeader.addEventListener('click', () => {
      loraContainer.classList.toggle('hidden');
      if (loraContainer.classList.contains('hidden')) {
        loraChevron.style.transform = 'rotate(0deg)';
      } else {
        loraChevron.style.transform = 'rotate(180deg)';
      }
    });
  }

  const btnAddLora = document.getElementById('btn-add-comfyui-lora');
  const inputLora = document.getElementById('setting-comfyui-lora-input');
  if (btnAddLora && inputLora) {
    btnAddLora.addEventListener('click', () => {
      const name = inputLora.value.trim();
      if (!name) return;
      if (editingLoras.some(l => l.name === name)) {
        showToast('Lora already exists', 'warning');
        return;
      }
      editingLoras.push({
        name: name,
        enabled: true,
        strength: 1.0,
        force: false,
        comment: ''
      });
      inputLora.value = '';
      _persistLoras();
      renderLorasList();
      setTimeout(() => {
        const container = document.getElementById('comfyui-loras-list');
        if (container) {
          container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        }
      }, 50);
    });
    inputLora.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnAddLora.click();
    });
  }
}

/** Persist current editingLoras to settingsStore immediately */
function _persistLoras() {
  const current = settingsStore.get();
  settingsStore.save({ ...current, comfyui_loras: editingLoras });
}

export function renderLorasList() {
  const container = document.getElementById('comfyui-loras-list');
  if (!container) return;
  container.innerHTML = '';
  
  if (editingLoras.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'text-align:center;padding:16px 8px;color:var(--text-tertiary);font-size:12px;';
    emptyMsg.textContent = 'No Loras added yet. Type a name above and click Add.';
    container.appendChild(emptyMsg);
    return;
  }
  
  editingLoras.forEach((lora, index) => {
    const item = document.createElement('div');
    item.className = `lora-item ${lora.enabled ? 'enabled' : ''}`;
    
    // ── Header ──
    const header = document.createElement('div');
    header.className = 'lora-item-header';
    
    // Left side: toggle + name
    const leftHeader = document.createElement('div');
    leftHeader.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;flex:1;';
    
    // Small toggle switch for enabled
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle-switch tiny';
    toggleLabel.style.cssText = 'flex-shrink:0;cursor:pointer;';
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = lora.enabled;
    toggleInput.addEventListener('click', (e) => {
      e.stopPropagation();
      editingLoras[index].enabled = toggleInput.checked;
      _persistLoras();
      renderLorasList();
    });
    const toggleSlider = document.createElement('span');
    toggleSlider.className = 'toggle-slider';
    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(toggleSlider);
    
    const title = document.createElement('span');
    title.textContent = lora.name;
    title.style.cssText = `font-weight:500;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${lora.enabled ? 'var(--text-primary)' : 'var(--text-tertiary)'};`;
    
    leftHeader.appendChild(toggleLabel);
    leftHeader.appendChild(title);
    
    // Right side: strength badge + force indicator + delete
    const rightHeader = document.createElement('div');
    rightHeader.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;';
    
    if (lora.force) {
      const forceBadge = document.createElement('span');
      forceBadge.textContent = 'FORCE';
      forceBadge.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:0.05em;color:var(--warning);background:rgba(234,179,8,0.12);padding:2px 5px;border-radius:3px;';
      rightHeader.appendChild(forceBadge);
    }
    
    const strengthBadge = document.createElement('span');
    strengthBadge.textContent = lora.strength.toFixed(1);
    strengthBadge.style.cssText = 'font-size:11px;font-weight:600;color:var(--accent-primary);background:rgba(14,165,233,0.1);padding:2px 6px;border-radius:4px;font-variant-numeric:tabular-nums;min-width:28px;text-align:center;';
    
    const btnDel = document.createElement('button');
    btnDel.className = 'lora-btn-delete';
    btnDel.title = 'Delete Lora';
    btnDel.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    btnDel.addEventListener('click', (e) => {
      e.stopPropagation();
      editingLoras.splice(index, 1);
      _persistLoras();
      renderLorasList();
    });
    
    rightHeader.appendChild(strengthBadge);
    rightHeader.appendChild(btnDel);
    
    header.appendChild(leftHeader);
    header.appendChild(rightHeader);
    item.appendChild(header);
    
    // ── Collapsible Details ──
    const details = document.createElement('div');
    details.className = 'lora-item-details hidden';
    
    header.addEventListener('click', () => {
      details.classList.toggle('hidden');
      if (!details.classList.contains('hidden')) {
        setTimeout(() => {
          item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 50);
      }
    });
    
    // Strength slider row
    const sliderRow = document.createElement('div');
    sliderRow.className = 'lora-slider-row';
    
    const sliderLabel = document.createElement('label');
    sliderLabel.textContent = 'Strength';
    
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '-4';
    slider.max = '4';
    slider.step = '0.1';
    slider.value = lora.strength;
    slider.className = 'lora-slider';
    
    const sliderValue = document.createElement('span');
    sliderValue.className = 'lora-slider-value';
    sliderValue.textContent = lora.strength.toFixed(1);
    
    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      editingLoras[index].strength = val;
      sliderValue.textContent = val.toFixed(1);
      strengthBadge.textContent = val.toFixed(1);
    });
    slider.addEventListener('change', () => {
      _persistLoras();
    });
    
    sliderRow.appendChild(sliderLabel);
    sliderRow.appendChild(slider);
    sliderRow.appendChild(sliderValue);
    details.appendChild(sliderRow);
    
    // Force Lora checkbox
    const forceRow = document.createElement('div');
    forceRow.className = 'lora-force-row';
    const forceCheck = document.createElement('input');
    forceCheck.type = 'checkbox';
    forceCheck.checked = !!lora.force;
    forceCheck.id = `lora-force-${index}`;
    forceCheck.addEventListener('change', () => {
      editingLoras[index].force = forceCheck.checked;
      _persistLoras();
      renderLorasList();
    });
    const forceLabel = document.createElement('label');
    forceLabel.htmlFor = `lora-force-${index}`;
    forceLabel.textContent = 'Force Lora (always applied, AI cannot control)';
    forceRow.appendChild(forceCheck);
    forceRow.appendChild(forceLabel);
    details.appendChild(forceRow);
    
    // Comment textarea
    const commentArea = document.createElement('textarea');
    commentArea.placeholder = 'Comment for AI — describe what this Lora does (e.g. "makes images look like watercolor paintings")';
    commentArea.value = lora.comment || '';
    commentArea.rows = 2;
    commentArea.style.cssText = 'width:100%;padding:8px 10px;background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:6px;color:var(--text-primary);font-size:13px;resize:vertical;font-family:inherit;';
    commentArea.addEventListener('change', () => {
      editingLoras[index].comment = commentArea.value;
      _persistLoras();
    });
    details.appendChild(commentArea);
    
    item.appendChild(details);
    container.appendChild(item);
  });
}

function _updateResolutionButtons(w, h) {
  const resButtons = document.querySelectorAll('.imagegen-res-btn');
  resButtons.forEach(btn => {
    const btnW = parseInt(btn.dataset.w);
    const btnH = parseInt(btn.dataset.h);
    if (btnW === w && btnH === h) {
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-secondary');
    }
  });
}

/* ── Local Network Sync UI ──────────────────────────────────────────── */

function initLocalNetworkSection() {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) return; // Only in Tauri

  // ── Elements ────────────────────────────────────────────────────────
  const hostIpEl        = document.getElementById('local-net-host-ip');
  const keySection      = document.getElementById('local-net-key-section');
  const keyDisplay      = document.getElementById('local-net-key-display');
  const btnCopyKey      = document.getElementById('btn-copy-host-key');
  const hostStatusText  = document.getElementById('local-net-host-status-text');
  const btnStartHosting = document.getElementById('btn-start-hosting');
  const btnStopHosting  = document.getElementById('btn-stop-hosting');
  const hostCard        = document.getElementById('local-net-host-card');
  const devicesSection  = document.getElementById('local-net-devices-section');
  const devicesList     = document.getElementById('local-net-devices-list');

  const discoveryArea   = document.getElementById('local-net-discovery-area');
  const discoveryChips  = document.getElementById('local-net-discovery-chips');
  const hostAddrInput   = document.getElementById('local-net-host-addr');
  const clientKeyInput  = document.getElementById('local-net-client-key');
  const connectActions  = document.getElementById('local-net-connect-actions');
  const connectedActions= document.getElementById('local-net-connected-actions');
  const clientStatusText= document.getElementById('local-net-client-status-text');
  const btnDiscover     = document.getElementById('btn-discover-hosts');
  const btnConnect      = document.getElementById('btn-connect-to-host');
  const btnSyncNow      = document.getElementById('btn-sync-now');
  const btnDisconnect   = document.getElementById('btn-disconnect-host');
  const syncStatus      = document.getElementById('local-net-sync-status');
  const clientCard      = document.getElementById('local-net-client-card');

  if (!btnStartHosting) return; // HTML not present

  // ── Helpers ─────────────────────────────────────────────────────────

  function setSyncStatus(msg, cls = '') {
    if (!syncStatus) return;
    syncStatus.textContent = msg;
    syncStatus.className = 'sync-status-line' + (cls ? ' ' + cls : '');
  }

  let _devicesInterval = null;

  async function refreshDevicesList() {
    if (!devicesList) return;
    try {
      const devices = await invoke('get_allowed_devices');
      if (devices && devices.length > 0) {
        devicesList.innerHTML = '';
        devices.forEach(d => {
          const item = document.createElement('div');
          item.className = 'local-net-device-item';
          
          const lastSeenDate = new Date(d.last_seen);
          const lastSeenStr = isNaN(lastSeenDate.getTime()) ? 'never' : lastSeenDate.toLocaleTimeString();

          item.innerHTML = `
            <div class="device-info">
              <span class="device-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</span>
              <span class="device-meta">IP: ${d.ip || '—'} · Last seen: ${lastSeenStr}</span>
            </div>
            <div class="device-actions">
              <label class="device-toggle-label">
                <input type="checkbox" class="device-allow-checkbox" ${d.allowed_without_key ? 'checked' : ''} />
                <span>Allow without key</span>
              </label>
              <button class="btn-device-remove" title="Remove device">🗑️</button>
            </div>
          `;
          
          // Toggle auth status
          const checkbox = item.querySelector('.device-allow-checkbox');
          checkbox.addEventListener('change', async (e) => {
            try {
              await invoke('set_device_auth_status', { id: d.id, allowed_without_key: e.target.checked });
              showToast(`Device authorization updated.`);
            } catch (err) {
              showToast(`Failed to update device authorization: ${err}`, 'error');
              e.target.checked = !e.target.checked; // Revert
            }
          });

          // Remove device
          const removeBtn = item.querySelector('.btn-device-remove');
          removeBtn.addEventListener('click', async () => {
            if (confirm(`Are you sure you want to remove device "${d.name}"?`)) {
              try {
                await invoke('remove_allowed_device', { id: d.id });
                showToast(`Device removed.`);
                refreshDevicesList();
              } catch (err) {
                showToast(`Failed to remove device: ${err}`, 'error');
              }
            }
          });

          devicesList.appendChild(item);
        });
      } else {
        devicesList.innerHTML = '<div class="local-net-no-devices">No devices connected yet.</div>';
      }
    } catch (e) {
      console.warn('Failed to load allowed devices:', e);
    }
  }

  function updateHostUI(status) {
    if (!status) return;
    if (status.local_ip && hostIpEl) hostIpEl.textContent = status.local_ip;
    if (status.running) {
      // Hosting active
      if (keySection) keySection.style.display = '';
      if (devicesSection) devicesSection.style.display = 'block';
      // Show key without the copy button text
      const key = status.key || '????????';
      if (keyDisplay) {
        keyDisplay.childNodes[0].textContent = key + ' ';
      }
      if (hostStatusText) {
        const n = status.client_count || 0;
        hostStatusText.textContent = `Hosting · ${n} client${n !== 1 ? 's' : ''} connected`;
      }
      if (btnStartHosting) btnStartHosting.style.display = 'none';
      if (btnStopHosting)  btnStopHosting.style.display = '';
      if (hostCard) hostCard.classList.add('active');

      if (!_devicesInterval) {
        refreshDevicesList();
        _devicesInterval = setInterval(refreshDevicesList, 3000);
      }
    } else {
      if (keySection) keySection.style.display = 'none';
      if (devicesSection) devicesSection.style.display = 'none';
      if (btnStartHosting) btnStartHosting.style.display = '';
      if (btnStopHosting)  btnStopHosting.style.display = 'none';
      if (hostCard) hostCard.classList.remove('active');

      if (_devicesInterval) {
        clearInterval(_devicesInterval);
        _devicesInterval = null;
      }
    }
  }

  function updateClientUI() {
    if (localSyncService.isClientMode) {
      if (connectActions)   connectActions.style.display = 'none';
      if (connectedActions) connectedActions.style.display = '';
      if (clientCard) clientCard.classList.add('active');
      if (clientStatusText) {
        clientStatusText.textContent = `Connected to ${localSyncService.hostBaseUrl}`;
      }
    } else {
      if (connectActions)   connectActions.style.display = '';
      if (connectedActions) connectedActions.style.display = 'none';
      if (clientCard) clientCard.classList.remove('active');
    }
  }

  // ── Restore persisted connection state ──────────────────────────────
  const persisted = localSyncService.loadPersisted();
  if (persisted.ip && persisted.key) {
    if (hostAddrInput) hostAddrInput.value = `${persisted.ip}:${persisted.port}`;
    if (clientKeyInput) clientKeyInput.value = persisted.key;
  }
  if (localSyncService.isClientMode) updateClientUI();

  // ── Start status polling ─────────────────────────────────────────────
  localSyncService.startStatusPolling((status) => {
    updateHostUI(status);
  });

  // Also get initial host IP even if not hosting
  invoke('get_host_server_status').then(s => {
    if (s && s.local_ip && hostIpEl) hostIpEl.textContent = s.local_ip;
    updateHostUI(s);
  }).catch(() => {});

  // ── HOST: Start Hosting ──────────────────────────────────────────────
  if (btnStartHosting) {
    btnStartHosting.addEventListener('click', async () => {
      btnStartHosting.disabled = true;
      btnStartHosting.textContent = '⏳ Starting…';
      try {
        const result = await invoke('start_host_server');
        updateHostUI({ running: true, ...result, client_count: 0 });
        showToast('🌐 Hosting started! Share the key with other devices.');
      } catch (err) {
        showToast(`❌ Failed to start server: ${err}`, 'error');
      } finally {
        btnStartHosting.disabled = false;
        btnStartHosting.textContent = '▶ Start Hosting';
      }
    });
  }

  // ── HOST: Stop Hosting ───────────────────────────────────────────────
  if (btnStopHosting) {
    btnStopHosting.addEventListener('click', async () => {
      try {
        await invoke('stop_host_server');
        updateHostUI({ running: false });
        showToast('Hosting stopped.');
      } catch { /* ignore */ }
    });
  }

  // ── HOST: Copy Key ───────────────────────────────────────────────────
  if (btnCopyKey) {
    btnCopyKey.addEventListener('click', async () => {
      const status = await invoke('get_host_server_status').catch(() => null);
      if (status?.key) {
        try {
          await navigator.clipboard.writeText(status.key);
          showToast('Key copied to clipboard!');
        } catch {
          showToast('Copy failed — select and copy manually.');
        }
      }
    });
  }

  // ── CLIENT: Auto-Discover ────────────────────────────────────────────
  if (btnDiscover) {
    btnDiscover.addEventListener('click', async () => {
      btnDiscover.disabled = true;
      btnDiscover.textContent = '⏳ Scanning…';
      setSyncStatus('Scanning local network (4s)…', 'loading');
      discoveryArea.style.display = 'none';
      discoveryChips.innerHTML = '';

      try {
        const hosts = await invoke('discover_hosts');
        if (hosts && hosts.length > 0) {
          discoveryArea.style.display = '';
          hosts.forEach(h => {
            const chip = document.createElement('button');
            chip.className = 'discovery-chip';
            chip.textContent = `${h.host_name} (${h.ip})`;
            chip.addEventListener('click', () => {
              if (hostAddrInput) hostAddrInput.value = `${h.ip}:${h.port}`;
            });
            discoveryChips.appendChild(chip);
          });
          setSyncStatus(`Found ${hosts.length} host${hosts.length > 1 ? 's' : ''} — click to auto-fill`, 'success');
        } else {
          setSyncStatus('No hosts found. Make sure the host PC is running the app with Hosting active.', 'error');
        }
      } catch (err) {
        setSyncStatus(`Discovery error: ${err}`, 'error');
      } finally {
        btnDiscover.disabled = false;
        btnDiscover.textContent = '🔍 Discover';
      }
    });
  }

  // ── CLIENT: Connect ──────────────────────────────────────────────────
  if (btnConnect) {
    btnConnect.addEventListener('click', async () => {
      const addrRaw = (hostAddrInput?.value || '').trim();
      const key = (clientKeyInput?.value || '').trim().toUpperCase();
      if (!addrRaw) {
        setSyncStatus('Please enter host address.', 'error');
        return;
      }

      // Parse IP:port
      const parts = addrRaw.split(':');
      const ip   = parts[0].trim();
      const port = parseInt(parts[1] || '8765', 10);

      btnConnect.disabled = true;
      btnConnect.textContent = '⏳ Connecting…';
      setSyncStatus('Connecting…', 'loading');

      const result = await localSyncService.connectToHost(ip, port, key);
      if (result.ok) {
        setSyncStatus('✓ Connected! Click "Sync Now" to import host data.', 'success');
        updateClientUI();
        showToast('🔗 Connected to host via local network!');
      } else if (result.status === 'pending') {
        setSyncStatus('⏳ Approval required. Please authorize this device under "Paired / Pending Devices" on the Host PC settings.', 'loading');
      } else {
        setSyncStatus(`✗ ${result.error}`, 'error');
      }

      btnConnect.disabled = false;
      btnConnect.textContent = '🔗 Connect';
    });
  }

  // ── CLIENT: Sync Now ─────────────────────────────────────────────────
  if (btnSyncNow) {
    btnSyncNow.addEventListener('click', async () => {
      btnSyncNow.disabled = true;
      btnSyncNow.textContent = '⏳ Syncing…';
      setSyncStatus('Fetching data from host…', 'loading');

      const result = await localSyncService.syncFromHost();
      if (result.ok) {
        setSyncStatus('✓ Sync complete! Refresh app to see all data.', 'success');
        showToast('↻ Sync complete!');
        // Trigger app refresh
        window.dispatchEvent(new CustomEvent('local-sync-applied'));
      } else {
        setSyncStatus(`✗ Sync failed: ${result.error}`, 'error');
      }

      btnSyncNow.disabled = false;
      btnSyncNow.textContent = '↻ Sync Now';
    });
  }

  // ── CLIENT: Disconnect ───────────────────────────────────────────────
  if (btnDisconnect) {
    btnDisconnect.addEventListener('click', () => {
      localSyncService.disconnectFromHost();
      localSyncService.clearPersisted();
      updateClientUI();
      setSyncStatus('Disconnected. Using direct LLM connection.', '');
      showToast('🔌 Disconnected from host.');
      if (hostAddrInput) hostAddrInput.value = '';
      if (clientKeyInput) clientKeyInput.value = '';
    });
  }
}

