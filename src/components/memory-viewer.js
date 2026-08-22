/* ════════════════════════════════════════════════════════════════════
   Memory Viewer — View and manage character memories
   ════════════════════════════════════════════════════════════════════ */

import { memoryService } from '../services/memory-service.js';
import { showToast, openWindow, closeWindow } from '../main.js';
import { appState } from '../state.js';
import { escapeHtml, formatTime, formatExactTime } from '../utils/helpers.js';

export function initMemoryViewer() {
  const panel = document.getElementById('memory-panel');
  const btnOpen = document.getElementById('btn-memory');
  const btnClose = document.getElementById('btn-close-memory');
  const popover = document.getElementById('memory-popover');
  const btnShowAll = document.getElementById('btn-show-all-memory');

  btnOpen.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = popover.classList.contains('hidden');
    
    // Close other popovers
    document.querySelectorAll('.popover:not(.hidden)').forEach(p => {
      if (p !== popover) p.classList.add('hidden');
    });

    if (isHidden) {
      renderMemoryPopover();
      popover.classList.remove('hidden');
    } else {
      popover.classList.add('hidden');
    }
  });

  // Close popover when clicking outside
  document.addEventListener('click', (e) => {
    if (popover && !popover.contains(e.target) && !btnOpen.contains(e.target)) {
      popover.classList.add('hidden');
    }
  });

  if (btnShowAll) {
    btnShowAll.addEventListener('click', () => {
      popover.classList.add('hidden');
      renderMemory();
      openWindow(panel);
      // Close settings panel if open
      closeWindow('settings-panel');
    });
  }

  btnClose.addEventListener('click', () => closeWindow(panel));

  // Listen for memory updates from chat
  window.addEventListener('memory-updated', () => {
    if (!panel.classList.contains('hidden')) {
      renderMemory();
    }
    if (popover && !popover.classList.contains('hidden')) {
      renderMemoryPopover();
    }
  });
}

function renderMemoryPopover() {
  const content = document.getElementById('memory-popover-content');
  if (!content) return;

  if (!appState.currentCharacter) {
    content.innerHTML = `<div class="empty-state small" style="padding: 16px 0;"><p>Select a character</p></div>`;
    return;
  }

  const memory = memoryService.getMemory(appState.currentCharacter.id);
  const entries = memory.entries || [];

  if (entries.length === 0) {
    content.innerHTML = `<div class="empty-state small" style="padding: 16px 0;"><p>No memories yet</p></div>`;
    return;
  }

  const categoryIcons = {
    fact: '💡',
    preference: '❤️',
    event: '📌',
  };

  // Get last 5 memories, sorted by timestamp descending
  const recentEntries = [...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);

  content.innerHTML = recentEntries.map(entry => `
    <div class="memory-entry" style="padding: 8px; background: var(--bg-primary); border-radius: var(--radius-sm); border: 1px solid var(--border-light); margin-bottom: 0;">
      <div class="memory-entry-icon" style="font-size: 14px; margin-right: 8px;">${categoryIcons[entry.category] || '📝'}</div>
      <div class="memory-entry-body">
        <div class="memory-entry-content" style="font-size: var(--text-xs); line-height: 1.4;">${escapeHtml(entry.content)}</div>
      </div>
    </div>
  `).join('');
}

function renderMemory() {
  const content = document.getElementById('memory-content');

  if (!appState.currentCharacter) {
    content.innerHTML = `<div class="empty-state small"><p>Select a character to view their memory</p></div>`;
    return;
  }

  const memory = memoryService.getMemory(appState.currentCharacter.id);
  const entries = memory.entries || [];

  if (entries.length === 0) {
    content.innerHTML = `
      <div class="empty-state small">
        <p>No memories yet for <strong>${escapeHtml(appState.currentCharacter.name)}</strong></p>
        <p style="font-size: var(--text-xs); margin-top: var(--space-2);">
          Memories are automatically extracted during conversations when Auto Memory is enabled.
        </p>
      </div>
    `;
    return;
  }

  // Group by category
  const facts = entries.filter(e => e.category === 'fact');
  const preferences = entries.filter(e => e.category === 'preference');
  const events = entries.filter(e => e.category === 'event');

  const categoryIcons = {
    fact: '💡',
    preference: '❤️',
    event: '📌',
  };

  let html = `<div style="margin-bottom: var(--space-3); font-size: var(--text-xs); color: var(--text-tertiary);">
    ${entries.length} memor${entries.length === 1 ? 'y' : 'ies'} for ${escapeHtml(appState.currentCharacter.name)}
  </div>`;

  const renderSection = (title, items) => {
    if (items.length === 0) return '';
    let s = `<div class="memory-section-title">${title} (${items.length})</div>`;
    s += items.map(entry => `
      <div class="memory-entry" data-entry-id="${entry.id}">
        <div class="memory-entry-icon">${categoryIcons[entry.category] || '📝'}</div>
        <div class="memory-entry-body">
          <div class="memory-entry-content">${escapeHtml(entry.content)}</div>
          <div class="memory-entry-meta">
            <span class="memory-entry-category">${entry.category}</span>
            · <span data-timestamp="${entry.timestamp || ''}" data-custom-tooltip="${formatExactTime(entry.timestamp)}">${formatTime(entry.timestamp)}</span>
          </div>
        </div>
        <button class="memory-entry-delete" data-delete-entry="${entry.id}" title="Delete memory">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `).join('');
    return s;
  };

  html += renderSection('Facts', facts);
  html += renderSection('Preferences', preferences);
  html += renderSection('Events', events);

  content.innerHTML = html;

  // Delete handlers
  content.querySelectorAll('[data-delete-entry]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const entryId = btn.dataset.deleteEntry;
      await memoryService.deleteEntry(appState.currentCharacter.id, entryId);
      const entryEl = btn.closest('.memory-entry');
      if (entryEl) {
        entryEl.style.opacity = '0';
        entryEl.style.transform = 'translateX(20px)';
        entryEl.style.transition = 'all 0.3s ease';
        setTimeout(() => {
          renderMemory();
        }, 300);
      }
      showToast('Memory deleted');
    });
  });
}
