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
  
  const addToggleListener = (id, isGenAI) => {
    document.getElementById(id)?.addEventListener('change', () => {
      updateActiveGenerationPreset(isGenAI);
    });
  };
  addToggleListener('adv-setting-min-p-enabled', false);
  addToggleListener('adv-setting-adaptive-target-enabled', false);
  addToggleListener('adv-setting-adaptive-decay-enabled', false);
  addToggleListener('adv-setting-force-reasoning', false);
  addToggleListener('adv-setting-genai-min-p-enabled', true);
  addToggleListener('adv-setting-genai-adaptive-target-enabled', true);
  addToggleListener('adv-setting-genai-adaptive-decay-enabled', true);
  addToggleListener('adv-setting-genai-force-reasoning', true);

  const addInputListener = (id, isGenAI) => {
    document.getElementById(id)?.addEventListener('input', () => {
      updateActiveGenerationPreset(isGenAI);
    });
  };
  addInputListener('adv-setting-reasoning-open', false);
  addInputListener('adv-setting-reasoning-close', false);
  addInputListener('adv-setting-genai-reasoning-open', true);
  addInputListener('adv-setting-genai-reasoning-close', true);

  // Generation Presets Management
  document.getElementById('generation-preset-select')?.addEventListener('change', (e) => applyGenerationPreset(e.target.value, false));
  document.getElementById('genai-preset-select')?.addEventListener('change', (e) => applyGenerationPreset(e.target.value, true));
  
  document.getElementById('btn-add-generation-preset')?.addEventListener('click', () => saveAsNewGenerationPreset(false));
  document.getElementById('btn-add-genai-preset')?.addEventListener('click', () => saveAsNewGenerationPreset(true));
  
  document.getElementById('btn-reset-generation-preset')?.addEventListener('click', () => resetGenerationPreset(false));
  document.getElementById('btn-reset-genai-preset')?.addEventListener('click', () => resetGenerationPreset(true));

  document.getElementById('btn-delete-generation-preset')?.addEventListener('click', () => deleteGenerationPreset(false));
  document.getElementById('btn-delete-genai-preset')?.addEventListener('click', () => deleteGenerationPreset(true));

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
  if (document.getElementById('adv-setting-genai-adaptive-decay-enabled')) document.getElementById('adv-setting-genai-adaptive-decay-enabled').checked = currentSettings.genai_adaptive_decay_enabled ?? true; // wait, let's keep the exact line but add the presence penalty loading below
  setRangeValue('adv-setting-genai-presence-penalty', 'adv-genai-presence-penalty-value', currentSettings.genai_presence_penalty ?? 0);

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

  // Load presets
  renderPresets();
  renderGenerationPresetsUI();

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

function applyGenerationPreset(presetId, isGenAI) {
  const preset = currentSettings.generation_presets.find(p => p.id === presetId);
  if (!preset) return;
  
  if (isGenAI) {
    currentSettings.active_genai_generation_preset_id = presetId;
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
    if (document.getElementById('adv-setting-genai-force-reasoning')) document.getElementById('adv-setting-genai-force-reasoning').checked = preset.force_reasoning ?? false;
    if (document.getElementById('adv-setting-genai-reasoning-open')) document.getElementById('adv-setting-genai-reasoning-open').value = preset.reasoning_tag_open || '<think>';
    if (document.getElementById('adv-setting-genai-reasoning-close')) document.getElementById('adv-setting-genai-reasoning-close').value = preset.reasoning_tag_close || '</think>';
  } else {
    currentSettings.active_generation_preset_id = presetId;
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
    if (document.getElementById('adv-setting-force-reasoning')) document.getElementById('adv-setting-force-reasoning').checked = preset.force_reasoning ?? false;
    if (document.getElementById('adv-setting-reasoning-open')) document.getElementById('adv-setting-reasoning-open').value = preset.reasoning_tag_open || '<think>';
    if (document.getElementById('adv-setting-reasoning-close')) document.getElementById('adv-setting-reasoning-close').value = preset.reasoning_tag_close || '</think>';
  }
}

function saveAsNewGenerationPreset(isGenAI) {
  const name = window.prompt("Enter name for new preset:", "Custom Preset");
  if (!name) return;
  
  const id = 'custom_gen_' + Date.now();
  const preset = { id, name };
  
  if (isGenAI) {
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
    currentSettings.active_genai_generation_preset_id = id;
  } else {
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
    currentSettings.active_generation_preset_id = id;
  }
  
  currentSettings.generation_presets.push(preset);
  renderGenerationPresetsUI();
}

async function deleteGenerationPreset(isGenAI) {
  const activeId = isGenAI ? currentSettings.active_genai_generation_preset_id : currentSettings.active_generation_preset_id;
  if (!activeId || activeId.startsWith('default') || activeId.startsWith('glm') || activeId.startsWith('qwen')) {
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
  if (!activeId || (!activeId.startsWith('default') && !activeId.startsWith('glm') && !activeId.startsWith('qwen'))) {
    showToast("Only standard presets can be reset to default");
    return;
  }

  const defaultPresets = [
    { id: 'default', name: 'Default', max_tokens: 2048, temperature: 0.7, top_p: 0.9, top_k: 40, rep_penalty: 1.0, smoothing_factor: 0, min_p: 0.05, min_p_enabled: true, adaptive_target: 0.8, adaptive_target_enabled: true, adaptive_decay: 0.9, adaptive_decay_enabled: true, presence_penalty: 0.0, force_reasoning: false, reasoning_tag_open: '<think>', reasoning_tag_close: '</think>' },
    { id: 'glm47flash', name: 'GLM 4.7 Flash (Creative)', max_tokens: 2048, temperature: 1.0, top_p: 0.95, top_k: 40, rep_penalty: 1.1, smoothing_factor: 1.5, min_p: 0.05, min_p_enabled: true, adaptive_target: 0.8, adaptive_target_enabled: true, adaptive_decay: 0.9, adaptive_decay_enabled: true, presence_penalty: 0.0, force_reasoning: false, reasoning_tag_open: '<think>', reasoning_tag_close: '</think>' },
    { id: 'glm46', name: 'GLM 4.6 (Unsloth)', max_tokens: 2048, temperature: 0.8, top_p: 0.6, top_k: 2, rep_penalty: 1.0, smoothing_factor: 0, min_p: 0.05, min_p_enabled: true, adaptive_target: 0.8, adaptive_target_enabled: true, adaptive_decay: 0.9, adaptive_decay_enabled: true, presence_penalty: 0.0, force_reasoning: false, reasoning_tag_open: '<think>', reasoning_tag_close: '</think>' },
    { id: 'qwen35stable', name: 'Qwen 3.5 MoE (stable)', max_tokens: 4000, temperature: 0.65, top_p: 0.95, top_k: 20, rep_penalty: 1.0, smoothing_factor: 0, min_p: 0.05, min_p_enabled: false, adaptive_target: 0.8, adaptive_target_enabled: false, adaptive_decay: 0.9, adaptive_decay_enabled: false, presence_penalty: 1.6, force_reasoning: false, reasoning_tag_open: '<think>', reasoning_tag_close: '</think>' },
    { id: 'qwen35official', name: 'Qwen 3.5 MoE (Official)', max_tokens: 4000, temperature: 1.0, top_p: 0.95, top_k: 20, rep_penalty: 1.0, smoothing_factor: 0, min_p: 0.05, min_p_enabled: false, adaptive_target: 0.8, adaptive_target_enabled: false, adaptive_decay: 0.9, adaptive_decay_enabled: false, presence_penalty: 1.5, force_reasoning: false, reasoning_tag_open: '<think>', reasoning_tag_close: '</think>' }
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
  if (!activeId || activeId.startsWith('default') || activeId.startsWith('glm') || activeId.startsWith('qwen')) return;

  const preset = currentSettings.generation_presets.find(p => p.id === activeId);
  if (!preset) return;

  if (isGenAI) {
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
    
    // Sync to other tab if it uses the same custom preset
    if (currentSettings.active_generation_preset_id === activeId) {
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
    }
  } else {
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
    
    // Sync to other tab if it uses the same custom preset
    if (currentSettings.active_genai_generation_preset_id === activeId) {
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
    active_genai_generation_preset_id: currentSettings.active_genai_generation_preset_id,
    genai_system_prompt_addition: document.getElementById('adv-setting-genai-system-prompt') ? document.getElementById('adv-setting-genai-system-prompt').value.trim() : (currentSettings.genai_system_prompt_addition || ""),
    
    force_reasoning: document.getElementById('adv-setting-force-reasoning') ? document.getElementById('adv-setting-force-reasoning').checked : !!currentSettings.force_reasoning,
    reasoning_tag_open: document.getElementById('adv-setting-reasoning-open') ? document.getElementById('adv-setting-reasoning-open').value : (currentSettings.reasoning_tag_open || '<think>'),
    reasoning_tag_close: document.getElementById('adv-setting-reasoning-close') ? document.getElementById('adv-setting-reasoning-close').value : (currentSettings.reasoning_tag_close || '</think>'),

    genai_force_reasoning: document.getElementById('adv-setting-genai-force-reasoning') ? document.getElementById('adv-setting-genai-force-reasoning').checked : !!currentSettings.genai_force_reasoning,
    genai_reasoning_tag_open: document.getElementById('adv-setting-genai-reasoning-open') ? document.getElementById('adv-setting-genai-reasoning-open').value : (currentSettings.genai_reasoning_tag_open || '<think>'),
    genai_reasoning_tag_close: document.getElementById('adv-setting-genai-reasoning-close') ? document.getElementById('adv-setting-genai-reasoning-close').value : (currentSettings.genai_reasoning_tag_close || '</think>'),
    
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
