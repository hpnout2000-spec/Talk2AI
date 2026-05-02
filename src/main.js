/* ════════════════════════════════════════════════════════════════════
   LLM Chat — Main Entry Point
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from './services/settings-store.js';
import { characterStore } from './services/character-store.js';
import { chatStore } from './services/chat-store.js';
import { api } from './services/api.js';
import { memoryService } from './services/memory-service.js';
import { initChat } from './components/chat.js';
import { initCharacterPanel } from './components/character-panel.js';
import { initSettingsPanel } from './components/settings-panel.js';
import { initMemoryViewer } from './components/memory-viewer.js';

// ─── App State ──────────────────────────────────────────────────────

export const appState = {
  currentCharacter: null,
  currentChat: null,
  isGenerating: false,
  abortController: null,
};

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

// ─── Start App ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
