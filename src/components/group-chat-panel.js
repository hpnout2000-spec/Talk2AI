/* ════════════════════════════════════════════════════════════════════
   Group Chat Panel — Sidebar management for group chats
   ════════════════════════════════════════════════════════════════════ */

import { groupChatStore } from '../services/group-chat-store.js';
import { characterStore } from '../services/character-store.js';
import { appState } from '../state.js';
import { showToast, showConfirm, openWindow, closeWindow } from '../main.js';
import { escapeHtml } from '../utils/helpers.js';
import { selectGroup, renderGroupHistoryInPanel, renderGroupHeader } from './group-chat-view.js';

let groupListEl;
let groupHistoryListEl;
let btnAddGroup;
let groupModal;
let groupModalTitle;
let groupNameInput;
let groupResponseModeSelect;
let groupCharactersListEl;
let btnSaveGroupModal;
let btnCancelGroupModal;

let editingGroupId = null;

export function initGroupChatPanel() {
  groupListEl = document.getElementById('group-list');
  groupHistoryListEl = document.getElementById('group-history-list');
  btnAddGroup = document.getElementById('btn-add-group');
  groupModal = document.getElementById('group-modal');
  groupModalTitle = document.getElementById('group-modal-title');
  groupNameInput = document.getElementById('group-modal-name');
  groupResponseModeSelect = document.getElementById('group-modal-response-mode');
  groupCharactersListEl = document.getElementById('group-modal-characters');
  btnSaveGroupModal = document.getElementById('btn-save-group-modal');
  btnCancelGroupModal = document.getElementById('btn-cancel-group-modal');

  if (!groupListEl) return;

  renderGroupList();

  btnAddGroup?.addEventListener('click', () => openGroupModal(null));

  btnSaveGroupModal?.addEventListener('click', saveGroupModal);
  btnCancelGroupModal?.addEventListener('click', () => closeWindow(groupModal));

  groupModal?.querySelector('.btn-close-group-modal')?.addEventListener('click', () => closeWindow(groupModal));

  // Listen for external updates (e.g. from genai or members popover)
  window.addEventListener('group-updated', () => {
    renderGroupList();
    renderGroupHistoryInPanel();
  });
}

// ─── Render group list ────────────────────────────────────────────────

export function renderGroupList() {
  if (!groupListEl) return;
  const groups = groupChatStore.getGroups();
  const activeGroupId = groupChatStore.getActiveGroupId();

  if (groups.length === 0) {
    groupListEl.innerHTML = `<div class="empty-state small"><p>No group chats yet</p></div>`;
    return;
  }

  groupListEl.innerHTML = groups.map(group => {
    const chars = (group.character_ids || [])
      .map(id => characterStore.getById(id))
      .filter(Boolean)
      .slice(0, 3);

    const avatarsHtml = chars.map(c => {
      if (c.avatar) return `<img src="${c.avatar}" alt="${escapeHtml(c.name)}" title="${escapeHtml(c.name)}">`;
      return `<span class="group-avatar-placeholder" title="${escapeHtml(c.name)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
      </span>`;
    }).join('');

    const extraCount = (group.character_ids?.length || 0) - 3;

    return `
      <div class="character-item group-item ${group.id === activeGroupId ? 'active' : ''}" data-group-id="${group.id}">
        <div class="group-item-avatars">
          ${avatarsHtml}
          ${extraCount > 0 ? `<span class="group-avatar-extra">+${extraCount}</span>` : ''}
        </div>
        <div class="character-item-info">
          <div class="character-item-name">${escapeHtml(group.name)}</div>
          <div class="character-item-desc">${group.character_ids?.length || 0} member${(group.character_ids?.length || 0) !== 1 ? 's' : ''} · ${group.response_mode === 'auto' ? '🤖 Auto' : '↻ Round-robin'}</div>
        </div>
        <div class="character-item-actions">
          <button class="edit" data-edit-group="${group.id}" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="delete" data-delete-group="${group.id}" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Click → select group
  groupListEl.querySelectorAll('.group-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.character-item-actions')) return;
      const id = item.dataset.groupId;
      const group = groupChatStore.getGroupById(id);
      if (group) selectGroup(group);
      // Update active state
      groupListEl.querySelectorAll('.group-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    });
  });

  // Edit
  groupListEl.querySelectorAll('[data-edit-group]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = groupChatStore.getGroupById(btn.dataset.editGroup);
      if (group) openGroupModal(group);
    });
  });

  // Delete
  groupListEl.querySelectorAll('[data-delete-group]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteGroup;
      const confirmed = await showConfirm('Delete Group', 'Are you sure you want to delete this group and all its chats?');
      if (confirmed) {
        await groupChatStore.deleteGroup(id);
        renderGroupList();
        showToast('Group deleted');

        // Hide group view if this was the active group
        if (groupChatStore.getActiveGroupId() === null) {
          document.getElementById('group-chat-view-container')?.classList.add('hidden');
          document.getElementById('group-chat-view-container') && (document.getElementById('group-chat-view-container').style.display = 'none');
        }
      }
    });
  });
}

// ─── Group Modal ──────────────────────────────────────────────────────

function openGroupModal(group = null) {
  editingGroupId = group?.id || null;
  if (groupModalTitle) groupModalTitle.textContent = group ? 'Edit Group' : 'Create Group Chat';
  if (groupNameInput) groupNameInput.value = group?.name || '';
  if (groupResponseModeSelect) groupResponseModeSelect.value = group?.response_mode || 'round_robin';

  // Render character checkboxes
  renderGroupModalCharacters(group?.character_ids || []);

  openWindow(groupModal);
}

function renderGroupModalCharacters(selectedIds) {
  if (!groupCharactersListEl) return;
  const allChars = characterStore.getAll();

  if (allChars.length === 0) {
    groupCharactersListEl.innerHTML = `<div style="color:var(--text-tertiary);font-size:var(--text-sm);text-align:center;padding:16px;">No characters yet. Create some first!</div>`;
    return;
  }

  groupCharactersListEl.innerHTML = allChars.map(c => {
    const isSelected = selectedIds.includes(c.id);
    return `
      <label class="group-char-checkbox-item ${isSelected ? 'selected' : ''}" data-char-id="${c.id}">
        <div class="group-char-checkbox-avatar">
          ${c.avatar
            ? `<img src="${c.avatar}" alt="${escapeHtml(c.name)}">`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>`
          }
        </div>
        <span>${escapeHtml(c.name)}</span>
        <input type="checkbox" class="group-char-check" value="${c.id}" ${isSelected ? 'checked' : ''} style="margin-left:auto;">
      </label>
    `;
  }).join('');

  // Visual toggle for labels
  groupCharactersListEl.querySelectorAll('.group-char-checkbox-item').forEach(label => {
    label.addEventListener('click', () => {
      const cb = label.querySelector('input[type="checkbox"]');
      cb.checked = !cb.checked;
      label.classList.toggle('selected', cb.checked);
    });
  });
}

async function saveGroupModal() {
  const name = groupNameInput?.value.trim();
  if (!name) {
    showToast('Group name is required', 'error');
    return;
  }

  const checkedIds = Array.from(groupCharactersListEl?.querySelectorAll('.group-char-check:checked') || [])
    .map(cb => cb.value);

  if (checkedIds.length < 1) {
    showToast('Add at least one character to the group', 'error');
    return;
  }

  const responseMode = groupResponseModeSelect?.value || 'round_robin';

  const groupData = {
    id: editingGroupId || undefined,
    name,
    character_ids: checkedIds,
    response_mode: responseMode,
  };

  const saved = await groupChatStore.saveGroup(groupData);
  closeWindow(groupModal);
  renderGroupList();
  showToast(editingGroupId ? 'Group updated' : 'Group created');

  // If new group, select it
  if (!editingGroupId && saved) {
    selectGroup(saved);
    groupListEl.querySelectorAll('.group-item').forEach(i => {
      i.classList.toggle('active', i.dataset.groupId === saved.id);
    });
  } else if (editingGroupId) {
    // Re-render header if this group is active
    if (groupChatStore.getActiveGroupId() === editingGroupId) {
      renderGroupHeader(saved);
    }
    window.dispatchEvent(new CustomEvent('group-updated', { detail: { id: editingGroupId } }));
  }

  editingGroupId = null;
}
