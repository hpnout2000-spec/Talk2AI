/* ════════════════════════════════════════════════════════════════════
   Advanced Settings Component — System Prompt & Generation
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from '../services/settings-store.js';
import { showToast, showConfirm, closeModal, openWindow, closeWindow } from '../main.js';

let modal;
let btnClose;
let btnSave;
let navItems;
let tabContents;
let presetsList;
let presetNameInput;
let presetContentInput;
let btnAddPreset;
let aiCommentsPromptInput;

let currentSettings;
let editingPresetId = null;

export function initAdvancedSettings() {
  modal = document.getElementById('advanced-settings-modal');
  btnClose = modal.querySelector('.btn-close-advanced');
  btnSave = document.getElementById('btn-save-advanced');
  navItems = modal.querySelectorAll('.nav-item');
  tabContents = modal.querySelectorAll('.tab-content');
  presetsList = document.getElementById('presets-list');
  presetNameInput = document.getElementById('preset-name');
  presetContentInput = document.getElementById('preset-content');
  btnAddPreset = document.getElementById('btn-add-preset');
  aiCommentsPromptInput = document.getElementById('adv-ai-comments-prompt');

  // Listen for open event
  window.addEventListener('open-advanced-settings', openModal);

  btnClose.addEventListener('click', () => closeWindow(modal));
  btnSave.addEventListener('click', saveAll);

  // Tab switching
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.dataset.tab;
      
      if (tabId === 'ai-comments' && !settingsStore.get().ai_comments_enabled) {
        import('../main.js').then(({ showCustomConfirm }) => {
          showCustomConfirm('AI Comments Disabled', 'AI Comments are currently disabled. Would you like to enable them?', ['Cancel', 'Go to Settings', 'Enable']).then(async res => {
            if (res === 'Enable') {
              await settingsStore.save({ ...settingsStore.get(), ai_comments_enabled: true });
              item.style.opacity = '1';
              // Update toggle in general settings if open
              const toggle = document.getElementById('setting-ai-comments');
              if (toggle) toggle.checked = true;
              switchToTab(tabId);
            } else if (res === 'Go to Settings') {
              import('../main.js').then(({ closeModal }) => {
                closeModal(modal);
                document.getElementById('btn-settings').click();
              });
            }
          });
        });
        return;
      }
      
      switchToTab(tabId);
    });
  });

  function switchToTab(tabId) {
    navItems.forEach(nav => nav.classList.remove('active'));
    tabContents.forEach(tab => tab.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    if (activeNav) activeNav.classList.add('active');
    const activeTab = document.getElementById(`tab-${tabId}`);
    if (activeTab) activeTab.classList.add('active');
  }

  // Preset management
  btnAddPreset.addEventListener('click', createNewPreset);

  // Generation setting sync
  setupRangeInput('adv-setting-max-tokens', 'adv-max-tokens-value');
  setupRangeInput('adv-setting-temperature', 'adv-temperature-value');
  setupRangeInput('adv-setting-top-p', 'adv-top-p-value');
  setupRangeInput('adv-setting-top-k', 'adv-top-k-value');
  setupRangeInput('adv-setting-rep-penalty', 'adv-rep-penalty-value');

  // Live save for preset editor
  presetNameInput.addEventListener('input', updateEditingPreset);
  presetContentInput.addEventListener('input', updateEditingPreset);

  // Reset AI comments prompt
  const btnResetAiComments = document.getElementById('btn-reset-ai-comments-prompt');
  if (btnResetAiComments) {
    btnResetAiComments.addEventListener('click', () => {
      const defaultPrompt = "Comment on the last action, dialogue, or behavior of the character or user. Be concise, witty, and insightful. Return only the comment itself. use many emojis.";
      if (aiCommentsPromptInput) {
        aiCommentsPromptInput.value = defaultPrompt;
        showToast('Default prompt restored');
      }
    });
  }
}

function openModal() {
  currentSettings = settingsStore.get();
  loadSettingsToUI();
  
  const aiCommentsTabBtn = document.getElementById('nav-tab-ai-comments');
  if (aiCommentsTabBtn) {
    aiCommentsTabBtn.style.opacity = currentSettings.ai_comments_enabled ? '1' : '0.5';
  }
  
  openWindow(modal);
}

function loadSettingsToUI() {
  // Load generation settings
  setRangeValue('adv-setting-max-tokens', 'adv-max-tokens-value', currentSettings.max_tokens);
  setRangeValue('adv-setting-temperature', 'adv-temperature-value', currentSettings.temperature);
  setRangeValue('adv-setting-top-p', 'adv-top-p-value', currentSettings.top_p);
  setRangeValue('adv-setting-top-k', 'adv-top-k-value', currentSettings.top_k);
  setRangeValue('adv-setting-rep-penalty', 'adv-rep-penalty-value', currentSettings.rep_penalty);

  if (aiCommentsPromptInput) {
    aiCommentsPromptInput.value = currentSettings.ai_comments_prompt || "";
  }
  
  const historyToggle = document.getElementById('setting-ai-comments-history');
  if (historyToggle) {
    historyToggle.checked = !!currentSettings.ai_comments_history_enabled;
  }

  // Load presets
  renderPresets();

  // Select active preset
  editingPresetId = currentSettings.active_system_prompt_preset_id;
  const preset = currentSettings.system_prompt_presets.find(p => p.id === editingPresetId);
  if (preset) {
    presetNameInput.value = preset.name;
    presetContentInput.value = preset.content;
    
    // Disable editing for default presets
    const isDefault = editingPresetId.startsWith('default-');
    presetNameInput.disabled = isDefault;
    presetContentInput.disabled = isDefault;
  }
}

function renderPresets() {
  presetsList.innerHTML = '';
  currentSettings.system_prompt_presets.forEach(preset => {
    const item = document.createElement('div');
    item.className = `preset-item ${preset.id === editingPresetId ? 'active' : ''}`;
    item.dataset.id = preset.id;

    const isDefault = preset.id.startsWith('default-');

    item.innerHTML = `
      <span class="preset-item-name">${preset.name}</span>
      ${!isDefault ? `
        <button class="btn-delete-preset btn-icon" title="Delete preset">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      ` : ''}
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-preset')) {
        deletePreset(preset.id);
        return;
      }
      selectPreset(preset.id);
    });

    presetsList.appendChild(item);
  });
}

function selectPreset(id) {
  editingPresetId = id;
  currentSettings.active_system_prompt_preset_id = id;
  const preset = currentSettings.system_prompt_presets.find(p => p.id === id);
  if (preset) {
    presetNameInput.value = preset.name;
    presetContentInput.value = preset.content;

    const isDefault = id.startsWith('default-');
    presetNameInput.disabled = isDefault;
    presetContentInput.disabled = isDefault;
  }
  renderPresets();
}

function createNewPreset() {
  const id = 'custom-' + Date.now();
  const newPreset = {
    id,
    name: 'New Preset',
    content: "Write {{char}}'s next reply..."
  };
  currentSettings.system_prompt_presets.push(newPreset);
  selectPreset(id);
}

async function deletePreset(id) {
  if (id.startsWith('default-')) return;

  const confirm = await showConfirm('Delete Preset', 'Are you sure you want to delete this preset?');
  if (confirm) {
    currentSettings.system_prompt_presets = currentSettings.system_prompt_presets.filter(p => p.id !== id);
    if (editingPresetId === id) {
      selectPreset(currentSettings.system_prompt_presets[0].id);
    } else {
      renderPresets();
    }
  }
}

function updateEditingPreset() {
  const preset = currentSettings.system_prompt_presets.find(p => p.id === editingPresetId);
  if (preset && !editingPresetId.startsWith('default-')) {
    preset.name = presetNameInput.value;
    preset.content = presetContentInput.value;
    renderPresets(); // Update name in list
  }
}

function setupRangeInput(inputId, valueId) {
  const input = document.getElementById(inputId);
  const valueEl = document.getElementById(valueId);
  if (!input || !valueEl) return;

  input.addEventListener('input', () => {
    valueEl.textContent = input.value;
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const val = parseFloat(input.value);
    const pct = ((val - min) / (max - min)) * 100;
    input.style.setProperty('--range-fill', `${pct}%`);
  });
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

async function saveAll() {
  const historyToggle = document.getElementById('setting-ai-comments-history');
  
  const updatedSettings = {
    ...currentSettings,
    max_tokens: parseInt(document.getElementById('adv-setting-max-tokens').value),
    temperature: parseFloat(document.getElementById('adv-setting-temperature').value),
    top_p: parseFloat(document.getElementById('adv-setting-top-p').value),
    top_k: parseInt(document.getElementById('adv-setting-top-k').value),
    rep_penalty: parseFloat(document.getElementById('adv-setting-rep-penalty').value),
    ai_comments_prompt: aiCommentsPromptInput ? aiCommentsPromptInput.value.trim() : currentSettings.ai_comments_prompt,
    ai_comments_history_enabled: historyToggle ? historyToggle.checked : currentSettings.ai_comments_history_enabled,
  };

  await settingsStore.save(updatedSettings);
  
  // Try to toggle the button visibility if chat is active
  const toggleBtn = document.getElementById('btn-toggle-ai-comments-sidebar');
  if (toggleBtn) {
    if (updatedSettings.ai_comments_history_enabled) {
      toggleBtn.classList.remove('hidden');
    } else {
      toggleBtn.classList.add('hidden');
      const sidebar = document.getElementById('ai-comments-sidebar');
      if (sidebar) sidebar.classList.add('hidden');
      toggleBtn.classList.remove('open');
    }
  }
  
  // Sync sidebar settings if it's open (though generation is removed, other sync might be needed)
  window.dispatchEvent(new CustomEvent('settings-updated'));
  
  closeWindow(modal);
  showToast('Advanced settings saved');
}
