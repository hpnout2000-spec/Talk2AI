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
import { initAdvancedSettings } from './components/advanced-settings.js';
import { bookStore } from './services/book-store.js';
import { initBookPanel } from './components/book-panel.js';
import { initBookView } from './components/book-view.js';
import { uiManager } from './utils/ui-manager.js';

// ─── Initialize App ─────────────────────────────────────────────────

/**
 * Global scroll optimizer to disable pointer events while scrolling
 * This prevents expensive :hover effects from triggering and causing lags.
 */
function initScrollOptimizer() {
  let scrollTimer;
  const body = document.body;
  
  // Use capture phase to catch all scroll events in any container
  window.addEventListener('scroll', () => {
    if (!body.classList.contains('is-scrolling')) {
      body.classList.add('is-scrolling');
    }
    
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      body.classList.remove('is-scrolling');
    }, 100); 
  }, true);
}

async function init() {
  console.log('LLM Chat initializing...');
  
  initScrollOptimizer();

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
  const userNamePopover = document.getElementById('user-name-popover');
  const userNameInput = document.getElementById('user-name-edit-input');
  const btnConfirmName = document.getElementById('btn-confirm-name');

  if (btnSetName) {
    btnSetName.addEventListener('click', (e) => {
      e.stopPropagation();
      const settings = settingsStore.get();
      userNameInput.value = settings.user_name || 'User';
      userNamePopover.classList.toggle('hidden');
      if (!userNamePopover.classList.contains('hidden')) {
        setTimeout(() => userNameInput.focus(), 50);
      }
    });
  }

  if (btnConfirmName) {
    btnConfirmName.addEventListener('click', async () => {
      const newName = userNameInput.value.trim();
      if (newName !== '') {
        await settingsStore.save({ user_name: newName });
        if (userNameDisplay) userNameDisplay.textContent = newName;
        userNamePopover.classList.add('hidden');
        showToast(`Name updated to ${newName}`);
      }
    });
  }

  // Handle Enter key in name input
  userNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      btnConfirmName.click();
    }
  });

  // Global click-outside handler for name popover
  document.addEventListener('click', (e) => {
    if (userNamePopover && !userNamePopover.contains(e.target) && !btnSetName.contains(e.target)) {
      userNamePopover.classList.add('hidden');
    }
  });

  // Load characters and books
  const characters = await characterStore.load();
  await bookStore.load();

  // Preload EVERYTHING into RAM for maximum performance
  console.log(`Preloading data for ${characters.length} characters...`);
  await Promise.all([
    ...characters.map(char => chatStore.loadForCharacter(char.id)),
    ...characters.map(char => memoryService.loadForCharacter(char.id))
  ]);

  // Initialize all components
  initCharacterPanel();
  initChat();
  initSettingsPanel();
  initMemoryViewer();
  initAdvancedSettings();
  initBookPanel();
  initBookView();
  applyGlobalSettingsStyles();

  // Initialize Window Controls (for Tauri frameless)
  initWindowControls();

  // Check API connection
  checkConnection();

  console.log('LLM Chat ready!');
}

// ─── Tauri Window Controls ──────────────────────────────────────────

async function initWindowControls() {
  const btnMin = document.getElementById('btn-minimize');
  const btnMax = document.getElementById('btn-maximize');
  const btnClose = document.getElementById('btn-close');

  if (window.__TAURI__) {
    const { getCurrentWindow } = window.__TAURI__.window;
    const appWindow = getCurrentWindow();

    btnMin?.addEventListener('click', () => appWindow.minimize());
    btnMax?.addEventListener('click', () => appWindow.toggleMaximize());
    btnClose?.addEventListener('click', () => appWindow.close());
  } else {
    // Hide controls if not in Tauri (e.g. regular browser)
    const controls = document.querySelector('.window-controls');
    if (controls) controls.style.display = 'none';
  }
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

// ─── Global Styles Application ─────────────────────────────────────

export function applyGlobalSettingsStyles() {
  const settings = settingsStore.get();
  document.body.classList.toggle('settings-italic-asterisks', !!settings.italic_asterisks);
  document.body.classList.toggle('ai-comments-enabled', !!settings.ai_comments_enabled);
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
      closeModal(modal);
      btnConfirm.removeEventListener('click', handleConfirm);
      btnCancel.removeEventListener('click', handleCancel);
    };

    btnConfirm.addEventListener('click', handleConfirm);
    btnCancel.addEventListener('click', handleCancel);
    openWindow(modal);
  });
}

/**
 * Global function to open any window/modal/panel
 */
export function openWindow(idOrElement) {
  uiManager.open(idOrElement);
}

/**
 * Global function to close any window/modal/panel
 */
export function closeWindow(idOrElement) {
  uiManager.close(idOrElement);
}

/**
 * Custom alternative to window.confirm with arbitrary buttons
 */
export function showCustomConfirm(title, message, buttons = ['Cancel', 'Confirm']) {
  return new Promise((resolve) => {
    const modal = document.getElementById('generic-dialog');
    const titleEl = document.getElementById('dialog-title');
    const messageEl = document.getElementById('dialog-message');
    const inputContainer = document.getElementById('dialog-input-container');
    const footer = modal.querySelector('.modal-footer');

    titleEl.textContent = title;
    messageEl.textContent = message;
    inputContainer.classList.add('hidden');
    
    // Save original footer content to restore later if needed, but it's okay to just clear it
    // Wait, other dialogs rely on the original buttons. Let's just hide the original ones and add temporary ones.
    const origButtons = Array.from(footer.children);
    origButtons.forEach(b => b.classList.add('hidden'));

    const tempContainer = document.createElement('div');
    tempContainer.style.display = 'flex';
    tempContainer.style.gap = '1rem';
    tempContainer.style.marginLeft = 'auto';

    const cleanup = () => {
      closeModal(modal);
      tempContainer.remove();
      origButtons.forEach(b => b.classList.remove('hidden'));
    };

    buttons.forEach((btnText, i) => {
      const btn = document.createElement('button');
      btn.className = i === buttons.length - 1 ? 'btn-primary' : 'btn-secondary';
      btn.textContent = btnText;
      btn.addEventListener('click', () => {
        cleanup();
        resolve(btnText);
      });
      tempContainer.appendChild(btn);
    });

    footer.appendChild(tempContainer);
    modal.classList.remove('hidden');
  });
}

/**
 * Smoothly closes a modal with animation (legacy wrapper for closeWindow)
 */
export function closeModal(modalIdOrElement) {
  closeWindow(modalIdOrElement);
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
      closeModal(modal);
      btnConfirm.removeEventListener('click', handleConfirm);
      btnCancel.removeEventListener('click', handleCancel);
    };

    btnConfirm.addEventListener('click', handleConfirm);
    btnCancel.addEventListener('click', handleCancel);
    openWindow(modal);
    setTimeout(() => inputEl.focus(), 100);
  });
}

// ─── Start App ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
