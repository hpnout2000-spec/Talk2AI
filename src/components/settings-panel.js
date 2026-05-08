/* ════════════════════════════════════════════════════════════════════
   Settings Panel — Configuration UI
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from '../services/settings-store.js';
import { showToast, checkConnection, applyGlobalSettingsStyles } from '../main.js';
import { api } from '../services/api.js';

export function initSettingsPanel() {
  const panel = document.getElementById('settings-panel');
  const btnOpen = document.getElementById('btn-settings');
  const btnClose = document.getElementById('btn-close-settings');
  const btnSave = document.getElementById('btn-save-settings');
  const btnTestConnection = document.getElementById('btn-test-connection');

  // Open/close
  btnOpen.addEventListener('click', () => {
    loadSettingsToUI();
    panel.classList.remove('hidden');
    // Close memory panel if open
    document.getElementById('memory-panel').classList.add('hidden');
  });
  btnClose.addEventListener('click', () => panel.classList.add('hidden'));

  // Save
  btnSave.addEventListener('click', saveSettings);

  // Test connection
  btnTestConnection.addEventListener('click', testConnection);

  // Range inputs: show values in real-time
  setupRangeInput('setting-font-size', 'font-size-value', v => v);

  // Thinking toggle in settings syncs with header toggle
  document.getElementById('setting-thinking').addEventListener('change', (e) => {
    document.getElementById('thinking-toggle').checked = e.target.checked;
  });

  // Load initial values
  loadSettingsToUI();

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
    // Update range fill visual
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

  document.getElementById('setting-api-url').value = settings.api_url;
  setRangeValue('setting-font-size', 'font-size-value', settings.font_size);

  document.getElementById('setting-thinking').checked = settings.thinking_enabled;
  document.getElementById('setting-memory').checked = settings.memory_enabled;
  document.getElementById('setting-auto-translate').checked = settings.auto_translate;
  document.getElementById('setting-translate-user').checked = settings.translate_user_messages;
  document.getElementById('setting-italic-asterisks').checked = settings.italic_asterisks;
  document.getElementById('setting-target-lang').value = settings.target_language || 'Russian';
  document.getElementById('setting-outgoing-lang').value = settings.outgoing_target_language || 'English';
  document.getElementById('setting-suggestions-lang').value = settings.suggestions_language || 'Russian';
}

function setRangeValue(inputId, valueId, value) {
  const input = document.getElementById(inputId);
  const valueEl = document.getElementById(valueId);
  if (input) {
    input.value = value;
    if (valueEl) valueEl.textContent = value;
    // Trigger fill update
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const pct = ((value - min) / (max - min)) * 100;
    input.style.setProperty('--range-fill', `${pct}%`);
  }
}

async function saveSettings() {
  const current = settingsStore.get();
  const newSettings = {
    ...current,
    api_url: document.getElementById('setting-api-url').value.trim() || 'http://localhost:5001',
    thinking_enabled: document.getElementById('setting-thinking').checked,
    memory_enabled: document.getElementById('setting-memory').checked,
    auto_translate: document.getElementById('setting-auto-translate').checked,
    translate_user_messages: document.getElementById('setting-translate-user').checked,
    italic_asterisks: document.getElementById('setting-italic-asterisks').checked,
    target_language: document.getElementById('setting-target-lang').value.trim() || 'Russian',
    outgoing_target_language: document.getElementById('setting-outgoing-lang').value.trim() || 'English',
    suggestions_language: document.getElementById('setting-suggestions-lang').value.trim() || 'Russian',
    font_size: parseInt(document.getElementById('setting-font-size').value),
  };

  await settingsStore.save(newSettings);

  // Apply font size
  document.documentElement.style.setProperty('--text-base', `${newSettings.font_size / 16}rem`);

  applyGlobalSettingsStyles();

  // Sync header thinking toggle
  document.getElementById('thinking-toggle').checked = newSettings.thinking_enabled;

  showToast('Settings saved');
  checkConnection();
}

async function testConnection() {
  const url = document.getElementById('setting-api-url').value.trim();
  const btn = document.getElementById('btn-test-connection');
  const existingResult = btn.parentElement.querySelector('.connection-result');
  if (existingResult) existingResult.remove();

  btn.textContent = 'Testing...';
  btn.disabled = true;

  // Temporarily set URL for testing
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

  // Restore original URL if not saved yet
  settingsStore.update('api_url', origSettings.api_url);

  btn.textContent = 'Test Connection';
  btn.disabled = false;
  btn.parentElement.appendChild(resultEl);
}
