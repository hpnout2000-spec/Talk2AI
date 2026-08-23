/* ════════════════════════════════════════════════════════════════════
   GenAI Memories Manager — View and manage GenAI memories
   ════════════════════════════════════════════════════════════════════ */

import { genaiMemoryStore } from '../services/genai-memory-store.js';
import { showToast, showConfirm, openWindow, closeWindow } from '../main.js';
import { escapeHtml, formatTime, formatExactTime } from '../utils/helpers.js';

let currentlyEditingId = null;

export function initGenAIMemoriesMgr() {
  const btnOpen = document.getElementById('btn-open-genai-memories');
  const btnClose = document.getElementById('btn-close-genai-memories');
  const modal = document.getElementById('modal-genai-memories');
  const backdrop = modal ? modal.querySelector('.modal-backdrop') : null;
  const btnAdd = document.getElementById('btn-add-genai-memory');
  const btnClearAll = document.getElementById('btn-clear-all-genai-memories');
  const inputNew = document.getElementById('input-new-genai-memory');

  if (!modal) {
    console.error('modal-genai-memories element not found');
    return;
  }

  // Open modal
  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      currentlyEditingId = null;
      if (inputNew) inputNew.value = '';
      openWindow(modal);
      renderMemories();
    });
  }

  // Close modal via X button
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      closeWindow(modal);
    });
  }

  // Close modal via backdrop click
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      closeWindow(modal);
    });
  }

  // Add memory
  if (btnAdd) {
    btnAdd.addEventListener('click', addMemory);
  }

  // Support Ctrl+Enter to submit inside the textarea
  if (inputNew) {
    inputNew.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        addMemory();
      }
    });
  }

  // Clear all
  if (btnClearAll) {
    btnClearAll.addEventListener('click', clearAllMemories);
  }
}

async function addMemory() {
  const inputNew = document.getElementById('input-new-genai-memory');
  if (!inputNew) return;

  const content = inputNew.value.trim();
  if (!content) {
    showToast('Memory text cannot be empty', 'error');
    return;
  }

  genaiMemoryStore.add(content);
  inputNew.value = '';
  showToast('Fact added to GenAI memory');
  renderMemories();
}

async function clearAllMemories() {
  const memories = genaiMemoryStore.getAll();
  if (memories.length === 0) {
    showToast('GenAI has no saved memories', 'error');
    return;
  }

  const confirmed = await showConfirm(
    'Clear GenAI Memories',
    'Are you sure you want to clear all facts GenAI has saved? This action cannot be undone.'
  );

  if (confirmed) {
    genaiMemoryStore.clear();
    showToast('All GenAI memories cleared');
    renderMemories();
  }
}

export function renderMemories() {
  const container = document.getElementById('genai-memories-list-container');
  const countEl = document.getElementById('genai-memories-count');
  if (!container) return;

  const memories = genaiMemoryStore.getAll();

  if (countEl) {
    countEl.textContent = memories.length;
  }

  if (memories.length === 0) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--space-6) 0; color: var(--text-tertiary); text-align: center; gap: 8px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 32px; height: 32px; color: var(--text-tertiary); opacity: 0.6;">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <div style="font-size: var(--text-sm); font-weight: 500;">No memories saved yet</div>
        <div style="font-size: var(--text-xs); opacity: 0.8; max-width: 280px;">GenAI will remember facts you tell it, or you can manually add facts above.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = memories.map(entry => {
    const isEditing = entry.id === currentlyEditingId;

    if (isEditing) {
      return `
        <div class="memory-entry editing" data-id="${entry.id}">
          <div class="memory-entry-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 14px; height: 14px; color: var(--text-accent); display: block; margin-top: 2px;">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
          </div>
          <div class="memory-entry-body" style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
            <textarea class="edit-memory-textarea" style="width: 100%; min-height: 70px; padding: 10px; background: var(--bg-primary); border: 1px solid var(--border-light); border-radius: var(--radius-md); color: var(--text-primary); outline: none; font-family: var(--font-sans); font-size: var(--text-sm); resize: vertical; margin-bottom: 4px;">${escapeHtml(entry.content)}</textarea>
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
              <button class="btn-secondary small btn-edit-cancel" type="button" style="padding: 4px 10px; font-size: 11px; border-radius: var(--radius-sm);">Cancel</button>
              <button class="btn-primary small btn-edit-save" type="button" style="padding: 4px 10px; font-size: 11px; border-radius: var(--radius-sm); background: var(--accent-primary); color: #212121; border: none; cursor: pointer; font-weight: 600;">Save</button>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="memory-entry" data-id="${entry.id}">
        <div class="memory-entry-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 14px; height: 14px; color: var(--text-accent); display: block; margin-top: 2px;">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        </div>
        <div class="memory-entry-body">
          <div class="memory-entry-content" style="white-space: pre-wrap;">${escapeHtml(entry.content)}</div>
          <div class="memory-entry-meta">
            <span data-timestamp="${entry.timestamp || ''}" data-custom-tooltip="${formatExactTime(entry.timestamp)}">${formatTime(entry.timestamp)}</span>
          </div>
        </div>
        <button class="memory-entry-edit" data-id="${entry.id}" title="Edit memory">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button class="memory-entry-delete" data-id="${entry.id}" title="Delete memory">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;
  }).join('');

  // Attach event handlers to list items
  if (currentlyEditingId) {
    const textarea = container.querySelector('.edit-memory-textarea');
    if (textarea) {
      textarea.focus();
      // Place cursor at the end of the text
      const len = textarea.value.length;
      textarea.setSelectionRange(len, len);

      // Support Ctrl+Enter to save, Esc to cancel
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          saveEdit(currentlyEditingId, textarea.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          currentlyEditingId = null;
          renderMemories();
        }
      });
    }

    const btnSave = container.querySelector('.btn-edit-save');
    const btnCancel = container.querySelector('.btn-edit-cancel');

    if (btnSave) {
      btnSave.addEventListener('click', () => {
        if (textarea) {
          saveEdit(currentlyEditingId, textarea.value);
        }
      });
    }

    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        currentlyEditingId = null;
        renderMemories();
      });
    }
  } else {
    // Edit buttons
    container.querySelectorAll('.memory-entry-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        currentlyEditingId = btn.dataset.id;
        renderMemories();
      });
    });

    // Delete buttons
    container.querySelectorAll('.memory-entry-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const confirmed = await showConfirm(
          'Delete Memory',
          'Are you sure you want to delete this memory?'
        );
        if (confirmed) {
          genaiMemoryStore.delete(id);
          showToast('Memory deleted');
          renderMemories();
        }
      });
    });
  }
}

function saveEdit(id, newValue) {
  const content = newValue.trim();
  if (!content) {
    showToast('Memory text cannot be empty', 'error');
    return;
  }

  genaiMemoryStore.update(id, content);
  showToast('Memory updated');
  currentlyEditingId = null;
  renderMemories();
}
