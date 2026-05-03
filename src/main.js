/* ════════════════════════════════════════════════════════════════════
   LLM Chat — Main Entry Point
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from './services/settings-store.js';
import { characterStore } from './services/character-store.js';
import { chatStore } from './services/chat-store.js';
import { api } from './services/api.js';
import { memoryService } from './services/memory-service.js';
import { appState } from './state.js';
import { initChat } from './components/chat.js';
import { initCharacterPanel } from './components/character-panel.js';
import { initSettingsPanel } from './components/settings-panel.js';
import { initMemoryViewer } from './components/memory-viewer.js';

// ─── Initialize App ─────────────────────────────────────────────────

async function init() {
  console.log('LLM Chat initializing...');

  // Load settings first
  await settingsStore.load();
  const settings = settingsStore.get();

  // Apply font size
  document.documentElement.style.setProperty('--text-base', `${settings.font_size / 16}rem`);

  // Sync thinking toggle
  const thinkingToggle = document.getElementById('thinking-toggle');
  if (thinkingToggle) {
    thinkingToggle.checked = settings.thinking_enabled;
  }

  // Update user name display
  const userNameDisplay = document.getElementById('user-name-display');
  if (userNameDisplay) {
    userNameDisplay.textContent = settings.user_name || 'User';
  }

  // User name click handler
  const btnSetName = document.getElementById('btn-set-user-name');
  if (btnSetName) {
    btnSetName.addEventListener('click', async () => {
      const currentName = settingsStore.get().user_name || 'User';
      const newName = await showPrompt('Change Name', 'Enter your name:', currentName);
      if (newName !== null && newName.trim() !== '') {
        const cleanedName = newName.trim();
        await settingsStore.save({ user_name: cleanedName });
        if (userNameDisplay) userNameDisplay.textContent = cleanedName;
        showToast(`Name updated to ${cleanedName}`);
      }
    });
  }

  // Load characters
  await characterStore.load();

  // Initialize all components
  initCharacterPanel();
  initChat();
  initSettingsPanel();
  initMemoryViewer();

  // Check API connection
  checkConnection();

  console.log('LLM Chat ready!');
}

// ─── Check Connection ───────────────────────────────────────────────

export async function checkConnection() {
  const statusEl = document.querySelector('.connection-status');
  const textEl = document.getElementById('connection-text');

  try {
    const connected = await api.checkConnection();
    if (connected) {
      statusEl.classList.add('connected');
      textEl.textContent = 'Connected';
    } else {
      statusEl.classList.remove('connected');
      textEl.textContent = 'Disconnected';
    }
  } catch {
    statusEl.classList.remove('connected');
    textEl.textContent = 'Disconnected';
  }
}

// ─── Toast Notification ─────────────────────────────────────────────

export function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ─── Custom Dialogs ────────────────────────────────────────────────

/**
 * Custom alternative to window.confirm
 */
export function showConfirm(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('generic-dialog');
    const titleEl = document.getElementById('dialog-title');
    const messageEl = document.getElementById('dialog-message');
    const inputContainer = document.getElementById('dialog-input-container');
    const btnCancel = document.getElementById('btn-dialog-cancel');
    const btnConfirm = document.getElementById('btn-dialog-confirm');

    titleEl.textContent = title;
    messageEl.textContent = message;
    inputContainer.classList.add('hidden');
    btnCancel.classList.remove('hidden');

    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };
    const handleCancel = () => {
      cleanup();
      resolve(false);
    };
    const cleanup = () => {
      modal.classList.add('hidden');
      btnConfirm.removeEventListener('click', handleConfirm);
      btnCancel.removeEventListener('click', handleCancel);
    };

    btnConfirm.addEventListener('click', handleConfirm);
    btnCancel.addEventListener('click', handleCancel);
    modal.classList.remove('hidden');
  });
}

/**
 * Custom alternative to window.prompt
 */
export function showPrompt(title, message, defaultValue = '') {
  return new Promise((resolve) => {
    const modal = document.getElementById('generic-dialog');
    const titleEl = document.getElementById('dialog-title');
    const messageEl = document.getElementById('dialog-message');
    const inputContainer = document.getElementById('dialog-input-container');
    const inputEl = document.getElementById('dialog-input');
    const btnCancel = document.getElementById('btn-dialog-cancel');
    const btnConfirm = document.getElementById('btn-dialog-confirm');

    titleEl.textContent = title;
    messageEl.textContent = message;
    inputContainer.classList.remove('hidden');
    inputEl.value = defaultValue;
    btnCancel.classList.remove('hidden');

    const handleConfirm = () => {
      const val = inputEl.value;
      cleanup();
      resolve(val);
    };
    const handleCancel = () => {
      cleanup();
      resolve(null);
    };
    const cleanup = () => {
      modal.classList.add('hidden');
      btnConfirm.removeEventListener('click', handleConfirm);
      btnCancel.removeEventListener('click', handleCancel);
    };

    btnConfirm.addEventListener('click', handleConfirm);
    btnCancel.addEventListener('click', handleCancel);
    modal.classList.remove('hidden');
    setTimeout(() => inputEl.focus(), 100);
  });
}

// ─── Start App ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
