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

// Search/Sort refs
let groupSearchInput;
let btnSortName;
let btnSortDate;

let editingGroupId = null;
let currentSearch = '';
let currentSort = 'name'; // 'name' or 'date'

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

  groupSearchInput = document.getElementById('group-modal-search');
  btnSortName = document.getElementById('btn-group-sort-name');
  btnSortDate = document.getElementById('btn-group-sort-date');

  if (!groupListEl) return;

  renderGroupList();

  btnAddGroup?.addEventListener('click', () => openGroupModal(null));
  btnSaveGroupModal?.addEventListener('click', saveGroupModal);
  btnCancelGroupModal?.addEventListener('click', () => closeWindow(groupModal));
  groupModal?.querySelector('.btn-close-group-modal')?.addEventListener('click', () => closeWindow(groupModal));

  // Search logic
  groupSearchInput?.addEventListener('input', (e) => {
    currentSearch = e.target.value.toLowerCase();
    renderGroupModalCharacters(getSelectedIdsInModal());
  });

  // Sort logic
  btnSortName?.addEventListener('click', () => {
    currentSort = 'name';
    renderGroupModalCharacters(getSelectedIdsInModal());
  });

  btnSortDate?.addEventListener('click', () => {
    currentSort = 'date';
    renderGroupModalCharacters(getSelectedIdsInModal());
  });

  window.addEventListener('group-updated', () => {
    renderGroupList();
    renderGroupHistoryInPanel();
  });
}

function getSelectedIdsInModal() {
  return Array.from(groupCharactersListEl?.querySelectorAll('.group-char-check:checked') || [])
    .map(cb => cb.value);
}

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
      return `<span class="group-avatar-placeholder" title="${escapeHtml(c.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg></span>`;
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
          <div class="character-item-desc">${group.character_ids?.length || 0} members · ${group.response_mode === 'auto' ? '🤖 Auto' : '↻ Round'}</div>
        </div>
        <div class="character-item-actions">
          <button class="edit" data-edit-group="${group.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="delete" data-delete-group="${group.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
      </div>
    `;
  }).join('');

  groupListEl.querySelectorAll('.group-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.character-item-actions')) return;
      const group = groupChatStore.getGroupById(item.dataset.groupId);
      if (group) selectGroup(group);
      groupListEl.querySelectorAll('.group-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    });
  });

  groupListEl.querySelectorAll('[data-edit-group]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = groupChatStore.getGroupById(btn.dataset.editGroup);
      if (group) openGroupModal(group);
    });
  });

  groupListEl.querySelectorAll('[data-delete-group]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (await showConfirm('Delete Group', 'Delete this group?')) {
        await groupChatStore.deleteGroup(btn.dataset.deleteGroup);
        renderGroupList();
      }
    });
  });
}

function openGroupModal(group = null) {
  editingGroupId = group?.id || null;
  currentSearch = '';
  if (groupSearchInput) groupSearchInput.value = '';
  if (groupModalTitle) groupModalTitle.textContent = group ? 'Edit Group' : 'Create Group';
  if (groupNameInput) groupNameInput.value = group?.name || '';
  if (groupResponseModeSelect) groupResponseModeSelect.value = group?.response_mode || 'round_robin';

  renderGroupModalCharacters(group?.character_ids || []);
  openWindow(groupModal);
}

function renderGroupModalCharacters(selectedIds) {
  if (!groupCharactersListEl) return;
  let allChars = characterStore.getAll();

  // Filter
  if (currentSearch) {
    allChars = allChars.filter(c => c.name.toLowerCase().includes(currentSearch));
  }

  // Sort
  if (currentSort === 'name') {
    allChars.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    allChars.sort((a, b) => (b.last_chat_at || 0) - (a.last_chat_at || 0));
  }

  if (allChars.length === 0) {
    groupCharactersListEl.innerHTML = `<div class="empty-state small">No characters found</div>`;
    return;
  }

  groupCharactersListEl.innerHTML = allChars.map(c => {
    const isSelected = selectedIds.includes(c.id);
    return `
      <div class="group-char-checkbox-item ${isSelected ? 'selected' : ''}" data-char-id="${c.id}">
        <div class="group-char-checkbox-avatar">
          ${c.avatar ? `<img src="${c.avatar}">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>'}
        </div>
        <span>${escapeHtml(c.name)}</span>
        <input type="checkbox" class="group-char-check" value="${c.id}" ${isSelected ? 'checked' : ''}>
      </div>
    `;
  }).join('');

  groupCharactersListEl.querySelectorAll('.group-char-checkbox-item').forEach(item => {
    item.addEventListener('click', () => {
      const cb = item.querySelector('input[type="checkbox"]');
      if (cb) {
        cb.checked = !cb.checked;
        item.classList.toggle('selected', cb.checked);
      }
    });
  });
}

async function saveGroupModal() {
  const name = groupNameInput?.value.trim();
  if (!name) { showToast('Name required', 'error'); return; }
  const checkedIds = getSelectedIdsInModal();
  if (checkedIds.length < 1) { showToast('Add at least one character', 'error'); return; }

  const groupData = {
    id: editingGroupId || undefined,
    name,
    character_ids: checkedIds,
    response_mode: groupResponseModeSelect?.value || 'round_robin',
  };

  const saved = await groupChatStore.saveGroup(groupData);
  closeWindow(groupModal);
  renderGroupList();
  if (editingGroupId && groupChatStore.getActiveGroupId() === editingGroupId) renderGroupHeader(saved);
  editingGroupId = null;
}
