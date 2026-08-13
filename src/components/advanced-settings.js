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
let currentGenAIPresetMode = 'none';
let isGenAIPresetSync = true;
let currentGenerationPresetMode = 'none';
let isGenerationPresetSync = true;

function updateGenerationPresetModeUI() {
  const btnNone = document.getElementById('btn-generation-preset-mode-none');
  const btnThinking = document.getElementById('btn-generation-preset-mode-thinking');
  const btnSync = document.getElementById('btn-generation-preset-mode-sync');
  const togglesContainer = document.getElementById('generation-preset-mode-toggles');
  
  if (!btnNone || !btnThinking || !btnSync) return;
  
  if (isGenerationPresetSync) {
    btnSync.classList.add('active');
    btnSync.style.color = 'var(--accent-primary)';
    if (togglesContainer) {
      togglesContainer.style.opacity = '0.5';
      togglesContainer.style.pointerEvents = 'none';
    }
  } else {
    btnSync.classList.remove('active');
    btnSync.style.color = 'var(--text-secondary)';
    if (togglesContainer) {
      togglesContainer.style.opacity = '1';
      togglesContainer.style.pointerEvents = 'auto';
    }
  }
  
  if (currentGenerationPresetMode === 'none') {
    btnNone.style.background = 'var(--bg-secondary)';
    btnNone.style.color = 'var(--text-primary)';
    btnThinking.style.background = 'transparent';
    btnThinking.style.color = 'var(--text-secondary)';
  } else {
    btnThinking.style.background = 'var(--bg-secondary)';
    btnThinking.style.color = 'var(--text-primary)';
    btnNone.style.background = 'transparent';
    btnNone.style.color = 'var(--text-secondary)';
  }
}

function updateGenAIPresetModeUI() {
  const btnNone = document.getElementById('btn-preset-mode-none');
  const btnThinking = document.getElementById('btn-preset-mode-thinking');
  const btnSync = document.getElementById('btn-preset-mode-sync');
  const togglesContainer = document.getElementById('preset-mode-toggles');
  
  if (!btnNone || !btnThinking || !btnSync) return;
  
  if (isGenAIPresetSync) {
    btnSync.classList.add('active');
    btnSync.style.color = 'var(--accent-primary)';
    if (togglesContainer) {
      togglesContainer.style.opacity = '0.5';
      togglesContainer.style.pointerEvents = 'none';
    }
  } else {
    btnSync.classList.remove('active');
    btnSync.style.color = 'var(--text-secondary)';
    if (togglesContainer) {
      togglesContainer.style.opacity = '1';
      togglesContainer.style.pointerEvents = 'auto';
    }
  }
  
  if (currentGenAIPresetMode === 'none') {
    btnNone.style.background = 'var(--bg-secondary)';
    btnNone.style.color = 'var(--text-primary)';
    btnThinking.style.background = 'transparent';
    btnThinking.style.color = 'var(--text-secondary)';
  } else {
    btnThinking.style.background = 'var(--bg-secondary)';
    btnThinking.style.color = 'var(--text-primary)';
    btnNone.style.background = 'transparent';
    btnNone.style.color = 'var(--text-secondary)';
  }
}
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

  // System Prompt Preset management
  btnAddPreset.addEventListener('click', createNewPreset);

  // Generation setting sync
  setupRangeInput('adv-setting-max-tokens', 'adv-max-tokens-value', false);
  setupRangeInput('adv-setting-temperature', 'adv-temperature-value', false);
  setupRangeInput('adv-setting-top-p', 'adv-top-p-value', false);
  setupRangeInput('adv-setting-top-k', 'adv-top-k-value', false);
  setupRangeInput('adv-setting-rep-penalty', 'adv-rep-penalty-value', false);
  setupRangeInput('adv-setting-smoothing-factor', 'adv-smoothing-factor-value', false);
  setupRangeInput('adv-setting-min-p', 'adv-min-p-value', false);
  setupRangeInput('adv-setting-adaptive-target', 'adv-adaptive-target-value', false);
  setupRangeInput('adv-setting-adaptive-decay', 'adv-adaptive-decay-value', false);
  setupRangeInput('adv-setting-presence-penalty', 'adv-presence-penalty-value', false);
  setupRangeInput('adv-setting-dry-multiplier', 'adv-dry-multiplier-value', false);
  setupRangeInput('adv-setting-dry-base', 'adv-dry-base-value', false);
  setupRangeInput('adv-setting-dry-allowed-length', 'adv-dry-allowed-length-value', false);

  // GenAI Generation setting sync
  setupRangeInput('adv-setting-genai-max-tokens', 'adv-genai-max-tokens-value', true);
  setupRangeInput('adv-setting-genai-temperature', 'adv-genai-temperature-value', true);
  setupRangeInput('adv-setting-genai-top-p', 'adv-genai-top-p-value', true);
  setupRangeInput('adv-setting-genai-top-k', 'adv-genai-top-k-value', true);
  setupRangeInput('adv-setting-genai-rep-penalty', 'adv-genai-rep-penalty-value', true);
  setupRangeInput('adv-setting-genai-smoothing-factor', 'adv-genai-smoothing-factor-value', true);
  setupRangeInput('adv-setting-genai-min-p', 'adv-genai-min-p-value', true);
  setupRangeInput('adv-setting-genai-adaptive-target', 'adv-genai-adaptive-target-value', true);
  setupRangeInput('adv-setting-genai-adaptive-decay', 'adv-genai-adaptive-decay-value', true);
  setupRangeInput('adv-setting-genai-presence-penalty', 'adv-genai-presence-penalty-value', true);
  setupRangeInput('adv-setting-genai-dry-multiplier', 'adv-genai-dry-multiplier-value', true);
  setupRangeInput('adv-setting-genai-dry-base', 'adv-genai-dry-base-value', true);
  // Extended Sampler range inputs (Generation)
  setupRangeInput('adv-setting-typical-p', 'adv-typical-p-value', false);
  setupRangeInput('adv-setting-frequency-penalty', 'adv-frequency-penalty-value', false);
  setupRangeInput('adv-setting-top-a', 'adv-top-a-value', false);
  setupRangeInput('adv-setting-tfs', 'adv-tfs-value', false);
  setupRangeInput('adv-setting-mirostat-tau', 'adv-mirostat-tau-value', false);
  setupRangeInput('adv-setting-mirostat-eta', 'adv-mirostat-eta-value', false);
  setupRangeInput('adv-setting-xtc-threshold', 'adv-xtc-threshold-value', false);
  setupRangeInput('adv-setting-xtc-probability', 'adv-xtc-probability-value', false);
  setupRangeInput('adv-setting-dynatemp-min', 'adv-dynatemp-min-value', false);
  setupRangeInput('adv-setting-dynatemp-max', 'adv-dynatemp-max-value', false);
  setupRangeInput('adv-setting-dynatemp-range', 'adv-dynatemp-range-value', false);
  setupRangeInput('adv-setting-dynatemp-exponent', 'adv-dynatemp-exponent-value', false);
  setupRangeInput('adv-setting-top-n-sigma', 'adv-top-n-sigma-value', false);
  setupRangeInput('adv-setting-rep-pen-range', 'adv-rep-pen-range-value', false);
  setupRangeInput('adv-setting-rep-pen-slope', 'adv-rep-pen-slope-value', false);
  setupRangeInput('adv-setting-min-tokens', 'adv-min-tokens-value', false);
  setupRangeInput('adv-setting-guidance-scale', 'adv-guidance-scale-value', false);

  // Extended Sampler range inputs (GenAI)
  setupRangeInput('adv-setting-genai-typical-p', 'adv-genai-typical-p-value', true);
  setupRangeInput('adv-setting-genai-frequency-penalty', 'adv-genai-frequency-penalty-value', true);
  setupRangeInput('adv-setting-genai-top-a', 'adv-genai-top-a-value', true);
  setupRangeInput('adv-setting-genai-tfs', 'adv-genai-tfs-value', true);
  setupRangeInput('adv-setting-genai-mirostat-tau', 'adv-genai-mirostat-tau-value', true);
  setupRangeInput('adv-setting-genai-mirostat-eta', 'adv-genai-mirostat-eta-value', true);
  setupRangeInput('adv-setting-genai-xtc-threshold', 'adv-genai-xtc-threshold-value', true);
  setupRangeInput('adv-setting-genai-xtc-probability', 'adv-genai-xtc-probability-value', true);
  setupRangeInput('adv-setting-genai-dynatemp-min', 'adv-genai-dynatemp-min-value', true);
  setupRangeInput('adv-setting-genai-dynatemp-max', 'adv-genai-dynatemp-max-value', true);
  setupRangeInput('adv-setting-genai-dynatemp-range', 'adv-genai-dynatemp-range-value', true);
  setupRangeInput('adv-setting-genai-dynatemp-exponent', 'adv-genai-dynatemp-exponent-value', true);
  setupRangeInput('adv-setting-genai-top-n-sigma', 'adv-genai-top-n-sigma-value', true);
  setupRangeInput('adv-setting-genai-rep-pen-range', 'adv-genai-rep-pen-range-value', true);
  setupRangeInput('adv-setting-genai-rep-pen-slope', 'adv-genai-rep-pen-slope-value', true);
  setupRangeInput('adv-setting-genai-min-tokens', 'adv-genai-min-tokens-value', true);
  setupRangeInput('adv-setting-genai-guidance-scale', 'adv-genai-guidance-scale-value', true);

  // Collapsible Sampler Group Toggles (Generation)
  const setupGroupToggle = (toggleId, controlsId) => {
    document.getElementById(toggleId)?.addEventListener('change', (e) => {
      const ctrls = document.getElementById(controlsId);
      if (ctrls) ctrls.style.display = e.target.checked ? 'flex' : 'none';
    });
  };
  setupGroupToggle('adv-setting-mirostat-enabled', 'mirostat-controls');
  setupGroupToggle('adv-setting-xtc-enabled', 'xtc-controls');
  setupGroupToggle('adv-setting-dynatemp-enabled', 'dynatemp-controls');
  setupGroupToggle('adv-setting-rep-pen-range-enabled', 'rep-pen-range-controls');
  setupGroupToggle('adv-setting-guidance-scale-enabled', 'guidance-scale-controls');
  setupGroupToggle('adv-setting-genai-mirostat-enabled', 'genai-mirostat-controls');
  setupGroupToggle('adv-setting-genai-xtc-enabled', 'genai-xtc-controls');
  setupGroupToggle('adv-setting-genai-dynatemp-enabled', 'genai-dynatemp-controls');
  setupGroupToggle('adv-setting-genai-rep-pen-range-enabled', 'genai-rep-pen-range-controls');
  setupGroupToggle('adv-setting-genai-guidance-scale-enabled', 'genai-guidance-scale-controls');

  // Completion Mode Select Listeners
  document.getElementById('adv-setting-completion-mode')?.addEventListener('change', (e) => {
    const isText = e.target.value === 'text_completion';
    const grp = document.getElementById('text-completion-templates-group');
    if (grp) grp.style.display = isText ? 'flex' : 'none';
    updateActiveGenerationPreset(false);
  });
  document.getElementById('adv-setting-genai-completion-mode')?.addEventListener('change', (e) => {
    const isText = e.target.value === 'text_completion';
    const grp = document.getElementById('genai-text-completion-templates-group');
    if (grp) grp.style.display = isText ? 'flex' : 'none';
    updateActiveGenerationPreset(true);
  });

  const addToggleListener = (id, isGenAI) => {
    document.getElementById(id)?.addEventListener('change', () => {
      updateActiveGenerationPreset(isGenAI);
    });
  };
  addToggleListener('adv-setting-min-p-enabled', false);
  addToggleListener('adv-setting-adaptive-target-enabled', false);
  addToggleListener('adv-setting-adaptive-decay-enabled', false);
  addToggleListener('adv-setting-dry-enabled', false);
  addToggleListener('adv-setting-force-reasoning', false);
  addToggleListener('adv-setting-typical-p-enabled', false);
  addToggleListener('adv-setting-frequency-penalty-enabled', false);
  addToggleListener('adv-setting-top-a-enabled', false);
  addToggleListener('adv-setting-tfs-enabled', false);
  addToggleListener('adv-setting-mirostat-enabled', false);
  addToggleListener('adv-setting-xtc-enabled', false);
  addToggleListener('adv-setting-dynatemp-enabled', false);
  addToggleListener('adv-setting-top-n-sigma-enabled', false);
  addToggleListener('adv-setting-rep-pen-range-enabled', false);
  addToggleListener('adv-setting-min-tokens-enabled', false);
  addToggleListener('adv-setting-guidance-scale-enabled', false);
  addToggleListener('adv-setting-ignore-eos', false);

  addToggleListener('adv-setting-genai-min-p-enabled', true);
  addToggleListener('adv-setting-genai-adaptive-target-enabled', true);
  addToggleListener('adv-setting-genai-adaptive-decay-enabled', true);
  addToggleListener('adv-setting-genai-dry-enabled', true);
  addToggleListener('adv-setting-genai-force-reasoning', true);
  addToggleListener('adv-setting-genai-typical-p-enabled', true);
  addToggleListener('adv-setting-genai-frequency-penalty-enabled', true);
  addToggleListener('adv-setting-genai-top-a-enabled', true);
  addToggleListener('adv-setting-genai-tfs-enabled', true);
  addToggleListener('adv-setting-genai-mirostat-enabled', true);
  addToggleListener('adv-setting-genai-xtc-enabled', true);
  addToggleListener('adv-setting-genai-dynatemp-enabled', true);
  addToggleListener('adv-setting-genai-top-n-sigma-enabled', true);
  addToggleListener('adv-setting-genai-rep-pen-range-enabled', true);
  addToggleListener('adv-setting-genai-min-tokens-enabled', true);
  addToggleListener('adv-setting-genai-guidance-scale-enabled', true);
  addToggleListener('adv-setting-genai-ignore-eos', true);

  const addInputListener = (id, isGenAI) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      updateActiveGenerationPreset(isGenAI);
    });
    el.addEventListener('change', () => {
      updateActiveGenerationPreset(isGenAI);
    });
  };
  addInputListener('adv-setting-reasoning-open', false);
  addInputListener('adv-setting-reasoning-close', false);
  addInputListener('adv-setting-dry-sequence-breakers', false);
  addInputListener('adv-setting-mirostat-mode', false);
  addInputListener('adv-setting-negative-prompt', false);
  addInputListener('adv-setting-banned-strings', false);
  addInputListener('adv-setting-instruct-template-select', false);
  addInputListener('adv-setting-context-template-select', false);

  addInputListener('adv-setting-genai-reasoning-open', true);
  addInputListener('adv-setting-genai-reasoning-close', true);
  addInputListener('adv-setting-genai-dry-sequence-breakers', true);
  addInputListener('adv-setting-genai-mirostat-mode', true);
  addInputListener('adv-setting-genai-negative-prompt', true);
  addInputListener('adv-setting-genai-banned-strings', true);
  addInputListener('adv-setting-genai-instruct-template-select', true);
  addInputListener('adv-setting-genai-context-template-select', true);
  addInputListener('adv-setting-genai-system-prompt', true);

  const setupDynaTempSync = (isGenAI) => {
    const prefix = isGenAI ? 'adv-setting-genai-' : 'adv-setting-';
    const valPrefix = isGenAI ? 'adv-genai-' : 'adv-';
    
    const tempEl = document.getElementById(`${prefix}temperature`);
    const minEl = document.getElementById(`${prefix}dynatemp-min`);
    const maxEl = document.getElementById(`${prefix}dynatemp-max`);
    const rangeEl = document.getElementById(`${prefix}dynatemp-range`);
    const tempValEl = document.getElementById(`${valPrefix}temperature-value`);
    const minValEl = document.getElementById(`${valPrefix}dynatemp-min-value`);
    const maxValEl = document.getElementById(`${valPrefix}dynatemp-max-value`);
    const rangeValEl = document.getElementById(`${valPrefix}dynatemp-range-value`);

    if (!tempEl || !minEl || !maxEl || !rangeEl) return;

    const setRangeFill = (el) => {
      if (!el) return;
      const min = parseFloat(el.min) || 0;
      const max = parseFloat(el.max) || 1;
      const val = parseFloat(el.value) || 0;
      const pct = ((val - min) / (max - min)) * 100;
      el.style.setProperty('--range-fill', `${pct}%`);
    };

    const updateUI = () => {
      if (tempValEl) tempValEl.textContent = parseFloat(tempEl.value).toFixed(2);
      if (minValEl) minValEl.textContent = parseFloat(minEl.value).toFixed(2);
      if (maxValEl) maxValEl.textContent = parseFloat(maxEl.value).toFixed(2);
      if (rangeValEl) rangeValEl.textContent = parseFloat(rangeEl.value).toFixed(2);
      
      setRangeFill(tempEl);
      setRangeFill(minEl);
      setRangeFill(maxEl);
      setRangeFill(rangeEl);
      
      updateActiveGenerationPreset(isGenAI);
    };

    tempEl.addEventListener('input', () => {
      const temp = parseFloat(tempEl.value);
      const range = parseFloat(rangeEl.value);
      minEl.value = Math.max(0, temp - range);
      maxEl.value = Math.min(2, temp + range);
      updateUI();
    });

    rangeEl.addEventListener('input', () => {
      const temp = parseFloat(tempEl.value);
      const range = parseFloat(rangeEl.value);
      minEl.value = Math.max(0, temp - range);
      maxEl.value = Math.min(2, temp + range);
      updateUI();
    });

    minEl.addEventListener('input', () => {
      let min = parseFloat(minEl.value);
      let max = parseFloat(maxEl.value);
      if (min > max) { max = min; maxEl.value = min; }
      tempEl.value = (min + max) / 2;
      rangeEl.value = (max - min) / 2;
      updateUI();
    });

    maxEl.addEventListener('input', () => {
      let min = parseFloat(minEl.value);
      let max = parseFloat(maxEl.value);
      if (max < min) { min = max; minEl.value = max; }
      tempEl.value = (min + max) / 2;
      rangeEl.value = (max - min) / 2;
      updateUI();
    });
  };

  setupDynaTempSync(false);
  setupDynaTempSync(true);

  document.getElementById('adv-setting-dry-enabled')?.addEventListener('change', (e) => {
    const ctrls = document.getElementById('dry-sampler-controls');
    if (ctrls) ctrls.style.display = e.target.checked ? 'flex' : 'none';
  });
  document.getElementById('adv-setting-genai-dry-enabled')?.addEventListener('change', (e) => {
    const ctrls = document.getElementById('genai-dry-sampler-controls');
    if (ctrls) ctrls.style.display = e.target.checked ? 'flex' : 'none';
  });

  // Generation Presets Management
  document.getElementById('generation-preset-select')?.addEventListener('change', (e) => applyGenerationPreset(e.target.value, false));
  document.getElementById('genai-preset-select')?.addEventListener('change', (e) => applyGenerationPreset(e.target.value, true));
  
  document.getElementById('btn-add-generation-preset')?.addEventListener('click', () => saveAsNewGenerationPreset(false));
  document.getElementById('btn-add-genai-preset')?.addEventListener('click', () => saveAsNewGenerationPreset(true));
  
  document.getElementById('btn-reset-generation-preset')?.addEventListener('click', () => resetGenerationPreset(false));
  document.getElementById('btn-reset-genai-preset')?.addEventListener('click', () => resetGenerationPreset(true));

  document.getElementById('btn-delete-generation-preset')?.addEventListener('click', () => deleteGenerationPreset(false));
  document.getElementById('btn-delete-genai-preset')?.addEventListener('click', () => deleteGenerationPreset(true));

  document.getElementById('btn-preset-mode-sync')?.addEventListener('click', () => {
    isGenAIPresetSync = !isGenAIPresetSync;
    const activeId = currentSettings.active_genai_generation_preset_id;
    const preset = currentSettings.generation_presets.find(p => p.id === activeId);
    if (preset) {
      preset.is_sync = isGenAIPresetSync;
      if (isGenAIPresetSync) {
        currentGenAIPresetMode = 'none';
        delete preset.thinking_settings;
      }
      preset.preset_mode = currentGenAIPresetMode;
      applyGenerationPreset(activeId, true);
    }
    updateGenAIPresetModeUI();
  });
  
  document.getElementById('btn-preset-mode-none')?.addEventListener('click', () => {
    if (isGenAIPresetSync) return;
    currentGenAIPresetMode = 'none';
    const activeId = currentSettings.active_genai_generation_preset_id;
    const preset = currentSettings.generation_presets.find(p => p.id === activeId);
    if (preset) preset.preset_mode = 'none';
    updateGenAIPresetModeUI();
    applyGenerationPreset(currentSettings.active_genai_generation_preset_id, true);
  });
  
  document.getElementById('btn-preset-mode-thinking')?.addEventListener('click', () => {
    if (isGenAIPresetSync) return;
    currentGenAIPresetMode = 'thinking';
    const activeId = currentSettings.active_genai_generation_preset_id;
    const preset = currentSettings.generation_presets.find(p => p.id === activeId);
    if (preset) {
      preset.preset_mode = 'thinking';
      if (!preset.thinking_settings) {
        preset.thinking_settings = {};
        updateActiveGenerationPreset(true);
      }
    }
    updateGenAIPresetModeUI();
    applyGenerationPreset(currentSettings.active_genai_generation_preset_id, true);
  });

  document.getElementById('btn-generation-preset-mode-sync')?.addEventListener('click', () => {
    isGenerationPresetSync = !isGenerationPresetSync;
    const activeId = currentSettings.active_generation_preset_id;
    const preset = currentSettings.generation_presets.find(p => p.id === activeId);
    if (preset) {
      preset.is_sync = isGenerationPresetSync;
      if (isGenerationPresetSync) {
        currentGenerationPresetMode = 'none';
        delete preset.thinking_settings;
      }
      preset.preset_mode = currentGenerationPresetMode;
      applyGenerationPreset(activeId, false);
    }
    updateGenerationPresetModeUI();
  });
  
  document.getElementById('btn-generation-preset-mode-none')?.addEventListener('click', () => {
    if (isGenerationPresetSync) return;
    currentGenerationPresetMode = 'none';
    const activeId = currentSettings.active_generation_preset_id;
    const preset = currentSettings.generation_presets.find(p => p.id === activeId);
    if (preset) preset.preset_mode = 'none';
    updateGenerationPresetModeUI();
    applyGenerationPreset(currentSettings.active_generation_preset_id, false);
  });
  
  document.getElementById('btn-generation-preset-mode-thinking')?.addEventListener('click', () => {
    if (isGenerationPresetSync) return;
    currentGenerationPresetMode = 'thinking';
    const activeId = currentSettings.active_generation_preset_id;
    const preset = currentSettings.generation_presets.find(p => p.id === activeId);
    if (preset) {
      preset.preset_mode = 'thinking';
      if (!preset.thinking_settings) {
        preset.thinking_settings = {};
        updateActiveGenerationPreset(false);
      }
    }
    updateGenerationPresetModeUI();
    applyGenerationPreset(currentSettings.active_generation_preset_id, false);
  });

  // Advanced Formatting Templates listeners
  setupFormattingTemplateListeners();

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
  setRangeValue('adv-setting-smoothing-factor', 'adv-smoothing-factor-value', currentSettings.smoothing_factor || 0);
  setRangeValue('adv-setting-min-p', 'adv-min-p-value', currentSettings.min_p || 0.05);
  if (document.getElementById('adv-setting-min-p-enabled')) document.getElementById('adv-setting-min-p-enabled').checked = currentSettings.min_p_enabled ?? true;
  setRangeValue('adv-setting-adaptive-target', 'adv-adaptive-target-value', currentSettings.adaptive_target || 0.8);
  if (document.getElementById('adv-setting-adaptive-target-enabled')) document.getElementById('adv-setting-adaptive-target-enabled').checked = currentSettings.adaptive_target_enabled ?? true;
  setRangeValue('adv-setting-adaptive-decay', 'adv-adaptive-decay-value', currentSettings.adaptive_decay || 0.9);
  if (document.getElementById('adv-setting-adaptive-decay-enabled')) document.getElementById('adv-setting-adaptive-decay-enabled').checked = currentSettings.adaptive_decay_enabled ?? true;
  setRangeValue('adv-setting-presence-penalty', 'adv-presence-penalty-value', currentSettings.presence_penalty ?? 0);
  
  const dryEnabled = currentSettings.dry_multiplier_enabled ?? false;
  if (document.getElementById('adv-setting-dry-enabled')) {
    document.getElementById('adv-setting-dry-enabled').checked = dryEnabled;
    const ctrls = document.getElementById('dry-sampler-controls');
    if (ctrls) ctrls.style.display = dryEnabled ? 'flex' : 'none';
  }
  setRangeValue('adv-setting-dry-multiplier', 'adv-dry-multiplier-value', currentSettings.dry_multiplier ?? 0.8);
  setRangeValue('adv-setting-dry-base', 'adv-dry-base-value', currentSettings.dry_base ?? 1.75);
  setRangeValue('adv-setting-dry-allowed-length', 'adv-dry-allowed-length-value', currentSettings.dry_allowed_length ?? 2);
  const breakersInput = document.getElementById('adv-setting-dry-sequence-breakers');
  if (breakersInput) {
    const breakersVal = currentSettings.dry_sequence_breakers || ["\n", ":", "\"", "*"];
    breakersInput.value = typeof breakersVal === 'string' ? breakersVal : JSON.stringify(breakersVal);
  }
  applyExtendedSamplersToUI(currentSettings, false);

  // Load GenAI generation settings
  setRangeValue('adv-setting-genai-max-tokens', 'adv-genai-max-tokens-value', currentSettings.genai_max_tokens);
  setRangeValue('adv-setting-genai-temperature', 'adv-genai-temperature-value', currentSettings.genai_temperature);
  setRangeValue('adv-setting-genai-top-p', 'adv-genai-top-p-value', currentSettings.genai_top_p);
  setRangeValue('adv-setting-genai-top-k', 'adv-genai-top-k-value', currentSettings.genai_top_k);
  setRangeValue('adv-setting-genai-rep-penalty', 'adv-genai-rep-penalty-value', currentSettings.genai_rep_penalty);
  setRangeValue('adv-setting-genai-smoothing-factor', 'adv-genai-smoothing-factor-value', currentSettings.genai_smoothing_factor || 0);
  setRangeValue('adv-setting-genai-min-p', 'adv-genai-min-p-value', currentSettings.genai_min_p || 0.05);
  if (document.getElementById('adv-setting-genai-min-p-enabled')) document.getElementById('adv-setting-genai-min-p-enabled').checked = currentSettings.genai_min_p_enabled ?? true;
  setRangeValue('adv-setting-genai-adaptive-target', 'adv-genai-adaptive-target-value', currentSettings.genai_adaptive_target || 0.8);
  if (document.getElementById('adv-setting-genai-adaptive-target-enabled')) document.getElementById('adv-setting-genai-adaptive-target-enabled').checked = currentSettings.genai_adaptive_target_enabled ?? true;
  setRangeValue('adv-setting-genai-adaptive-decay', 'adv-genai-adaptive-decay-value', currentSettings.genai_adaptive_decay || 0.9);
  if (document.getElementById('adv-setting-genai-adaptive-decay-enabled')) document.getElementById('adv-setting-genai-adaptive-decay-enabled').checked = currentSettings.genai_adaptive_decay_enabled ?? true;
  setRangeValue('adv-setting-genai-presence-penalty', 'adv-genai-presence-penalty-value', currentSettings.genai_presence_penalty ?? 0);

  const genaiDryEnabled = currentSettings.genai_dry_multiplier_enabled ?? false;
  if (document.getElementById('adv-setting-genai-dry-enabled')) {
    document.getElementById('adv-setting-genai-dry-enabled').checked = genaiDryEnabled;
    const ctrls = document.getElementById('genai-dry-sampler-controls');
    if (ctrls) ctrls.style.display = genaiDryEnabled ? 'flex' : 'none';
  }
  setRangeValue('adv-setting-genai-dry-multiplier', 'adv-genai-dry-multiplier-value', currentSettings.genai_dry_multiplier ?? 0.8);
  setRangeValue('adv-setting-genai-dry-base', 'adv-genai-dry-base-value', currentSettings.genai_dry_base ?? 1.75);
  setRangeValue('adv-setting-genai-dry-allowed-length', 'adv-genai-dry-allowed-length-value', currentSettings.genai_dry_allowed_length ?? 2);
  const genaiBreakersInput = document.getElementById('adv-setting-genai-dry-sequence-breakers');
  if (genaiBreakersInput) {
    const genaiBreakersVal = currentSettings.genai_dry_sequence_breakers || ["\n", ":", "\"", "*"];
    genaiBreakersInput.value = typeof genaiBreakersVal === 'string' ? genaiBreakersVal : JSON.stringify(genaiBreakersVal);
  }
  applyExtendedSamplersToUI({
    typical_p: currentSettings.genai_typical_p,
    typical_p_enabled: currentSettings.genai_typical_p_enabled,
    frequency_penalty: currentSettings.genai_frequency_penalty,
    frequency_penalty_enabled: currentSettings.genai_frequency_penalty_enabled,
    top_a: currentSettings.genai_top_a,
    top_a_enabled: currentSettings.genai_top_a_enabled,
    tfs: currentSettings.genai_tfs,
    tfs_enabled: currentSettings.genai_tfs_enabled,
    mirostat_enabled: currentSettings.genai_mirostat_enabled,
    mirostat_mode: currentSettings.genai_mirostat_mode,
    mirostat_tau: currentSettings.genai_mirostat_tau,
    mirostat_eta: currentSettings.genai_mirostat_eta,
    xtc_enabled: currentSettings.genai_xtc_enabled,
    xtc_threshold: currentSettings.genai_xtc_threshold,
    xtc_probability: currentSettings.genai_xtc_probability,
    top_n_sigma_enabled: currentSettings.genai_top_n_sigma_enabled,
    top_n_sigma: currentSettings.genai_top_n_sigma,
    rep_pen_range_enabled: currentSettings.genai_rep_pen_range_enabled,
    rep_pen_range: currentSettings.genai_rep_pen_range,
    rep_pen_slope: currentSettings.genai_rep_pen_slope,
    min_tokens_enabled: currentSettings.genai_min_tokens_enabled,
    min_tokens: currentSettings.genai_min_tokens,
    guidance_scale_enabled: currentSettings.genai_guidance_scale_enabled,
    guidance_scale: currentSettings.genai_guidance_scale,
    negative_prompt: currentSettings.genai_negative_prompt,
    ignore_eos: currentSettings.genai_ignore_eos,
    banned_strings: currentSettings.genai_banned_strings
  }, true);

  const genaiSystemPromptInput = document.getElementById('adv-setting-genai-system-prompt');
  if (genaiSystemPromptInput) {
    genaiSystemPromptInput.value = currentSettings.genai_system_prompt_addition || "";
  }

  const forceReasoning = document.getElementById('adv-setting-force-reasoning');
  if (forceReasoning) forceReasoning.checked = !!currentSettings.force_reasoning;
  const reasoningOpen = document.getElementById('adv-setting-reasoning-open');
  if (reasoningOpen) reasoningOpen.value = currentSettings.reasoning_tag_open || '<think>';
  const reasoningClose = document.getElementById('adv-setting-reasoning-close');
  if (reasoningClose) reasoningClose.value = currentSettings.reasoning_tag_close || '</think>';

  const genaiForceReasoning = document.getElementById('adv-setting-genai-force-reasoning');
  if (genaiForceReasoning) genaiForceReasoning.checked = !!currentSettings.genai_force_reasoning;
  const genaiReasoningOpen = document.getElementById('adv-setting-genai-reasoning-open');
  if (genaiReasoningOpen) genaiReasoningOpen.value = currentSettings.genai_reasoning_tag_open || '<think>';
  const genaiReasoningClose = document.getElementById('adv-setting-genai-reasoning-close');
  if (genaiReasoningClose) genaiReasoningClose.value = currentSettings.genai_reasoning_tag_close || '</think>';

  if (aiCommentsPromptInput) {
    aiCommentsPromptInput.value = currentSettings.ai_comments_prompt || "";
  }
  
  const historyToggle = document.getElementById('setting-ai-comments-history');
  if (historyToggle) {
    historyToggle.checked = !!currentSettings.ai_comments_history_enabled;
  }

  const compMode = document.getElementById('adv-setting-completion-mode');
  if (compMode) {
    compMode.value = currentSettings.completion_mode || 'chat_completion';
    const grp = document.getElementById('text-completion-templates-group');
    if (grp) grp.style.display = compMode.value === 'text_completion' ? 'flex' : 'none';
  }

  const genaiCompMode = document.getElementById('adv-setting-genai-completion-mode');
  if (genaiCompMode) {
    genaiCompMode.value = currentSettings.genai_completion_mode || 'chat_completion';
    const grp = document.getElementById('genai-text-completion-templates-group');
    if (grp) grp.style.display = genaiCompMode.value === 'text_completion' ? 'flex' : 'none';
  }

  // Load presets & formatting templates
  renderPresets();
  renderGenerationPresetsUI();
  renderFormattingTemplatesUI();

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
  
  if (currentSettings.active_generation_preset_id) {
    applyGenerationPreset(currentSettings.active_generation_preset_id, false);
  }
  if (currentSettings.active_genai_generation_preset_id) {
    applyGenerationPreset(currentSettings.active_genai_generation_preset_id, true);
  }
}

function renderGenerationPresetsUI() {
  const genSelect = document.getElementById('generation-preset-select');
  const genaiSelect = document.getElementById('genai-preset-select');
  if (!genSelect || !genaiSelect) return;

  genSelect.innerHTML = '';
  genaiSelect.innerHTML = '';

  currentSettings.generation_presets.forEach(p => {
    const opt1 = document.createElement('option');
    opt1.value = p.id;
    opt1.textContent = p.name;
    genSelect.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = p.id;
    opt2.textContent = p.name;
    genaiSelect.appendChild(opt2);
  });

  genSelect.value = currentSettings.active_generation_preset_id || 'default';
  genaiSelect.value = currentSettings.active_genai_generation_preset_id || 'default';
}

function extractExtendedSamplersFromUI(isGenAI) {
  const prefix = isGenAI ? 'adv-setting-genai-' : 'adv-setting-';
  return {
    typical_p: parseFloat(document.getElementById(`${prefix}typical-p`)?.value ?? 1.0),
    typical_p_enabled: document.getElementById(`${prefix}typical-p-enabled`)?.checked ?? false,
    frequency_penalty: parseFloat(document.getElementById(`${prefix}frequency-penalty`)?.value ?? 0.0),
    frequency_penalty_enabled: document.getElementById(`${prefix}frequency-penalty-enabled`)?.checked ?? false,
    top_a: parseFloat(document.getElementById(`${prefix}top-a`)?.value ?? 0.0),
    top_a_enabled: document.getElementById(`${prefix}top-a-enabled`)?.checked ?? false,
    tfs: parseFloat(document.getElementById(`${prefix}tfs`)?.value ?? 1.0),
    tfs_enabled: document.getElementById(`${prefix}tfs-enabled`)?.checked ?? false,
    mirostat_enabled: document.getElementById(`${prefix}mirostat-enabled`)?.checked ?? false,
    mirostat_mode: parseInt(document.getElementById(`${prefix}mirostat-mode`)?.value ?? 0),
    mirostat_tau: parseFloat(document.getElementById(`${prefix}mirostat-tau`)?.value ?? 5.0),
    mirostat_eta: parseFloat(document.getElementById(`${prefix}mirostat-eta`)?.value ?? 0.1),
    xtc_enabled: document.getElementById(`${prefix}xtc-enabled`)?.checked ?? false,
    xtc_threshold: parseFloat(document.getElementById(`${prefix}xtc-threshold`)?.value ?? 0.1),
    xtc_probability: parseFloat(document.getElementById(`${prefix}xtc-probability`)?.value ?? 0.0),
    dynatemp_enabled: document.getElementById(`${prefix}dynatemp-enabled`)?.checked ?? false,
    dynatemp_min: parseFloat(document.getElementById(`${prefix}dynatemp-min`)?.value ?? 0.65),
    dynatemp_max: parseFloat(document.getElementById(`${prefix}dynatemp-max`)?.value ?? 1.35),
    dynatemp_range: parseFloat(document.getElementById(`${prefix}dynatemp-range`)?.value ?? 0.0),
    dynatemp_exponent: parseFloat(document.getElementById(`${prefix}dynatemp-exponent`)?.value ?? 1.0),
    top_n_sigma_enabled: document.getElementById(`${prefix}top-n-sigma-enabled`)?.checked ?? false,
    top_n_sigma: parseFloat(document.getElementById(`${prefix}top-n-sigma`)?.value ?? 0.0),
    rep_pen_range_enabled: document.getElementById(`${prefix}rep-pen-range-enabled`)?.checked ?? false,
    rep_pen_range: parseInt(document.getElementById(`${prefix}rep-pen-range`)?.value ?? 0),
    rep_pen_slope: parseFloat(document.getElementById(`${prefix}rep-pen-slope`)?.value ?? 1.0),
    min_tokens_enabled: document.getElementById(`${prefix}min-tokens-enabled`)?.checked ?? false,
    min_tokens: parseInt(document.getElementById(`${prefix}min-tokens`)?.value ?? 0),
    guidance_scale_enabled: document.getElementById(`${prefix}guidance-scale-enabled`)?.checked ?? false,
    guidance_scale: parseFloat(document.getElementById(`${prefix}guidance-scale`)?.value ?? 1.0),
    negative_prompt: document.getElementById(`${prefix}negative-prompt`)?.value || '',
    ignore_eos: document.getElementById(`${prefix}ignore-eos`)?.checked ?? false,
    banned_strings: document.getElementById(`${prefix}banned-strings`)?.value || ''
  };
}

function applyExtendedSamplersToUI(preset, isGenAI) {
  const prefix = isGenAI ? 'adv-setting-genai-' : 'adv-setting-';
  const valPrefix = isGenAI ? 'adv-genai-' : 'adv-';
  const controlsPrefix = isGenAI ? 'genai-' : '';

  setRangeValue(`${prefix}typical-p`, `${valPrefix}typical-p-value`, preset.typical_p ?? 1.0);
  if (document.getElementById(`${prefix}typical-p-enabled`)) document.getElementById(`${prefix}typical-p-enabled`).checked = preset.typical_p_enabled ?? false;

  setRangeValue(`${prefix}frequency-penalty`, `${valPrefix}frequency-penalty-value`, preset.frequency_penalty ?? 0.0);
  if (document.getElementById(`${prefix}frequency-penalty-enabled`)) document.getElementById(`${prefix}frequency-penalty-enabled`).checked = preset.frequency_penalty_enabled ?? false;

  setRangeValue(`${prefix}top-a`, `${valPrefix}top-a-value`, preset.top_a ?? 0.0);
  if (document.getElementById(`${prefix}top-a-enabled`)) document.getElementById(`${prefix}top-a-enabled`).checked = preset.top_a_enabled ?? false;

  setRangeValue(`${prefix}tfs`, `${valPrefix}tfs-value`, preset.tfs ?? 1.0);
  if (document.getElementById(`${prefix}tfs-enabled`)) document.getElementById(`${prefix}tfs-enabled`).checked = preset.tfs_enabled ?? false;

  const mirostatEnabled = preset.mirostat_enabled ?? false;
  if (document.getElementById(`${prefix}mirostat-enabled`)) {
    document.getElementById(`${prefix}mirostat-enabled`).checked = mirostatEnabled;
    const ctrls = document.getElementById(`${controlsPrefix}mirostat-controls`);
    if (ctrls) ctrls.style.display = mirostatEnabled ? 'flex' : 'none';
  }
  if (document.getElementById(`${prefix}mirostat-mode`)) document.getElementById(`${prefix}mirostat-mode`).value = preset.mirostat_mode ?? 0;
  setRangeValue(`${prefix}mirostat-tau`, `${valPrefix}mirostat-tau-value`, preset.mirostat_tau ?? 5.0);
  setRangeValue(`${prefix}mirostat-eta`, `${valPrefix}mirostat-eta-value`, preset.mirostat_eta ?? 0.1);

  const xtcEnabled = preset.xtc_enabled ?? false;
  if (document.getElementById(`${prefix}xtc-enabled`)) {
    document.getElementById(`${prefix}xtc-enabled`).checked = xtcEnabled;
    const ctrls = document.getElementById(`${controlsPrefix}xtc-controls`);
    if (ctrls) ctrls.style.display = xtcEnabled ? 'flex' : 'none';
  }
  setRangeValue(`${prefix}xtc-threshold`, `${valPrefix}xtc-threshold-value`, preset.xtc_threshold ?? 0.1);
  setRangeValue(`${prefix}xtc-probability`, `${valPrefix}xtc-probability-value`, preset.xtc_probability ?? 0.0);

  const dynatempEnabled = preset.dynatemp_enabled ?? false;
  if (document.getElementById(`${prefix}dynatemp-enabled`)) {
    document.getElementById(`${prefix}dynatemp-enabled`).checked = dynatempEnabled;
    const ctrls = document.getElementById(`${controlsPrefix}dynatemp-controls`);
    if (ctrls) ctrls.style.display = dynatempEnabled ? 'flex' : 'none';
  }
  setRangeValue(`${prefix}dynatemp-min`, `${valPrefix}dynatemp-min-value`, preset.dynatemp_min ?? 0.65);
  setRangeValue(`${prefix}dynatemp-max`, `${valPrefix}dynatemp-max-value`, preset.dynatemp_max ?? 1.35);
  setRangeValue(`${prefix}dynatemp-range`, `${valPrefix}dynatemp-range-value`, preset.dynatemp_range ?? 0.0);
  setRangeValue(`${prefix}dynatemp-exponent`, `${valPrefix}dynatemp-exponent-value`, preset.dynatemp_exponent ?? 1.0);

  if (document.getElementById(`${prefix}top-n-sigma-enabled`)) document.getElementById(`${prefix}top-n-sigma-enabled`).checked = preset.top_n_sigma_enabled ?? false;
  setRangeValue(`${prefix}top-n-sigma`, `${valPrefix}top-n-sigma-value`, preset.top_n_sigma ?? 0.0);

  const repPenRangeEnabled = preset.rep_pen_range_enabled ?? false;
  if (document.getElementById(`${prefix}rep-pen-range-enabled`)) {
    document.getElementById(`${prefix}rep-pen-range-enabled`).checked = repPenRangeEnabled;
    const ctrls = document.getElementById(`${controlsPrefix}rep-pen-range-controls`);
    if (ctrls) ctrls.style.display = repPenRangeEnabled ? 'flex' : 'none';
  }
  setRangeValue(`${prefix}rep-pen-range`, `${valPrefix}rep-pen-range-value`, preset.rep_pen_range ?? 0);
  setRangeValue(`${prefix}rep-pen-slope`, `${valPrefix}rep-pen-slope-value`, preset.rep_pen_slope ?? 1.0);

  if (document.getElementById(`${prefix}min-tokens-enabled`)) document.getElementById(`${prefix}min-tokens-enabled`).checked = preset.min_tokens_enabled ?? false;
  setRangeValue(`${prefix}min-tokens`, `${valPrefix}min-tokens-value`, preset.min_tokens ?? 0);

  const guidanceScaleEnabled = preset.guidance_scale_enabled ?? false;
  if (document.getElementById(`${prefix}guidance-scale-enabled`)) {
    document.getElementById(`${prefix}guidance-scale-enabled`).checked = guidanceScaleEnabled;
    const ctrls = document.getElementById(`${controlsPrefix}guidance-scale-controls`);
    if (ctrls) ctrls.style.display = guidanceScaleEnabled ? 'flex' : 'none';
  }
  setRangeValue(`${prefix}guidance-scale`, `${valPrefix}guidance-scale-value`, preset.guidance_scale ?? 1.0);

  if (document.getElementById(`${prefix}negative-prompt`)) document.getElementById(`${prefix}negative-prompt`).value = preset.negative_prompt ?? '';
  if (document.getElementById(`${prefix}ignore-eos`)) document.getElementById(`${prefix}ignore-eos`).checked = preset.ignore_eos ?? false;
  if (document.getElementById(`${prefix}banned-strings`)) document.getElementById(`${prefix}banned-strings`).value = preset.banned_strings ?? '';
}

function applyGenerationPreset(presetId, isGenAI) {
  const preset = currentSettings.generation_presets.find(p => p.id === presetId);
  if (!preset) return;
  
  if (isGenAI) {
    currentSettings.active_genai_generation_preset_id = presetId;
    isGenAIPresetSync = preset.is_sync ?? true;
    currentGenAIPresetMode = preset.preset_mode || 'none';
    if (isGenAIPresetSync) currentGenAIPresetMode = 'none';
    if (typeof updateGenAIPresetModeUI === 'function') updateGenAIPresetModeUI();

    const source = (!isGenAIPresetSync && currentGenAIPresetMode === 'thinking' && preset.thinking_settings) 
      ? preset.thinking_settings 
      : preset;

    if (source.completion_mode) {
      const el = document.getElementById('adv-setting-genai-completion-mode');
      if (el) {
        el.value = source.completion_mode;
        const grp = document.getElementById('genai-text-completion-templates-group');
        if (grp) grp.style.display = source.completion_mode === 'text_completion' ? 'flex' : 'none';
      }
    }
    if (source.active_instruct_template_id) {
      const el = document.getElementById('adv-setting-genai-instruct-template-select');
      if (el) el.value = source.active_instruct_template_id;
    }
    if (source.active_context_template_id) {
      const el = document.getElementById('adv-setting-genai-context-template-select');
      if (el) el.value = source.active_context_template_id;
    }
    setRangeValue('adv-setting-genai-max-tokens', 'adv-genai-max-tokens-value', source.max_tokens);
    setRangeValue('adv-setting-genai-temperature', 'adv-genai-temperature-value', source.temperature);
    setRangeValue('adv-setting-genai-top-p', 'adv-genai-top-p-value', source.top_p);
    setRangeValue('adv-setting-genai-top-k', 'adv-genai-top-k-value', source.top_k);
    setRangeValue('adv-setting-genai-rep-penalty', 'adv-genai-rep-penalty-value', source.rep_penalty);
    setRangeValue('adv-setting-genai-smoothing-factor', 'adv-genai-smoothing-factor-value', source.smoothing_factor || 0);
    setRangeValue('adv-setting-genai-min-p', 'adv-genai-min-p-value', source.min_p || 0.05);
    if (document.getElementById('adv-setting-genai-min-p-enabled')) document.getElementById('adv-setting-genai-min-p-enabled').checked = source.min_p_enabled ?? true;
    setRangeValue('adv-setting-genai-adaptive-target', 'adv-genai-adaptive-target-value', source.adaptive_target || 0.8);
    if (document.getElementById('adv-setting-genai-adaptive-target-enabled')) document.getElementById('adv-setting-genai-adaptive-target-enabled').checked = source.adaptive_target_enabled ?? true;
    setRangeValue('adv-setting-genai-adaptive-decay', 'adv-genai-adaptive-decay-value', source.adaptive_decay || 0.9);
    if (document.getElementById('adv-setting-genai-adaptive-decay-enabled')) document.getElementById('adv-setting-genai-adaptive-decay-enabled').checked = source.adaptive_decay_enabled ?? true;
    setRangeValue('adv-setting-genai-presence-penalty', 'adv-genai-presence-penalty-value', source.presence_penalty ?? 0);
    if (document.getElementById('adv-setting-genai-force-reasoning')) document.getElementById('adv-setting-genai-force-reasoning').checked = source.force_reasoning ?? false;
    if (document.getElementById('adv-setting-genai-reasoning-open')) document.getElementById('adv-setting-genai-reasoning-open').value = source.reasoning_tag_open || '<think>';
    if (document.getElementById('adv-setting-genai-reasoning-close')) document.getElementById('adv-setting-genai-reasoning-close').value = source.reasoning_tag_close || '</think>';
    
    const genaiDryEnabled = source.dry_multiplier_enabled ?? false;
    if (document.getElementById('adv-setting-genai-dry-enabled')) {
      document.getElementById('adv-setting-genai-dry-enabled').checked = genaiDryEnabled;
      const ctrls = document.getElementById('genai-dry-sampler-controls');
      if (ctrls) ctrls.style.display = genaiDryEnabled ? 'flex' : 'none';
    }
    setRangeValue('adv-setting-genai-dry-multiplier', 'adv-genai-dry-multiplier-value', source.dry_multiplier ?? 0.8);
    setRangeValue('adv-setting-genai-dry-base', 'adv-genai-dry-base-value', source.dry_base ?? 1.75);
    setRangeValue('adv-setting-genai-dry-allowed-length', 'adv-genai-dry-allowed-length-value', source.dry_allowed_length ?? 2);
    const genaiBreakersInput = document.getElementById('adv-setting-genai-dry-sequence-breakers');
    if (genaiBreakersInput) {
      const genaiBreakersVal = source.dry_sequence_breakers || ["\n", ":", "\"", "*"];
      genaiBreakersInput.value = typeof genaiBreakersVal === 'string' ? genaiBreakersVal : JSON.stringify(genaiBreakersVal);
    }

    const genaiSystemPromptEl = document.getElementById('adv-setting-genai-system-prompt');
    if (genaiSystemPromptEl) {
      genaiSystemPromptEl.value = source.genai_system_prompt_addition ?? '';
    }

    applyExtendedSamplersToUI(source, true);
  } else {
    currentSettings.active_generation_preset_id = presetId;
    isGenerationPresetSync = preset.is_sync ?? true;
    currentGenerationPresetMode = preset.preset_mode || 'none';
    if (isGenerationPresetSync) currentGenerationPresetMode = 'none';
    if (typeof updateGenerationPresetModeUI === 'function') updateGenerationPresetModeUI();

    const source = (!isGenerationPresetSync && currentGenerationPresetMode === 'thinking' && preset.thinking_settings) 
      ? preset.thinking_settings 
      : preset;

    if (source.completion_mode) {
      const el = document.getElementById('adv-setting-completion-mode');
      if (el) {
        el.value = source.completion_mode;
        const grp = document.getElementById('text-completion-templates-group');
        if (grp) grp.style.display = source.completion_mode === 'text_completion' ? 'flex' : 'none';
      }
    }
    if (source.active_instruct_template_id) {
      const el = document.getElementById('adv-setting-instruct-template-select');
      if (el) el.value = source.active_instruct_template_id;
    }
    if (source.active_context_template_id) {
      const el = document.getElementById('adv-setting-context-template-select');
      if (el) el.value = source.active_context_template_id;
    }
    setRangeValue('adv-setting-max-tokens', 'adv-max-tokens-value', source.max_tokens);
    setRangeValue('adv-setting-temperature', 'adv-temperature-value', source.temperature);
    setRangeValue('adv-setting-top-p', 'adv-top-p-value', source.top_p);
    setRangeValue('adv-setting-top-k', 'adv-top-k-value', source.top_k);
    setRangeValue('adv-setting-rep-penalty', 'adv-rep-penalty-value', source.rep_penalty);
    setRangeValue('adv-setting-smoothing-factor', 'adv-smoothing-factor-value', source.smoothing_factor || 0);
    setRangeValue('adv-setting-min-p', 'adv-min-p-value', source.min_p || 0.05);
    if (document.getElementById('adv-setting-min-p-enabled')) document.getElementById('adv-setting-min-p-enabled').checked = source.min_p_enabled ?? true;
    setRangeValue('adv-setting-adaptive-target', 'adv-adaptive-target-value', source.adaptive_target || 0.8);
    if (document.getElementById('adv-setting-adaptive-target-enabled')) document.getElementById('adv-setting-adaptive-target-enabled').checked = source.adaptive_target_enabled ?? true;
    setRangeValue('adv-setting-adaptive-decay', 'adv-adaptive-decay-value', source.adaptive_decay || 0.9);
    if (document.getElementById('adv-setting-adaptive-decay-enabled')) document.getElementById('adv-setting-adaptive-decay-enabled').checked = source.adaptive_decay_enabled ?? true;
    setRangeValue('adv-setting-presence-penalty', 'adv-presence-penalty-value', source.presence_penalty ?? 0);
    if (document.getElementById('adv-setting-force-reasoning')) document.getElementById('adv-setting-force-reasoning').checked = source.force_reasoning ?? false;
    if (document.getElementById('adv-setting-reasoning-open')) document.getElementById('adv-setting-reasoning-open').value = source.reasoning_tag_open || '<think>';
    if (document.getElementById('adv-setting-reasoning-close')) document.getElementById('adv-setting-reasoning-close').value = source.reasoning_tag_close || '</think>';
    
    const dryEnabled = source.dry_multiplier_enabled ?? false;
    if (document.getElementById('adv-setting-dry-enabled')) {
      document.getElementById('adv-setting-dry-enabled').checked = dryEnabled;
      const ctrls = document.getElementById('dry-sampler-controls');
      if (ctrls) ctrls.style.display = dryEnabled ? 'flex' : 'none';
    }
    setRangeValue('adv-setting-dry-multiplier', 'adv-dry-multiplier-value', source.dry_multiplier ?? 0.8);
    setRangeValue('adv-setting-dry-base', 'adv-dry-base-value', source.dry_base ?? 1.75);
    setRangeValue('adv-setting-dry-allowed-length', 'adv-dry-allowed-length-value', source.dry_allowed_length ?? 2);
    const breakersInput = document.getElementById('adv-setting-dry-sequence-breakers');
    if (breakersInput) {
      const breakersVal = source.dry_sequence_breakers || ["\n", ":", "\"", "*"];
      breakersInput.value = typeof breakersVal === 'string' ? breakersVal : JSON.stringify(breakersVal);
    }

    applyExtendedSamplersToUI(source, false);
  }
}

function saveAsNewGenerationPreset(isGenAI) {
  const name = window.prompt("Enter name for new preset:", "Custom Preset");
  if (!name) return;
  
  const id = 'custom_gen_' + Date.now();
  const preset = { id, name };
  
  if (isGenAI) {
    preset.is_sync = true;
    isGenAIPresetSync = true;
    currentGenAIPresetMode = 'none';
    if (typeof updateGenAIPresetModeUI === 'function') updateGenAIPresetModeUI();
    preset.completion_mode = document.getElementById('adv-setting-genai-completion-mode')?.value || 'chat_completion';
    preset.active_instruct_template_id = document.getElementById('adv-setting-genai-instruct-template-select')?.value || 'gemma2';
    preset.active_context_template_id = document.getElementById('adv-setting-genai-context-template-select')?.value || 'gemma2';
    preset.max_tokens = parseInt(document.getElementById('adv-setting-genai-max-tokens').value);
    preset.temperature = parseFloat(document.getElementById('adv-setting-genai-temperature').value);
    preset.top_p = parseFloat(document.getElementById('adv-setting-genai-top-p').value);
    preset.top_k = parseInt(document.getElementById('adv-setting-genai-top-k').value);
    preset.rep_penalty = parseFloat(document.getElementById('adv-setting-genai-rep-penalty').value);
    preset.smoothing_factor = parseFloat(document.getElementById('adv-setting-genai-smoothing-factor').value);
    preset.min_p = parseFloat(document.getElementById('adv-setting-genai-min-p').value);
    preset.min_p_enabled = document.getElementById('adv-setting-genai-min-p-enabled')?.checked ?? true;
    preset.adaptive_target = parseFloat(document.getElementById('adv-setting-genai-adaptive-target').value);
    preset.adaptive_target_enabled = document.getElementById('adv-setting-genai-adaptive-target-enabled')?.checked ?? true;
    preset.adaptive_decay = parseFloat(document.getElementById('adv-setting-genai-adaptive-decay').value);
    preset.adaptive_decay_enabled = document.getElementById('adv-setting-genai-adaptive-decay-enabled')?.checked ?? true;
    preset.presence_penalty = parseFloat(document.getElementById('adv-setting-genai-presence-penalty').value);
    preset.force_reasoning = document.getElementById('adv-setting-genai-force-reasoning')?.checked ?? false;
    preset.reasoning_tag_open = document.getElementById('adv-setting-genai-reasoning-open')?.value || '<think>';
    preset.reasoning_tag_close = document.getElementById('adv-setting-genai-reasoning-close')?.value || '</think>';
    preset.dry_multiplier_enabled = document.getElementById('adv-setting-genai-dry-enabled')?.checked ?? false;
    preset.dry_multiplier = parseFloat(document.getElementById('adv-setting-genai-dry-multiplier').value);
    preset.dry_base = parseFloat(document.getElementById('adv-setting-genai-dry-base').value);
    preset.dry_allowed_length = parseInt(document.getElementById('adv-setting-genai-dry-allowed-length').value);
    let breakers = document.getElementById('adv-setting-genai-dry-sequence-breakers')?.value || '["\\n", ":", "\\"", "*"]';
    try {
      preset.dry_sequence_breakers = JSON.parse(breakers);
    } catch (e) {
      preset.dry_sequence_breakers = ["\n", ":", "\"", "*"];
    }
    preset.genai_system_prompt_addition = document.getElementById('adv-setting-genai-system-prompt')?.value.trim() || '';
    Object.assign(preset, extractExtendedSamplersFromUI(true));
    currentSettings.active_genai_generation_preset_id = id;
  } else {
    preset.is_sync = true;
    isGenerationPresetSync = true;
    currentGenerationPresetMode = 'none';
    if (typeof updateGenerationPresetModeUI === 'function') updateGenerationPresetModeUI();
    preset.completion_mode = document.getElementById('adv-setting-completion-mode')?.value || 'chat_completion';
    preset.active_instruct_template_id = document.getElementById('adv-setting-instruct-template-select')?.value || 'gemma2';
    preset.active_context_template_id = document.getElementById('adv-setting-context-template-select')?.value || 'gemma2';
    preset.max_tokens = parseInt(document.getElementById('adv-setting-max-tokens').value);
    preset.temperature = parseFloat(document.getElementById('adv-setting-temperature').value);
    preset.top_p = parseFloat(document.getElementById('adv-setting-top-p').value);
    preset.top_k = parseInt(document.getElementById('adv-setting-top-k').value);
    preset.rep_penalty = parseFloat(document.getElementById('adv-setting-rep-penalty').value);
    preset.smoothing_factor = parseFloat(document.getElementById('adv-setting-smoothing-factor').value);
    preset.min_p = parseFloat(document.getElementById('adv-setting-min-p').value);
    preset.min_p_enabled = document.getElementById('adv-setting-min-p-enabled')?.checked ?? true;
    preset.adaptive_target = parseFloat(document.getElementById('adv-setting-adaptive-target').value);
    preset.adaptive_target_enabled = document.getElementById('adv-setting-adaptive-target-enabled')?.checked ?? true;
    preset.adaptive_decay = parseFloat(document.getElementById('adv-setting-adaptive-decay').value);
    preset.adaptive_decay_enabled = document.getElementById('adv-setting-adaptive-decay-enabled')?.checked ?? true;
    preset.presence_penalty = parseFloat(document.getElementById('adv-setting-presence-penalty').value);
    preset.force_reasoning = document.getElementById('adv-setting-force-reasoning')?.checked ?? false;
    preset.reasoning_tag_open = document.getElementById('adv-setting-reasoning-open')?.value || '<think>';
    preset.reasoning_tag_close = document.getElementById('adv-setting-reasoning-close')?.value || '</think>';
    preset.dry_multiplier_enabled = document.getElementById('adv-setting-dry-enabled')?.checked ?? false;
    preset.dry_multiplier = parseFloat(document.getElementById('adv-setting-dry-multiplier').value);
    preset.dry_base = parseFloat(document.getElementById('adv-setting-dry-base').value);
    preset.dry_allowed_length = parseInt(document.getElementById('adv-setting-dry-allowed-length').value);
    let breakers = document.getElementById('adv-setting-dry-sequence-breakers')?.value || '["\\n", ":", "\\"", "*"]';
    try {
      preset.dry_sequence_breakers = JSON.parse(breakers);
    } catch (e) {
      preset.dry_sequence_breakers = ["\n", ":", "\"", "*"];
    }
    Object.assign(preset, extractExtendedSamplersFromUI(false));
    currentSettings.active_generation_preset_id = id;
  }
  
  currentSettings.generation_presets.push(preset);
  renderGenerationPresetsUI();
}

async function deleteGenerationPreset(isGenAI) {
  const activeId = isGenAI ? currentSettings.active_genai_generation_preset_id : currentSettings.active_generation_preset_id;
  if (!activeId || activeId.startsWith('default') || activeId.startsWith('glm') || activeId.startsWith('qwen') || activeId.startsWith('gemma')) {
    showToast("Cannot delete default presets");
    return;
  }
  
  const confirm = await showConfirm('Delete Preset', 'Delete this generation preset?');
  if (confirm) {
    currentSettings.generation_presets = currentSettings.generation_presets.filter(p => p.id !== activeId);
    if (isGenAI) {
      currentSettings.active_genai_generation_preset_id = 'default';
      applyGenerationPreset('default', true);
    } else {
      currentSettings.active_generation_preset_id = 'default';
      applyGenerationPreset('default', false);
    }
    renderGenerationPresetsUI();
  }
}

async function resetGenerationPreset(isGenAI) {
  const activeId = isGenAI ? currentSettings.active_genai_generation_preset_id : currentSettings.active_generation_preset_id;
  if (!activeId || (!activeId.startsWith('default') && !activeId.startsWith('glm') && !activeId.startsWith('qwen') && !activeId.startsWith('gemma'))) {
    showToast("Only standard presets can be reset to default");
    return;
  }

  const stdDefaults = { typical_p: 1.0, typical_p_enabled: false, frequency_penalty: 0.0, frequency_penalty_enabled: false, top_a: 0.0, top_a_enabled: false, tfs: 1.0, tfs_enabled: false, mirostat_enabled: false, mirostat_mode: 0, mirostat_tau: 5.0, mirostat_eta: 0.1, xtc_enabled: false, xtc_threshold: 0.1, xtc_probability: 0.0, top_n_sigma_enabled: false, top_n_sigma: 0.0, rep_pen_range_enabled: false, rep_pen_range: 0, rep_pen_slope: 1.0, min_tokens_enabled: false, min_tokens: 0, guidance_scale_enabled: false, guidance_scale: 1.0, negative_prompt: '', ignore_eos: false, banned_strings: '', genai_system_prompt_addition: '' };

  const defaultPresets = [
    { id: 'default', name: 'Default', max_tokens: 2048, temperature: 0.7, top_p: 0.9, top_k: 40, rep_penalty: 1.0, smoothing_factor: 0, min_p: 0.05, min_p_enabled: true, adaptive_target: 0.8, adaptive_target_enabled: true, adaptive_decay: 0.9, adaptive_decay_enabled: true, presence_penalty: 0.0, force_reasoning: false, reasoning_tag_open: '<think>', reasoning_tag_close: '</think>', dry_multiplier_enabled: false, dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 2, dry_sequence_breakers: ["\n", ":", "\"", "*"], ...stdDefaults },
    { id: 'glm47flash', name: 'GLM 4.7 Flash (Creative)', max_tokens: 6000, temperature: 1.0, top_p: 0.95, top_k: 40, rep_penalty: 1.0, smoothing_factor: 0, min_p: 0.05, min_p_enabled: true, adaptive_target: 0.8, adaptive_target_enabled: false, adaptive_decay: 0.9, adaptive_decay_enabled: false, presence_penalty: 0.0, force_reasoning: false, reasoning_tag_open: '<think>', reasoning_tag_close: '</think>', dry_multiplier_enabled: false, dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 2, dry_sequence_breakers: ["\n", ":", "\"", "*"], ...stdDefaults },
    { id: 'glm46', name: 'GLM 4.6 (Unsloth)', max_tokens: 2048, temperature: 0.8, top_p: 0.6, top_k: 2, rep_penalty: 1.0, smoothing_factor: 0, min_p: 0.05, min_p_enabled: true, adaptive_target: 0.8, adaptive_target_enabled: true, adaptive_decay: 0.9, adaptive_decay_enabled: true, presence_penalty: 0.0, force_reasoning: false, reasoning_tag_open: '<think>', reasoning_tag_close: '</think>', dry_multiplier_enabled: false, dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 2, dry_sequence_breakers: ["\n", ":", "\"", "*"], ...stdDefaults },
    { id: 'qwen3', name: 'Qwen 3 (Unsloth)', max_tokens: 4000, temperature: 0.6, top_p: 0.95, top_k: 20, rep_penalty: 1.0, smoothing_factor: 0, min_p: 0.0, min_p_enabled: true, adaptive_target: 0.8, adaptive_target_enabled: false, adaptive_decay: 0.9, adaptive_decay_enabled: false, presence_penalty: 0.0, force_reasoning: false, reasoning_tag_open: '<think>', reasoning_tag_close: '</think>', dry_multiplier_enabled: false, dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 2, dry_sequence_breakers: ["\n", ":", "\"", "*"], ...stdDefaults },
    { id: 'qwen35stable', name: 'Qwen 3.5 MoE (stable)', max_tokens: 4000, temperature: 0.65, top_p: 0.95, top_k: 20, rep_penalty: 1.0, smoothing_factor: 0, min_p: 0.05, min_p_enabled: false, adaptive_target: 0.8, adaptive_target_enabled: false, adaptive_decay: 0.9, adaptive_decay_enabled: false, presence_penalty: 1.6, force_reasoning: false, reasoning_tag_open: '<think>', reasoning_tag_close: '</think>', dry_multiplier_enabled: false, dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 2, dry_sequence_breakers: ["\n", ":", "\"", "*"], ...stdDefaults },
    { id: 'qwen35official', name: 'Qwen 3.5 MoE (Official)', max_tokens: 4000, temperature: 1.0, top_p: 0.95, top_k: 20, rep_penalty: 1.0, smoothing_factor: 0, min_p: 0.05, min_p_enabled: false, adaptive_target: 0.8, adaptive_target_enabled: false, adaptive_decay: 0.9, adaptive_decay_enabled: false, presence_penalty: 1.5, force_reasoning: false, reasoning_tag_open: '<think>', reasoning_tag_close: '</think>', dry_multiplier_enabled: false, dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 2, dry_sequence_breakers: ["\n", ":", "\"", "*"], ...stdDefaults },
    { id: 'gemma4creative', name: 'Gemma 4 (Creative)', max_tokens: 3000, temperature: 1.5, top_p: 1.0, top_k: 64, rep_penalty: 1.0, smoothing_factor: 1.5, min_p: 0.05, min_p_enabled: false, adaptive_target: 0.8, adaptive_target_enabled: false, adaptive_decay: 0.9, adaptive_decay_enabled: false, presence_penalty: 0.0, force_reasoning: false, reasoning_tag_open: '<think>', reasoning_tag_close: '</think>', dry_multiplier_enabled: true, dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 2, dry_sequence_breakers: ["\n", ":", "\"", "*"], ...stdDefaults },
    { id: 'gemma4stable', name: 'Gemma 4 (Stable)', max_tokens: 3000, temperature: 1.0, top_p: 1.0, top_k: 64, rep_penalty: 1.1, smoothing_factor: 1.5, min_p: 0.05, min_p_enabled: true, adaptive_target: 0.4, adaptive_target_enabled: false, adaptive_decay: 0.9, adaptive_decay_enabled: false, presence_penalty: 0.0, force_reasoning: false, reasoning_tag_open: '<think>', reasoning_tag_close: '</think>', dry_multiplier_enabled: false, dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 2, dry_sequence_breakers: ["\n", ":", "\"", "*"], ...stdDefaults }
  ];

  const originalPreset = defaultPresets.find(p => p.id === activeId);
  if (originalPreset) {
    const confirm = await showConfirm('Reset Preset', 'Reset this preset to its standard values?');
    if (confirm) {
      const presetIndex = currentSettings.generation_presets.findIndex(p => p.id === activeId);
      if (presetIndex !== -1) {
        currentSettings.generation_presets[presetIndex] = { ...originalPreset };
        applyGenerationPreset(activeId, isGenAI);
        showToast('Preset reset to defaults');
      }
    }
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

function setupRangeInput(inputId, valueId, isGenAI = null) {
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
    
    if (isGenAI !== null) {
      updateActiveGenerationPreset(isGenAI);
    }
  });
}

function updateActiveGenerationPreset(isGenAI) {
  const activeId = isGenAI ? currentSettings.active_genai_generation_preset_id : currentSettings.active_generation_preset_id;
  if (!activeId || activeId.startsWith('default') || activeId.startsWith('glm') || activeId.startsWith('qwen') || activeId.startsWith('gemma')) return;

  const preset = currentSettings.generation_presets.find(p => p.id === activeId);
  if (!preset) return;

  if (isGenAI) {
    let target = preset;
    if (!preset.is_sync && currentGenAIPresetMode === 'thinking') {
      if (!preset.thinking_settings) preset.thinking_settings = {};
      target = preset.thinking_settings;
    }

    target.completion_mode = document.getElementById('adv-setting-genai-completion-mode')?.value || target.completion_mode;
    target.active_instruct_template_id = document.getElementById('adv-setting-genai-instruct-template-select')?.value || target.active_instruct_template_id;
    target.active_context_template_id = document.getElementById('adv-setting-genai-context-template-select')?.value || target.active_context_template_id;
    target.max_tokens = parseInt(document.getElementById('adv-setting-genai-max-tokens').value);
    target.temperature = parseFloat(document.getElementById('adv-setting-genai-temperature').value);
    target.top_p = parseFloat(document.getElementById('adv-setting-genai-top-p').value);
    target.top_k = parseInt(document.getElementById('adv-setting-genai-top-k').value);
    target.rep_penalty = parseFloat(document.getElementById('adv-setting-genai-rep-penalty').value);
    target.smoothing_factor = parseFloat(document.getElementById('adv-setting-genai-smoothing-factor').value);
    target.min_p = parseFloat(document.getElementById('adv-setting-genai-min-p').value);
    target.min_p_enabled = document.getElementById('adv-setting-genai-min-p-enabled')?.checked ?? true;
    target.adaptive_target = parseFloat(document.getElementById('adv-setting-genai-adaptive-target').value);
    target.adaptive_target_enabled = document.getElementById('adv-setting-genai-adaptive-target-enabled')?.checked ?? true;
    target.adaptive_decay = parseFloat(document.getElementById('adv-setting-genai-adaptive-decay').value);
    target.adaptive_decay_enabled = document.getElementById('adv-setting-genai-adaptive-decay-enabled')?.checked ?? true;
    target.presence_penalty = parseFloat(document.getElementById('adv-setting-genai-presence-penalty').value);
    target.force_reasoning = document.getElementById('adv-setting-genai-force-reasoning')?.checked ?? false;
    target.reasoning_tag_open = document.getElementById('adv-setting-genai-reasoning-open')?.value || '<think>';
    target.reasoning_tag_close = document.getElementById('adv-setting-genai-reasoning-close')?.value || '</think>';
    target.dry_multiplier_enabled = document.getElementById('adv-setting-genai-dry-enabled')?.checked ?? false;
    target.dry_multiplier = parseFloat(document.getElementById('adv-setting-genai-dry-multiplier').value);
    target.dry_base = parseFloat(document.getElementById('adv-setting-genai-dry-base').value);
    target.dry_allowed_length = parseInt(document.getElementById('adv-setting-genai-dry-allowed-length').value);
    let breakers = document.getElementById('adv-setting-genai-dry-sequence-breakers')?.value || '["\\n", ":", "\\"", "*"]';
    try {
      target.dry_sequence_breakers = JSON.parse(breakers);
    } catch (e) {
      target.dry_sequence_breakers = ["\n", ":", "\"", "*"];
    }
    target.genai_system_prompt_addition = document.getElementById('adv-setting-genai-system-prompt')?.value.trim() || '';
    Object.assign(target, extractExtendedSamplersFromUI(true));
    
    // Sync to other tab if it uses the same custom preset
    if (currentSettings.active_generation_preset_id === activeId) {
      if (document.getElementById('adv-setting-completion-mode')) document.getElementById('adv-setting-completion-mode').value = preset.completion_mode || 'chat_completion';
      if (document.getElementById('adv-setting-instruct-template-select')) document.getElementById('adv-setting-instruct-template-select').value = preset.active_instruct_template_id || 'gemma2';
      if (document.getElementById('adv-setting-context-template-select')) document.getElementById('adv-setting-context-template-select').value = preset.active_context_template_id || 'gemma2';
      setRangeValue('adv-setting-max-tokens', 'adv-max-tokens-value', preset.max_tokens);
      setRangeValue('adv-setting-temperature', 'adv-temperature-value', preset.temperature);
      setRangeValue('adv-setting-top-p', 'adv-top-p-value', preset.top_p);
      setRangeValue('adv-setting-top-k', 'adv-top-k-value', preset.top_k);
      setRangeValue('adv-setting-rep-penalty', 'adv-rep-penalty-value', preset.rep_penalty);
      setRangeValue('adv-setting-smoothing-factor', 'adv-smoothing-factor-value', preset.smoothing_factor || 0);
      setRangeValue('adv-setting-min-p', 'adv-min-p-value', preset.min_p || 0.05);
      if (document.getElementById('adv-setting-min-p-enabled')) document.getElementById('adv-setting-min-p-enabled').checked = preset.min_p_enabled ?? true;
      setRangeValue('adv-setting-adaptive-target', 'adv-adaptive-target-value', preset.adaptive_target || 0.8);
      if (document.getElementById('adv-setting-adaptive-target-enabled')) document.getElementById('adv-setting-adaptive-target-enabled').checked = preset.adaptive_target_enabled ?? true;
      setRangeValue('adv-setting-adaptive-decay', 'adv-adaptive-decay-value', preset.adaptive_decay || 0.9);
      if (document.getElementById('adv-setting-adaptive-decay-enabled')) document.getElementById('adv-setting-adaptive-decay-enabled').checked = preset.adaptive_decay_enabled ?? true;
      setRangeValue('adv-setting-presence-penalty', 'adv-presence-penalty-value', preset.presence_penalty ?? 0);
      if (document.getElementById('adv-setting-force-reasoning')) document.getElementById('adv-setting-force-reasoning').checked = preset.force_reasoning;
      if (document.getElementById('adv-setting-reasoning-open')) document.getElementById('adv-setting-reasoning-open').value = preset.reasoning_tag_open;
      if (document.getElementById('adv-setting-reasoning-close')) document.getElementById('adv-setting-reasoning-close').value = preset.reasoning_tag_close;
      if (document.getElementById('adv-setting-dry-enabled')) document.getElementById('adv-setting-dry-enabled').checked = preset.dry_multiplier_enabled ?? false;
      const ctrls = document.getElementById('dry-sampler-controls');
      if (ctrls) ctrls.style.display = (preset.dry_multiplier_enabled ?? false) ? 'flex' : 'none';
      setRangeValue('adv-setting-dry-multiplier', 'adv-dry-multiplier-value', preset.dry_multiplier ?? 0.8);
      setRangeValue('adv-setting-dry-base', 'adv-dry-base-value', preset.dry_base ?? 1.75);
      setRangeValue('adv-setting-dry-allowed-length', 'adv-dry-allowed-length-value', preset.dry_allowed_length ?? 2);
      const breakersInput = document.getElementById('adv-setting-dry-sequence-breakers');
      if (breakersInput) {
        breakersInput.value = typeof preset.dry_sequence_breakers === 'string' ? preset.dry_sequence_breakers : JSON.stringify(preset.dry_sequence_breakers || ["\n", ":", "\"", "*"]);
      }
      applyExtendedSamplersToUI(preset, false);
    }
  } else {
    let target = preset;
    if (!preset.is_sync && currentGenerationPresetMode === 'thinking') {
      if (!preset.thinking_settings) preset.thinking_settings = {};
      target = preset.thinking_settings;
    }

    target.completion_mode = document.getElementById('adv-setting-completion-mode')?.value || target.completion_mode;
    target.active_instruct_template_id = document.getElementById('adv-setting-instruct-template-select')?.value || target.active_instruct_template_id;
    target.active_context_template_id = document.getElementById('adv-setting-context-template-select')?.value || target.active_context_template_id;
    target.max_tokens = parseInt(document.getElementById('adv-setting-max-tokens').value);
    target.temperature = parseFloat(document.getElementById('adv-setting-temperature').value);
    target.top_p = parseFloat(document.getElementById('adv-setting-top-p').value);
    target.top_k = parseInt(document.getElementById('adv-setting-top-k').value);
    target.rep_penalty = parseFloat(document.getElementById('adv-setting-rep-penalty').value);
    target.smoothing_factor = parseFloat(document.getElementById('adv-setting-smoothing-factor').value);
    target.min_p = parseFloat(document.getElementById('adv-setting-min-p').value);
    target.min_p_enabled = document.getElementById('adv-setting-min-p-enabled')?.checked ?? true;
    target.adaptive_target = parseFloat(document.getElementById('adv-setting-adaptive-target').value);
    target.adaptive_target_enabled = document.getElementById('adv-setting-adaptive-target-enabled')?.checked ?? true;
    target.adaptive_decay = parseFloat(document.getElementById('adv-setting-adaptive-decay').value);
    target.adaptive_decay_enabled = document.getElementById('adv-setting-adaptive-decay-enabled')?.checked ?? true;
    target.presence_penalty = parseFloat(document.getElementById('adv-setting-presence-penalty').value);
    target.force_reasoning = document.getElementById('adv-setting-force-reasoning')?.checked ?? false;
    target.reasoning_tag_open = document.getElementById('adv-setting-reasoning-open')?.value || '<think>';
    target.reasoning_tag_close = document.getElementById('adv-setting-reasoning-close')?.value || '</think>';
    target.dry_multiplier_enabled = document.getElementById('adv-setting-dry-enabled')?.checked ?? false;
    target.dry_multiplier = parseFloat(document.getElementById('adv-setting-dry-multiplier').value);
    target.dry_base = parseFloat(document.getElementById('adv-setting-dry-base').value);
    target.dry_allowed_length = parseInt(document.getElementById('adv-setting-dry-allowed-length').value);
    let breakers = document.getElementById('adv-setting-dry-sequence-breakers')?.value || '["\\n", ":", "\\"", "*"]';
    try {
      target.dry_sequence_breakers = JSON.parse(breakers);
    } catch (e) {
      target.dry_sequence_breakers = ["\n", ":", "\"", "*"];
    }
    Object.assign(target, extractExtendedSamplersFromUI(false));
    
    // Sync to other tab if it uses the same custom preset
    if (currentSettings.active_genai_generation_preset_id === activeId) {
      if (document.getElementById('adv-setting-genai-completion-mode')) document.getElementById('adv-setting-genai-completion-mode').value = preset.completion_mode || 'chat_completion';
      if (document.getElementById('adv-setting-genai-instruct-template-select')) document.getElementById('adv-setting-genai-instruct-template-select').value = preset.active_instruct_template_id || 'gemma2';
      if (document.getElementById('adv-setting-genai-context-template-select')) document.getElementById('adv-setting-genai-context-template-select').value = preset.active_context_template_id || 'gemma2';
      setRangeValue('adv-setting-genai-max-tokens', 'adv-genai-max-tokens-value', preset.max_tokens);
      setRangeValue('adv-setting-genai-temperature', 'adv-genai-temperature-value', preset.temperature);
      setRangeValue('adv-setting-genai-top-p', 'adv-genai-top-p-value', preset.top_p);
      setRangeValue('adv-setting-genai-top-k', 'adv-genai-top-k-value', preset.top_k);
      setRangeValue('adv-setting-genai-rep-penalty', 'adv-genai-rep-penalty-value', preset.rep_penalty);
      setRangeValue('adv-setting-genai-smoothing-factor', 'adv-genai-smoothing-factor-value', preset.smoothing_factor || 0);
      setRangeValue('adv-setting-genai-min-p', 'adv-genai-min-p-value', preset.min_p || 0.05);
      if (document.getElementById('adv-setting-genai-min-p-enabled')) document.getElementById('adv-setting-genai-min-p-enabled').checked = preset.min_p_enabled ?? true;
      setRangeValue('adv-setting-genai-adaptive-target', 'adv-genai-adaptive-target-value', preset.adaptive_target || 0.8);
      if (document.getElementById('adv-setting-genai-adaptive-target-enabled')) document.getElementById('adv-setting-genai-adaptive-target-enabled').checked = preset.adaptive_target_enabled ?? true;
      setRangeValue('adv-setting-genai-adaptive-decay', 'adv-genai-adaptive-decay-value', preset.adaptive_decay || 0.9);
      if (document.getElementById('adv-setting-genai-adaptive-decay-enabled')) document.getElementById('adv-setting-genai-adaptive-decay-enabled').checked = preset.adaptive_decay_enabled ?? true;
      setRangeValue('adv-setting-genai-presence-penalty', 'adv-genai-presence-penalty-value', preset.presence_penalty ?? 0);
      if (document.getElementById('adv-setting-genai-force-reasoning')) document.getElementById('adv-setting-genai-force-reasoning').checked = preset.force_reasoning;
      if (document.getElementById('adv-setting-genai-reasoning-open')) document.getElementById('adv-setting-genai-reasoning-open').value = preset.reasoning_tag_open;
      if (document.getElementById('adv-setting-genai-reasoning-close')) document.getElementById('adv-setting-genai-reasoning-close').value = preset.reasoning_tag_close;
      if (document.getElementById('adv-setting-genai-dry-enabled')) document.getElementById('adv-setting-genai-dry-enabled').checked = preset.dry_multiplier_enabled ?? false;
      const ctrls = document.getElementById('genai-dry-sampler-controls');
      if (ctrls) ctrls.style.display = (preset.dry_multiplier_enabled ?? false) ? 'flex' : 'none';
      setRangeValue('adv-setting-genai-dry-multiplier', 'adv-genai-dry-multiplier-value', preset.dry_multiplier ?? 0.8);
      setRangeValue('adv-setting-genai-dry-base', 'adv-genai-dry-base-value', preset.dry_base ?? 1.75);
      setRangeValue('adv-setting-genai-dry-allowed-length', 'adv-genai-dry-allowed-length-value', preset.dry_allowed_length ?? 2);
      const breakersInput = document.getElementById('adv-setting-genai-dry-sequence-breakers');
      if (breakersInput) {
        breakersInput.value = typeof preset.dry_sequence_breakers === 'string' ? preset.dry_sequence_breakers : JSON.stringify(preset.dry_sequence_breakers || ["\n", ":", "\"", "*"]);
      }
      applyExtendedSamplersToUI(preset, true);
    }
  }
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
    smoothing_factor: parseFloat(document.getElementById('adv-setting-smoothing-factor').value),
    min_p: parseFloat(document.getElementById('adv-setting-min-p').value),
    min_p_enabled: document.getElementById('adv-setting-min-p-enabled') ? document.getElementById('adv-setting-min-p-enabled').checked : true,
    adaptive_target: parseFloat(document.getElementById('adv-setting-adaptive-target').value),
    adaptive_target_enabled: document.getElementById('adv-setting-adaptive-target-enabled') ? document.getElementById('adv-setting-adaptive-target-enabled').checked : true,
    adaptive_decay: parseFloat(document.getElementById('adv-setting-adaptive-decay').value),
    adaptive_decay_enabled: document.getElementById('adv-setting-adaptive-decay-enabled') ? document.getElementById('adv-setting-adaptive-decay-enabled').checked : true,
    presence_penalty: parseFloat(document.getElementById('adv-setting-presence-penalty').value),
    dry_multiplier_enabled: document.getElementById('adv-setting-dry-enabled') ? document.getElementById('adv-setting-dry-enabled').checked : false,
    dry_multiplier: parseFloat(document.getElementById('adv-setting-dry-multiplier').value),
    dry_base: parseFloat(document.getElementById('adv-setting-dry-base').value),
    dry_allowed_length: parseInt(document.getElementById('adv-setting-dry-allowed-length').value),
    dry_sequence_breakers: (() => {
      let breakers = document.getElementById('adv-setting-dry-sequence-breakers')?.value || '["\\n", ":", "\\"", "*"]';
      try {
        return JSON.parse(breakers);
      } catch (e) {
        return ["\n", ":", "\"", "*"];
      }
    })(),
    active_generation_preset_id: currentSettings.active_generation_preset_id,

    genai_max_tokens: parseInt(document.getElementById('adv-setting-genai-max-tokens').value),
    genai_temperature: parseFloat(document.getElementById('adv-setting-genai-temperature').value),
    genai_top_p: parseFloat(document.getElementById('adv-setting-genai-top-p').value),
    genai_top_k: parseInt(document.getElementById('adv-setting-genai-top-k').value),
    genai_rep_penalty: parseFloat(document.getElementById('adv-setting-genai-rep-penalty').value),
    genai_smoothing_factor: parseFloat(document.getElementById('adv-setting-genai-smoothing-factor').value),
    genai_min_p: parseFloat(document.getElementById('adv-setting-genai-min-p').value),
    genai_min_p_enabled: document.getElementById('adv-setting-genai-min-p-enabled') ? document.getElementById('adv-setting-genai-min-p-enabled').checked : true,
    genai_adaptive_target: parseFloat(document.getElementById('adv-setting-genai-adaptive-target').value),
    genai_adaptive_target_enabled: document.getElementById('adv-setting-genai-adaptive-target-enabled') ? document.getElementById('adv-setting-genai-adaptive-target-enabled').checked : true,
    genai_adaptive_decay: parseFloat(document.getElementById('adv-setting-genai-adaptive-decay').value),
    genai_adaptive_decay_enabled: document.getElementById('adv-setting-genai-adaptive-decay-enabled') ? document.getElementById('adv-setting-genai-adaptive-decay-enabled').checked : true,
    genai_presence_penalty: parseFloat(document.getElementById('adv-setting-genai-presence-penalty').value),
    genai_dry_multiplier_enabled: document.getElementById('adv-setting-genai-dry-enabled') ? document.getElementById('adv-setting-genai-dry-enabled').checked : false,
    genai_dry_multiplier: parseFloat(document.getElementById('adv-setting-genai-dry-multiplier').value),
    genai_dry_base: parseFloat(document.getElementById('adv-setting-genai-dry-base').value),
    genai_dry_allowed_length: parseInt(document.getElementById('adv-setting-genai-dry-allowed-length').value),
    genai_dry_sequence_breakers: (() => {
      let breakers = document.getElementById('adv-setting-genai-dry-sequence-breakers')?.value || '["\\n", ":", "\\"", "*"]';
      try {
        return JSON.parse(breakers);
      } catch (e) {
        return ["\n", ":", "\"", "*"];
      }
    })(),
    active_genai_generation_preset_id: currentSettings.active_genai_generation_preset_id,
    genai_system_prompt_addition: document.getElementById('adv-setting-genai-system-prompt') ? document.getElementById('adv-setting-genai-system-prompt').value.trim() : (currentSettings.genai_system_prompt_addition || ""),
    
    force_reasoning: document.getElementById('adv-setting-force-reasoning') ? document.getElementById('adv-setting-force-reasoning').checked : !!currentSettings.force_reasoning,
    reasoning_tag_open: document.getElementById('adv-setting-reasoning-open') ? document.getElementById('adv-setting-reasoning-open').value : (currentSettings.reasoning_tag_open || '<think>'),
    reasoning_tag_close: document.getElementById('adv-setting-reasoning-close') ? document.getElementById('adv-setting-reasoning-close').value : (currentSettings.reasoning_tag_close || '</think>'),

    genai_force_reasoning: document.getElementById('adv-setting-genai-force-reasoning') ? document.getElementById('adv-setting-genai-force-reasoning').checked : !!currentSettings.genai_force_reasoning,
    genai_reasoning_tag_open: document.getElementById('adv-setting-genai-reasoning-open') ? document.getElementById('adv-setting-genai-reasoning-open').value : (currentSettings.genai_reasoning_tag_open || '<think>'),
    genai_reasoning_tag_close: document.getElementById('adv-setting-genai-reasoning-close') ? document.getElementById('adv-setting-genai-reasoning-close').value : (currentSettings.genai_reasoning_tag_close || '</think>'),
    
    completion_mode: document.getElementById('adv-setting-completion-mode')?.value || 'chat_completion',
    active_instruct_template_id: document.getElementById('adv-setting-instruct-template-select')?.value || 'gemma2',
    active_context_template_id: document.getElementById('adv-setting-context-template-select')?.value || 'gemma2',

    typical_p_enabled: document.getElementById('adv-setting-typical-p-enabled')?.checked ?? false,
    typical_p: parseFloat(document.getElementById('adv-setting-typical-p')?.value ?? 1.0),
    frequency_penalty_enabled: document.getElementById('adv-setting-frequency-penalty-enabled')?.checked ?? false,
    frequency_penalty: parseFloat(document.getElementById('adv-setting-frequency-penalty')?.value ?? 0.0),
    top_a_enabled: document.getElementById('adv-setting-top-a-enabled')?.checked ?? false,
    top_a: parseFloat(document.getElementById('adv-setting-top-a')?.value ?? 0.0),
    tfs_enabled: document.getElementById('adv-setting-tfs-enabled')?.checked ?? false,
    tfs: parseFloat(document.getElementById('adv-setting-tfs')?.value ?? 1.0),
    mirostat_enabled: document.getElementById('adv-setting-mirostat-enabled')?.checked ?? false,
    mirostat_mode: parseInt(document.getElementById('adv-setting-mirostat-mode')?.value ?? 0),
    mirostat_tau: parseFloat(document.getElementById('adv-setting-mirostat-tau')?.value ?? 5.0),
    mirostat_eta: parseFloat(document.getElementById('adv-setting-mirostat-eta')?.value ?? 0.1),
    xtc_enabled: document.getElementById('adv-setting-xtc-enabled')?.checked ?? false,
    xtc_threshold: parseFloat(document.getElementById('adv-setting-xtc-threshold')?.value ?? 0.1),
    xtc_probability: parseFloat(document.getElementById('adv-setting-xtc-probability')?.value ?? 0.0),
    top_n_sigma_enabled: document.getElementById('adv-setting-top-n-sigma-enabled')?.checked ?? false,
    top_n_sigma: parseFloat(document.getElementById('adv-setting-top-n-sigma')?.value ?? 0.0),
    rep_pen_range_enabled: document.getElementById('adv-setting-rep-pen-range-enabled')?.checked ?? false,
    rep_pen_range: parseInt(document.getElementById('adv-setting-rep-pen-range')?.value ?? 0),
    rep_pen_slope: parseFloat(document.getElementById('adv-setting-rep-pen-slope')?.value ?? 1.0),
    min_tokens_enabled: document.getElementById('adv-setting-min-tokens-enabled')?.checked ?? false,
    min_tokens: parseInt(document.getElementById('adv-setting-min-tokens')?.value ?? 0),
    guidance_scale_enabled: document.getElementById('adv-setting-guidance-scale-enabled')?.checked ?? false,
    guidance_scale: parseFloat(document.getElementById('adv-setting-guidance-scale')?.value ?? 1.0),
    negative_prompt: document.getElementById('adv-setting-negative-prompt')?.value || '',
    ignore_eos_enabled: document.getElementById('adv-setting-ignore-eos')?.checked ?? false,
    ignore_eos: document.getElementById('adv-setting-ignore-eos')?.checked ?? false,
    banned_strings: document.getElementById('adv-setting-banned-strings')?.value || '',

    genai_completion_mode: document.getElementById('adv-setting-genai-completion-mode')?.value || 'chat_completion',
    genai_active_instruct_template_id: document.getElementById('adv-setting-genai-instruct-template-select')?.value || 'gemma2',
    genai_active_context_template_id: document.getElementById('adv-setting-genai-context-template-select')?.value || 'gemma2',

    genai_typical_p_enabled: document.getElementById('adv-setting-genai-typical-p-enabled')?.checked ?? false,
    genai_typical_p: parseFloat(document.getElementById('adv-setting-genai-typical-p')?.value ?? 1.0),
    genai_frequency_penalty_enabled: document.getElementById('adv-setting-genai-frequency-penalty-enabled')?.checked ?? false,
    genai_frequency_penalty: parseFloat(document.getElementById('adv-setting-genai-frequency-penalty')?.value ?? 0.0),
    genai_top_a_enabled: document.getElementById('adv-setting-genai-top-a-enabled')?.checked ?? false,
    genai_top_a: parseFloat(document.getElementById('adv-setting-genai-top-a')?.value ?? 0.0),
    genai_tfs_enabled: document.getElementById('adv-setting-genai-tfs-enabled')?.checked ?? false,
    genai_tfs: parseFloat(document.getElementById('adv-setting-genai-tfs')?.value ?? 1.0),
    genai_mirostat_enabled: document.getElementById('adv-setting-genai-mirostat-enabled')?.checked ?? false,
    genai_mirostat_mode: parseInt(document.getElementById('adv-setting-genai-mirostat-mode')?.value ?? 0),
    genai_mirostat_tau: parseFloat(document.getElementById('adv-setting-genai-mirostat-tau')?.value ?? 5.0),
    genai_mirostat_eta: parseFloat(document.getElementById('adv-setting-genai-mirostat-eta')?.value ?? 0.1),
    genai_xtc_enabled: document.getElementById('adv-setting-genai-xtc-enabled')?.checked ?? false,
    genai_xtc_threshold: parseFloat(document.getElementById('adv-setting-genai-xtc-threshold')?.value ?? 0.1),
    genai_xtc_probability: parseFloat(document.getElementById('adv-setting-genai-xtc-probability')?.value ?? 0.0),
    genai_top_n_sigma_enabled: document.getElementById('adv-setting-genai-top-n-sigma-enabled')?.checked ?? false,
    genai_top_n_sigma: parseFloat(document.getElementById('adv-setting-genai-top-n-sigma')?.value ?? 0.0),
    genai_rep_pen_range_enabled: document.getElementById('adv-setting-genai-rep-pen-range-enabled')?.checked ?? false,
    genai_rep_pen_range: parseInt(document.getElementById('adv-setting-genai-rep-pen-range')?.value ?? 0),
    genai_rep_pen_slope: parseFloat(document.getElementById('adv-setting-genai-rep-pen-slope')?.value ?? 1.0),
    genai_min_tokens_enabled: document.getElementById('adv-setting-genai-min-tokens-enabled')?.checked ?? false,
    genai_min_tokens: parseInt(document.getElementById('adv-setting-genai-min-tokens')?.value ?? 0),
    genai_guidance_scale_enabled: document.getElementById('adv-setting-genai-guidance-scale-enabled')?.checked ?? false,
    genai_guidance_scale: parseFloat(document.getElementById('adv-setting-genai-guidance-scale')?.value ?? 1.0),
    genai_negative_prompt: document.getElementById('adv-setting-genai-negative-prompt')?.value || '',
    genai_ignore_eos_enabled: document.getElementById('adv-setting-genai-ignore-eos')?.checked ?? false,
    genai_ignore_eos: document.getElementById('adv-setting-genai-ignore-eos')?.checked ?? false,
    genai_banned_strings: document.getElementById('adv-setting-genai-banned-strings')?.value || '',

    instruct_templates: currentSettings.instruct_templates,
    context_templates: currentSettings.context_templates,
    generation_presets: currentSettings.generation_presets,

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
  
  // Sync sidebar settings if it's open
  window.dispatchEvent(new CustomEvent('settings-updated'));
  
  closeWindow(modal);
  showToast('Advanced settings saved');
}

let editingContextTemplateId = 'gemma2';
let editingInstructTemplateId = 'gemma2';

function renderFormattingTemplatesUI() {
  const ctxSelect = document.getElementById('adv-fmt-context-select');
  const instSelect = document.getElementById('adv-fmt-instruct-select');
  const genCtxSelect = document.getElementById('adv-setting-context-template-select');
  const genInstSelect = document.getElementById('adv-setting-instruct-template-select');
  const genaiCtxSelect = document.getElementById('adv-setting-genai-context-template-select');
  const genaiInstSelect = document.getElementById('adv-setting-genai-instruct-template-select');

  if (ctxSelect) {
    ctxSelect.innerHTML = '';
    if (genCtxSelect) genCtxSelect.innerHTML = '';
    if (genaiCtxSelect) genaiCtxSelect.innerHTML = '';

    (currentSettings.context_templates || []).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      ctxSelect.appendChild(opt);

      if (genCtxSelect) {
        const opt2 = document.createElement('option');
        opt2.value = t.id;
        opt2.textContent = t.name;
        genCtxSelect.appendChild(opt2);
      }
      if (genaiCtxSelect) {
        const opt3 = document.createElement('option');
        opt3.value = t.id;
        opt3.textContent = t.name;
        genaiCtxSelect.appendChild(opt3);
      }
    });

    ctxSelect.value = editingContextTemplateId;
    if (genCtxSelect) genCtxSelect.value = currentSettings.active_context_template_id || 'gemma2';
    if (genaiCtxSelect) genaiCtxSelect.value = currentSettings.genai_active_context_template_id || 'gemma2';
  }

  if (instSelect) {
    instSelect.innerHTML = '';
    if (genInstSelect) genInstSelect.innerHTML = '';
    if (genaiInstSelect) genaiInstSelect.innerHTML = '';

    (currentSettings.instruct_templates || []).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      instSelect.appendChild(opt);

      if (genInstSelect) {
        const opt2 = document.createElement('option');
        opt2.value = t.id;
        opt2.textContent = t.name;
        genInstSelect.appendChild(opt2);
      }
      if (genaiInstSelect) {
        const opt3 = document.createElement('option');
        opt3.value = t.id;
        opt3.textContent = t.name;
        genaiInstSelect.appendChild(opt3);
      }
    });

    instSelect.value = editingInstructTemplateId;
    if (genInstSelect) genInstSelect.value = currentSettings.active_instruct_template_id || 'gemma2';
    if (genaiInstSelect) genaiInstSelect.value = currentSettings.genai_active_instruct_template_id || 'gemma2';
  }

  loadContextTemplateToEditor(editingContextTemplateId);
  loadInstructTemplateToEditor(editingInstructTemplateId);
}

function loadContextTemplateToEditor(id) {
  const t = (currentSettings.context_templates || []).find(tmpl => tmpl.id === id);
  if (!t) return;
  editingContextTemplateId = id;
  
  if (document.getElementById('adv-fmt-context-name')) document.getElementById('adv-fmt-context-name').value = t.name || '';
  if (document.getElementById('adv-fmt-story-string')) document.getElementById('adv-fmt-story-string').value = t.story_string || '';
  if (document.getElementById('adv-fmt-context-position')) document.getElementById('adv-fmt-context-position').value = t.position || 'top';
  if (document.getElementById('adv-fmt-example-separator')) document.getElementById('adv-fmt-example-separator').value = t.example_separator || '***';
  if (document.getElementById('adv-fmt-always-add-name')) document.getElementById('adv-fmt-always-add-name').checked = !!t.always_add_character_name;
  if (document.getElementById('adv-fmt-collapse-newlines')) document.getElementById('adv-fmt-collapse-newlines').checked = !!t.collapse_newlines;
  if (document.getElementById('adv-fmt-trim-spaces')) document.getElementById('adv-fmt-trim-spaces').checked = !!t.trim_spaces;
  if (document.getElementById('adv-fmt-separators-as-stop')) document.getElementById('adv-fmt-separators-as-stop').checked = !!t.separators_as_stop;
  if (document.getElementById('adv-fmt-names-as-stop')) document.getElementById('adv-fmt-names-as-stop').checked = !!t.names_as_stop;

  const defaultContextIds = ['gemma2', 'mistral', 'standard'];
  const isDefault = defaultContextIds.includes(id);
  if (document.getElementById('adv-fmt-context-name')) document.getElementById('adv-fmt-context-name').disabled = isDefault;
}

function loadInstructTemplateToEditor(id) {
  const t = (currentSettings.instruct_templates || []).find(tmpl => tmpl.id === id);
  if (!t) return;
  editingInstructTemplateId = id;

  if (document.getElementById('adv-fmt-instruct-name')) document.getElementById('adv-fmt-instruct-name').value = t.name || '';
  if (document.getElementById('adv-fmt-activation-regex')) document.getElementById('adv-fmt-activation-regex').value = t.activation_regex || '';
  if (document.getElementById('adv-fmt-wrap-newlines')) document.getElementById('adv-fmt-wrap-newlines').checked = !!t.wrap_sequences_with_newline;
  if (document.getElementById('adv-fmt-replace-macro')) document.getElementById('adv-fmt-replace-macro').checked = !!t.replace_macro_in_sequences;
  if (document.getElementById('adv-fmt-seq-as-stop')) document.getElementById('adv-fmt-seq-as-stop').checked = !!t.sequences_as_stop_strings;
  if (document.getElementById('adv-fmt-include-names')) document.getElementById('adv-fmt-include-names').value = t.include_names || 'none';

  if (document.getElementById('adv-fmt-user-prefix')) document.getElementById('adv-fmt-user-prefix').value = t.user_prefix || '';
  if (document.getElementById('adv-fmt-user-suffix')) document.getElementById('adv-fmt-user-suffix').value = t.user_suffix || '';
  if (document.getElementById('adv-fmt-assistant-prefix')) document.getElementById('adv-fmt-assistant-prefix').value = t.assistant_prefix || '';
  if (document.getElementById('adv-fmt-assistant-suffix')) document.getElementById('adv-fmt-assistant-suffix').value = t.assistant_suffix || '';
  if (document.getElementById('adv-fmt-story-prefix')) document.getElementById('adv-fmt-story-prefix').value = t.story_prefix || '';
  if (document.getElementById('adv-fmt-story-suffix')) document.getElementById('adv-fmt-story-suffix').value = t.story_suffix || '';

  const defaultInstructIds = ['gemma2', 'llama3', 'chatml', 'alpaca', 'alpaca_input', 'alpaca_simple', 'vicuna', 'mistral'];
  const isDefault = defaultInstructIds.includes(id);
  if (document.getElementById('adv-fmt-instruct-name')) document.getElementById('adv-fmt-instruct-name').disabled = isDefault;
}

function setupFormattingTemplateListeners() {
  document.getElementById('adv-fmt-context-select')?.addEventListener('change', (e) => loadContextTemplateToEditor(e.target.value));
  document.getElementById('adv-fmt-instruct-select')?.addEventListener('change', (e) => loadInstructTemplateToEditor(e.target.value));

  document.getElementById('btn-add-context-template')?.addEventListener('click', () => {
    const name = window.prompt("Enter name for new Context Template:", "Custom Context");
    if (!name) return;
    const id = 'custom_ctx_' + Date.now();
    const newTmpl = {
      id,
      name,
      story_string: '{{#if system}}{{system}}\n\n{{/if}}{{#if description}}{{description}}\n\n{{/if}}{{trim}}',
      position: 'top',
      example_separator: '***',
      chat_start: '',
      always_add_character_name: true,
      collapse_newlines: false,
      trim_spaces: true,
      separators_as_stop: false,
      names_as_stop: true
    };
    currentSettings.context_templates.push(newTmpl);
    editingContextTemplateId = id;
    renderFormattingTemplatesUI();
  });

  document.getElementById('btn-add-instruct-template')?.addEventListener('click', () => {
    const name = window.prompt("Enter name for new Instruct Template:", "Custom Instruct");
    if (!name) return;
    const id = 'custom_inst_' + Date.now();
    const newTmpl = {
      id,
      name,
      activation_regex: '',
      wrap_sequences_with_newline: true,
      replace_macro_in_sequences: true,
      sequences_as_stop_strings: true,
      include_names: 'none',
      story_prefix: '<start_of_turn>user\n',
      story_suffix: '<end_of_turn>\n',
      user_prefix: '<start_of_turn>user\n',
      user_suffix: '<end_of_turn>\n',
      assistant_prefix: '<start_of_turn>model\n',
      assistant_suffix: '<end_of_turn>\n',
      system_prefix: '<start_of_turn>user\n',
      system_suffix: '<end_of_turn>\n'
    };
    currentSettings.instruct_templates.push(newTmpl);
    editingInstructTemplateId = id;
    renderFormattingTemplatesUI();
  });

  document.getElementById('btn-delete-context-template')?.addEventListener('click', async () => {
    const defaultContextIds = ['gemma2', 'mistral', 'standard'];
    if (defaultContextIds.includes(editingContextTemplateId)) {
      showToast("Cannot delete default template");
      return;
    }
    const confirm = await showConfirm('Delete Template', 'Delete this context template?');
    if (confirm) {
      currentSettings.context_templates = currentSettings.context_templates.filter(t => t.id !== editingContextTemplateId);
      editingContextTemplateId = 'gemma2';
      renderFormattingTemplatesUI();
    }
  });

  document.getElementById('btn-delete-instruct-template')?.addEventListener('click', async () => {
    const defaultInstructIds = ['gemma2', 'llama3', 'chatml', 'alpaca', 'alpaca_input', 'alpaca_simple', 'vicuna', 'mistral'];
    if (defaultInstructIds.includes(editingInstructTemplateId)) {
      showToast("Cannot delete default template");
      return;
    }
    const confirm = await showConfirm('Delete Template', 'Delete this instruct template?');
    if (confirm) {
      currentSettings.instruct_templates = currentSettings.instruct_templates.filter(t => t.id !== editingInstructTemplateId);
      editingInstructTemplateId = 'gemma2';
      renderFormattingTemplatesUI();
    }
  });

  // Live save for Context template editor
  const syncContextEditor = () => {
    const t = currentSettings.context_templates.find(tmpl => tmpl.id === editingContextTemplateId);
    if (!t) return;
    t.name = document.getElementById('adv-fmt-context-name')?.value || t.name;
    t.story_string = document.getElementById('adv-fmt-story-string')?.value || '';
    t.position = document.getElementById('adv-fmt-context-position')?.value || 'top';
    t.example_separator = document.getElementById('adv-fmt-example-separator')?.value || '***';
    t.always_add_character_name = !!document.getElementById('adv-fmt-always-add-name')?.checked;
    t.collapse_newlines = !!document.getElementById('adv-fmt-collapse-newlines')?.checked;
    t.trim_spaces = !!document.getElementById('adv-fmt-trim-spaces')?.checked;
    t.separators_as_stop = !!document.getElementById('adv-fmt-separators-as-stop')?.checked;
    t.names_as_stop = !!document.getElementById('adv-fmt-names-as-stop')?.checked;
  };

  ['adv-fmt-context-name', 'adv-fmt-story-string', 'adv-fmt-context-position', 'adv-fmt-example-separator', 'adv-fmt-always-add-name', 'adv-fmt-collapse-newlines', 'adv-fmt-trim-spaces', 'adv-fmt-separators-as-stop', 'adv-fmt-names-as-stop'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', syncContextEditor);
      el.addEventListener('change', syncContextEditor);
    }
  });

  // Live save for Instruct template editor
  const syncInstructEditor = () => {
    const t = currentSettings.instruct_templates.find(tmpl => tmpl.id === editingInstructTemplateId);
    if (!t) return;
    t.name = document.getElementById('adv-fmt-instruct-name')?.value || t.name;
    t.activation_regex = document.getElementById('adv-fmt-activation-regex')?.value || '';
    t.wrap_sequences_with_newline = !!document.getElementById('adv-fmt-wrap-newlines')?.checked;
    t.replace_macro_in_sequences = !!document.getElementById('adv-fmt-replace-macro')?.checked;
    t.sequences_as_stop_strings = !!document.getElementById('adv-fmt-seq-as-stop')?.checked;
    t.include_names = document.getElementById('adv-fmt-include-names')?.value || 'none';
    t.user_prefix = document.getElementById('adv-fmt-user-prefix')?.value || '';
    t.user_suffix = document.getElementById('adv-fmt-user-suffix')?.value || '';
    t.assistant_prefix = document.getElementById('adv-fmt-assistant-prefix')?.value || '';
    t.assistant_suffix = document.getElementById('adv-fmt-assistant-suffix')?.value || '';
    t.story_prefix = document.getElementById('adv-fmt-story-prefix')?.value || '';
    t.story_suffix = document.getElementById('adv-fmt-story-suffix')?.value || '';
  };

  ['adv-fmt-instruct-name', 'adv-fmt-activation-regex', 'adv-fmt-wrap-newlines', 'adv-fmt-replace-macro', 'adv-fmt-seq-as-stop', 'adv-fmt-include-names', 'adv-fmt-user-prefix', 'adv-fmt-user-suffix', 'adv-fmt-assistant-prefix', 'adv-fmt-assistant-suffix', 'adv-fmt-story-prefix', 'adv-fmt-story-suffix'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', syncInstructEditor);
      el.addEventListener('change', syncInstructEditor);
    }
  });
}
