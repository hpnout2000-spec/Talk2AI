/* ════════════════════════════════════════════════════════════════════
   LLM Chat — Main Entry Point
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from './services/settings-store.js';
import { characterStore } from './services/character-store.js';
import { chatStore } from './services/chat-store.js';
import { api } from './services/api.js';
import { memoryService } from './services/memory-service.js';
import { appState } from './state.js';
import { initChat, openAiCommentsSidebar, closeAiCommentsSidebar } from './components/chat.js';
import { initCharacterPanel } from './components/character-panel.js';
import { initSettingsPanel } from './components/settings-panel.js';
import { initMemoryViewer } from './components/memory-viewer.js';
import { initAdvancedSettings } from './components/advanced-settings.js';
import { bookStore } from './services/book-store.js';
import { initBookPanel } from './components/book-panel.js';
import { initBookView } from './components/book-view.js';
import { uiManager } from './utils/ui-manager.js';
import { initGenAIPanel, openGenAIPanel, closeGenAIPanel } from './components/genai-panel.js';
import { initGroupChatPanel } from './components/group-chat-panel.js';
import { initGroupChatView } from './components/group-chat-view.js';
import { groupChatStore } from './services/group-chat-store.js';
import { initGameView } from './components/game-view.js';

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
  const updateUserNameDisplay = () => {
    const settings = settingsStore.get();
    const chatOverride = appState.currentChat?.user_name;
    if (userNameDisplay) {
      userNameDisplay.textContent = chatOverride || settings.user_name || 'User';
    }
  };
  updateUserNameDisplay();
  
  // Expose to window so other files can trigger it
  window.updateUserNameDisplay = updateUserNameDisplay;

  // User name click handler
  const btnSetName = document.getElementById('btn-set-user-name');
  const userNamePopover = document.getElementById('user-name-popover');
  const userNameInput = document.getElementById('user-name-edit-input');
  const userNameChatOnly = document.getElementById('user-name-chat-only');
  const btnConfirmName = document.getElementById('btn-confirm-name');
  const btnPersonas = document.getElementById('btn-personas');

  if (btnSetName) {
    btnSetName.addEventListener('click', (e) => {
      e.stopPropagation();
      const settings = settingsStore.get();
      const chatOverride = appState.currentChat?.user_name;
      userNameInput.value = chatOverride || settings.user_name || 'User';
      userNameChatOnly.checked = !!chatOverride;
      
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
        const isChatOnly = userNameChatOnly.checked;
        if (isChatOnly && appState.currentChat) {
          appState.currentChat.user_name = newName;
          await chatStore.saveCurrentSession();
        } else {
          await settingsStore.save({ user_name: newName });
          if (appState.currentChat && appState.currentChat.user_name) {
            delete appState.currentChat.user_name;
            await chatStore.saveCurrentSession();
          }
        }
        updateUserNameDisplay();
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

  // Personas modal logic
  const personaModal = document.getElementById('persona-modal');
  const btnClosePersonaModal = document.querySelector('.btn-close-persona-modal');
  const btnCancelPersona = document.getElementById('btn-cancel-persona');
  const btnApplyPersona = document.getElementById('btn-apply-persona');
  const personaList = document.getElementById('persona-list');
  const btnAddPersona = document.getElementById('btn-add-persona');
  const personaEditForm = document.getElementById('persona-edit-form');
  const personaName = document.getElementById('persona-name');
  const personaDesc = document.getElementById('persona-description');
  const btnDeletePersona = document.getElementById('btn-delete-persona');
  const btnCopyPersona = document.getElementById('btn-copy-persona');
  const personaChatOnly = document.getElementById('persona-chat-only');
  let editingPersonaId = null;

  const renderPersonasList = () => {
    const settings = settingsStore.get();
    const personas = settings.personas || [{ id: 'default', name: 'Default Persona', description: '' }];
    personaList.innerHTML = '';
    
    const chatOverrideId = appState.currentChat?.persona_id;
    const activeId = chatOverrideId || settings.active_persona_id || 'default';

    personas.forEach(p => {
      const el = document.createElement('div');
      el.className = 'persona-item ' + (p.id === activeId ? 'active' : '');
      el.style.padding = '10px 12px';
      el.style.cursor = 'pointer';
      el.style.flex = 'none'; // Prevent vertical stretching
      el.textContent = p.name;
      el.onclick = () => selectPersona(p);
      personaList.appendChild(el);
    });
  };

  const selectPersona = (p) => {
    editingPersonaId = p.id;
    personaName.value = p.name;
    personaDesc.value = p.description;
    personaEditForm.classList.remove('hidden');
    
    // Hide delete for default persona, but preserve height to avoid jittering
    btnDeletePersona.style.visibility = p.id === 'default' ? 'hidden' : 'visible';
    btnCopyPersona.style.visibility = 'visible';
    
    // Update active class in list
    Array.from(personaList.children).forEach(el => {
      if (el.textContent === p.name) el.classList.add('active');
      else el.classList.remove('active');
    });
  };

  if (btnPersonas) {
    btnPersonas.addEventListener('click', () => {
      userNamePopover.classList.add('hidden');
      openWindow(personaModal);
      const chatOverride = appState.currentChat?.persona_id;
      personaChatOnly.checked = !!chatOverride;
      renderPersonasList();
      
      // Auto-select active persona
      const settings = settingsStore.get();
      const activeId = chatOverride || settings.active_persona_id || 'default';
      const personas = settings.personas || [];
      const activeP = personas.find(p => p.id === activeId) || personas[0];
      if (activeP) selectPersona(activeP);
    });
  }

  [btnClosePersonaModal, btnCancelPersona].forEach(btn => {
    if (btn) btn.addEventListener('click', () => closeWindow(personaModal));
  });

  if (btnAddPersona) {
    btnAddPersona.addEventListener('click', () => {
      editingPersonaId = 'new';
      personaName.value = 'New Persona';
      personaDesc.value = '';
      personaEditForm.classList.remove('hidden');
      btnDeletePersona.style.visibility = 'hidden';
      btnCopyPersona.style.visibility = 'hidden';
      personaName.focus();
    });
  }

  if (btnCopyPersona) {
    btnCopyPersona.addEventListener('click', async () => {
      if (!editingPersonaId || editingPersonaId === 'new') return;
      const settings = settingsStore.get();
      let personas = settings.personas || [];
      const p = personas.find(x => x.id === editingPersonaId);
      if (p) {
        const newId = 'p_' + Date.now();
        const newP = { id: newId, name: p.name + ' (Copy)', description: p.description || '' };
        personas.push(newP);
        await settingsStore.save({ personas });
        renderPersonasList();
        selectPersona(newP);
        showToast('Persona duplicated');
      }
    });
  }

  if (btnDeletePersona) {
    btnDeletePersona.addEventListener('click', async () => {
      if (!editingPersonaId || editingPersonaId === 'default' || editingPersonaId === 'new') return;
      const settings = settingsStore.get();
      settings.personas = settings.personas.filter(p => p.id !== editingPersonaId);
      if (settings.active_persona_id === editingPersonaId) {
        settings.active_persona_id = 'default';
      }
      await settingsStore.save({ personas: settings.personas, active_persona_id: settings.active_persona_id });
      
      if (appState.currentChat && appState.currentChat.persona_id === editingPersonaId) {
        delete appState.currentChat.persona_id;
        await chatStore.saveCurrentSession();
      }
      
      personaEditForm.classList.add('hidden');
      renderPersonasList();
    });
  }

  // Auto-save persona when typing
  const autoSavePersona = async () => {
    if (!editingPersonaId) return;
    const settings = settingsStore.get();
    let personas = settings.personas || [];
    
    if (editingPersonaId === 'new') {
      const newId = 'p_' + Date.now();
      personas.push({ id: newId, name: personaName.value, description: personaDesc.value });
      editingPersonaId = newId;
    } else {
      const p = personas.find(x => x.id === editingPersonaId);
      if (p) {
        p.name = personaName.value;
        p.description = personaDesc.value;
      }
    }
    await settingsStore.save({ personas });
    renderPersonasList();
  };

  personaName.addEventListener('input', autoSavePersona);
  personaDesc.addEventListener('input', autoSavePersona);

  if (btnApplyPersona) {
    btnApplyPersona.addEventListener('click', async () => {
      if (!editingPersonaId || editingPersonaId === 'new') {
        showToast('Select a persona first');
        return;
      }
      
      const isChatOnly = personaChatOnly.checked;
      if (isChatOnly && appState.currentChat) {
        appState.currentChat.persona_id = editingPersonaId;
        await chatStore.saveCurrentSession();
      } else {
        await settingsStore.save({ active_persona_id: editingPersonaId });
        if (appState.currentChat && appState.currentChat.persona_id) {
          delete appState.currentChat.persona_id;
          await chatStore.saveCurrentSession();
        }
      }
      showToast('Persona applied');
      closeWindow(personaModal);
    });
  }

  // Global click-outside handler for name popover
  document.addEventListener('click', (e) => {
    if (userNamePopover && !userNamePopover.contains(e.target) && !btnSetName.contains(e.target)) {
      userNamePopover.classList.add('hidden');
    }
  });

  // Load characters and books
  const characters = await characterStore.load();
  await bookStore.load();
  await groupChatStore.loadGroups();


  // Initialize all components
  initCharacterPanel();
  initChat();
  initSettingsPanel();
  initMemoryViewer();
  initAdvancedSettings();
  initBookPanel();
  initBookView();
  initGenAIPanel();
  initGroupChatPanel();
  initGroupChatView();
  initGameView();
  applyGlobalSettingsStyles();

  // GenAI button
  const btnGenAI = document.getElementById('btn-genai');
  if (btnGenAI) {
    // Initial UI state setup
    updateGenAIToggleUI();

    btnGenAI.addEventListener('click', async () => {
      const settings = settingsStore.get();
      const newMode = !settings.genai_mode_enabled;
      
      await settingsStore.save({ ...settings, genai_mode_enabled: newMode });
      updateGenAIToggleUI();

      // If any right sidebar is currently open, switch it!
      const isGenAIOpen = document.body.classList.contains('genai-sidebar-open');
      const isCommentsOpen = document.body.classList.contains('ai-sidebar-open');
      
      if (isGenAIOpen || isCommentsOpen) {
        // Apply bounce effect to the active sidebar
        const activeSidebar = isGenAIOpen 
          ? document.getElementById('genai-sidebar') 
          : document.getElementById('ai-comments-sidebar');
        
        if (activeSidebar) {
          activeSidebar.classList.remove('panel-bounce');
          void activeSidebar.offsetWidth; // trigger reflow
          activeSidebar.classList.add('panel-bounce');
        }

        if (newMode) {
          // Switch to GenAI
          closeAiCommentsSidebar();
          openGenAIPanel();
        } else {
          // Switch to Comment History
          closeGenAIPanel();
          openAiCommentsSidebar();
        }
      }
    });
  }

  // Initialize Window Controls (for Tauri frameless)
  initWindowControls();

  // Check API connection
  checkConnection();

  console.log('LLM Chat ready!');
}

// ─── Tauri Window Controls ──────────────────────────────────────────

async function initWindowControls() {
  // Logic removed: using native window decorations instead of custom frameless controls
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

export function updateGenAIToggleUI() {
  const settings = settingsStore.get();
  const isActive = settings.genai_mode_enabled;
  const dot = document.getElementById('genai-status-dot');
  const text = document.getElementById('genai-status-text');
  
  if (dot && text) {
    if (isActive) {
      dot.classList.add('active');
      dot.classList.remove('inactive');
      dot.style.background = ''; // Clear inline styles
      text.textContent = 'Active';
      text.style.color = 'var(--success)';
    } else {
      dot.classList.add('inactive');
      dot.classList.remove('active');
      dot.style.background = ''; // Clear inline styles
      text.textContent = 'Inactive';
      text.style.color = 'var(--danger, #ef4444)';
    }
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
    
    // Hide ALL current footer content to start fresh and avoid button duplication
    Array.from(footer.children).forEach(child => child.classList.add('hidden'));

    const tempContainer = document.createElement('div');
    tempContainer.className = 'custom-confirm-buttons';
    tempContainer.style.display = 'flex';
    tempContainer.style.gap = '1rem';
    tempContainer.style.marginLeft = 'auto';

    const cleanup = () => {
      closeModal(modal);
      tempContainer.remove();
      // Restore default buttons for next use (showConfirm/showPrompt)
      const btnCancel = document.getElementById('btn-dialog-cancel');
      const btnConfirm = document.getElementById('btn-dialog-confirm');
      if (btnCancel) btnCancel.classList.remove('hidden');
      if (btnConfirm) btnConfirm.classList.remove('hidden');
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
    openWindow(modal);
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
