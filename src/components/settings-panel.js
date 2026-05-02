/* ════════════════════════════════════════════════════════════════════
   Settings Panel — Configuration UI
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from '../services/settings-store.js';
import { showToast, checkConnection } from '../main.js';
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
  setupRangeInput('setting-max-tokens', 'max-tokens-value', v => v);
  setupRangeInput('setting-temperature', 'temperature-value', v => v);
  setupRangeInput('setting-top-p', 'top-p-value', v => v);
  setupRangeInput('setting-top-k', 'top-k-value', v => v);
  setupRangeInput('setting-rep-penalty', 'rep-penalty-value', v => v);
  setupRangeInput('setting-font-size', 'font-size-value', v => v);

  // Thinking toggle in settings syncs with header toggle
  document.getElementById('setting-thinking').addEventListener('change', (e) => {
    document.getElementById('thinking-toggle').checked = e.target.checked;
  });

  // Load initial values
  loadSettingsToUI();
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
  setRangeValue('setting-max-tokens', 'max-tokens-value', settings.max_tokens);
  setRangeValue('setting-temperature', 'temperature-value', settings.temperature);
  setRangeValue('setting-top-p', 'top-p-value', settings.top_p);
  setRangeValue('setting-top-k', 'top-k-value', settings.top_k);
  setRangeValue('setting-rep-penalty', 'rep-penalty-value', settings.rep_penalty);
  setRangeValue('setting-font-size', 'font-size-value', settings.font_size);

  document.getElementById('setting-thinking').checked = settings.thinking_enabled;
  document.getElementById('setting-memory').checked = settings.memory_enabled;
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
  const newSettings = {
    api_url: document.getElementById('setting-api-url').value.trim() || 'http://localhost:5001',
    max_tokens: parseInt(document.getElementById('setting-max-tokens').value),
    temperature: parseFloat(document.getElementById('setting-temperature').value),
    top_p: parseFloat(document.getElementById('setting-top-p').value),
    top_k: parseInt(document.getElementById('setting-top-k').value),
    rep_penalty: parseFloat(document.getElementById('setting-rep-penalty').value),
    thinking_enabled: document.getElementById('setting-thinking').checked,
    memory_enabled: document.getElementById('setting-memory').checked,
    font_size: parseInt(document.getElementById('setting-font-size').value),
  };

  await settingsStore.save(newSettings);

  // Apply font size
  document.documentElement.style.setProperty('--text-base', `${newSettings.font_size / 16}rem`);

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
