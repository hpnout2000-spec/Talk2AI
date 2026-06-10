/* ════════════════════════════════════════════════════════════════════
   Group Chat View — Main chat interface for group chats
   ════════════════════════════════════════════════════════════════════ */

import { groupChatStore } from '../services/group-chat-store.js';
import { characterStore } from '../services/character-store.js';
import { gameStore } from '../services/game-store.js';
import { api } from '../services/api.js';
import { settingsStore } from '../services/settings-store.js';
import { appState } from '../state.js';
import {
  renderMarkdown,
  autoResizeTextarea,
  formatTime,
  escapeHtml,
  wrapWordsInSpans,
} from '../utils/helpers.js';
import { showToast, showConfirm } from '../main.js';
import morphdom from '../vendor/morphdom.js';

// ─── DOM refs ────────────────────────────────────────────────────────
let messagesContainer;
let messageInput;
let btnSend;
let btnStop;
let headerGroupName;
let headerMembersAvatars;
let headerModeDropdown;
let membersPopover;
let viewContainer;

let isGroupGenerating = false;
let groupAbortController = null;

// ─── Init ────────────────────────────────────────────────────────────

export function initGroupChatView() {
  viewContainer = document.getElementById('group-chat-view-container');
  messagesContainer = document.getElementById('group-chat-messages');
  messageInput = document.getElementById('group-chat-input');
  btnSend = document.getElementById('btn-group-send');
  btnStop = document.getElementById('btn-group-stop');
  headerGroupName = document.getElementById('group-header-name');
  headerMembersAvatars = document.getElementById('group-header-avatars');
  headerModeDropdown = document.getElementById('group-mode-dropdown');
  membersPopover = document.getElementById('group-members-popover');

  if (!messagesContainer) return;

  btnSend?.addEventListener('click', handleSend);
  messageInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  messageInput?.addEventListener('input', () => autoResizeTextarea(messageInput));

  btnStop?.addEventListener('click', () => {
    if (groupAbortController) groupAbortController.abort();
  });

  headerGroupName?.addEventListener('click', toggleMembersPopover);

  // Custom Dropdown Logic
  const selectedArea = headerModeDropdown?.querySelector('.dropdown-selected');
  const optionsArea = headerModeDropdown?.querySelector('.dropdown-options');

  selectedArea?.addEventListener('click', (e) => {
    e.stopPropagation();
    optionsArea?.classList.toggle('hidden');
  });

  optionsArea?.querySelectorAll('.dropdown-option').forEach(opt => {
    opt.addEventListener('click', async (e) => {
      e.stopPropagation();
      const val = opt.dataset.value;
      const group = groupChatStore.getGroupById(groupChatStore.getActiveGroupId());
      if (group) {
        await groupChatStore.updateGroupResponseMode(group.id, val);
        const name = opt.textContent.trim();
        if (selectedArea) selectedArea.innerHTML = `<span>${name}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="6 9 12 15 18 9"/></svg>`;
        optionsArea.classList.add('hidden');
      }
    });
  });

  document.addEventListener('click', () => {
    optionsArea?.classList.add('hidden');
  });

  // Global click delegation for character mentions in group chat
  messagesContainer.addEventListener('click', (e) => {
    const mention = e.target.closest('.char-mention');
    if (mention) {
      const charName = mention.getAttribute('data-char-name');
      const cleanedName = cleanCharacterName(charName);
      
      const game = gameStore.get();
      if (game && game.characters) {
        const char = game.characters.find(c => cleanCharacterName(c.name).toLowerCase() === cleanedName.toLowerCase());
        if (char) {
          showCharacterTooltip(mention, char);
          return;
        }
      }
      
      const globalChars = characterStore.getAll();
      const globalChar = globalChars.find(c => cleanCharacterName(c.name).toLowerCase() === cleanedName.toLowerCase());
      if (globalChar) {
        showCharacterTooltip(mention, globalChar);
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (membersPopover && !membersPopover.classList.contains('hidden')) {
      if (!membersPopover.contains(e.target) && !headerGroupName?.contains(e.target)) {
        membersPopover.classList.add('hidden');
      }
    }
  });

  document.getElementById('btn-group-new-chat')?.addEventListener('click', () => {
    const groupId = groupChatStore.getActiveGroupId();
    const group = groupChatStore.getGroupById(groupId);
    if (group) startNewGroupChat(group);
  });

  window.addEventListener('genai-switch-group', (e) => {
    const { group_id } = e.detail;
    const group = groupChatStore.getGroupById(group_id);
    if (!group) return;
    if (window.switchToGroupsTab) window.switchToGroupsTab();
    selectGroup(group);
  });

  window.addEventListener('genai-send-group-message', (e) => {
    const { content } = e.detail;
    if (!content || isGroupGenerating) return;
    if (messageInput) {
      messageInput.value = content;
      autoResizeTextarea(messageInput);
      handleSend();
    }
  });
}

// ─── Load group + session ─────────────────────────────────────────────

export async function selectGroup(group) {
  groupChatStore.setActiveGroupId(group.id);
  renderGroupHeader(group);
  showGroupChatView();

  try {
    await groupChatStore.loadSessionsForGroup(group.id);
    const sessions = groupChatStore.getSessionsForGroup(group.id);

    if (sessions.length > 0) loadGroupSession(sessions[0]);
    else startNewGroupChat(group);
  } finally {
    window.dispatchEvent(new CustomEvent('group-selected', { detail: { id: group.id } }));
  }
}

export function loadGroupSession(session) {
  if (!session) return;
  groupChatStore.setCurrentSession(session);
  clearGroupMessages();
  for (const msg of session.messages) {
    appendGroupMessage(msg);
  }
  scrollGroupToBottom();
  renderGroupHistoryInPanel();
}

export function startNewGroupChat(group) {
  const session = groupChatStore.createSession(group.id);
  groupChatStore.setCurrentSession(session);
  clearGroupMessages();
  groupChatStore.saveSession(session);
  renderGroupHistoryInPanel();
}

// ─── Send message ────────────────────────────────────────────────────

async function handleSend() {
  const content = messageInput.value.trim();
  if (!content || isGroupGenerating) return;

  const groupId = groupChatStore.getActiveGroupId();
  const group = groupChatStore.getGroupById(groupId);
  if (!group) return;
  
  const characters = (group.character_ids || []).map(id => characterStore.getById(id)).filter(Boolean);
  if (characters.length === 0) { showToast('Add characters first', 'error'); return; }

  let session = groupChatStore.getCurrentSession();
  if (!session) session = groupChatStore.createSession(group.id);

  const userMsg = groupChatStore.addMessage('user', content, null, session);
  appendGroupMessage(userMsg);
  await groupChatStore.saveSession(session);

  messageInput.value = '';
  autoResizeTextarea(messageInput);

  let respondingChar;
  if (group.response_mode === 'auto') {
    respondingChar = await pickCharacterWithAI(group, characters, session);
  } else {
    const idx = session.next_character_idx || 0;
    respondingChar = characters[idx % characters.length];
    session.next_character_idx = (idx + 1) % characters.length;
  }
  if (!respondingChar) respondingChar = characters[0];
  await generateGroupResponse(respondingChar, group, characters, session);
}

async function pickCharacterWithAI(group, characters, session) {
  try {
    const charNames = characters.map(c => c.name).join(', ');
    const history = session.messages.slice(-6).map(m => {
      const char = m.role === 'assistant' ? groupChatStore.getParticipant(m.character_id) : null;
      return {
        role: m.role,
        sender: m.role === 'user' ? (settingsStore.get().user_name || 'User') : (char?.name || 'Unknown'),
        content: m.original_text || m.content || ''
      };
    }).map(m => `${m.sender}: ${m.content}`).join('\n');

    const prompt = [
      { role: 'system', content: `You are an orchestrator for a group chat. Based on the conversation history, decide who should speak next.
Available characters: ${charNames}.
Reply ONLY with the name of the next speaker from the list. If you think it's the User's turn, reply "User".` },
      { role: 'user', content: `History:\n${history}\n\nNext speaker?` }
    ];

    const result = await api.chatCompletion(prompt, { max_tokens: 20, temperature: 0.1 });
    const pickedRaw = result.trim();
    
    // Robust matching logic
    const normalizedInput = pickedRaw.toLowerCase().replace(/[^\w\sа-яё]/gi, '').trim();
    if (!normalizedInput || normalizedInput === 'user') return null;

    // Sort by name length descending to prioritize longer matches (e.g. "Alice Smith" before "Alice")
    const sortedChars = [...characters].sort((a, b) => b.name.length - a.name.length);

    // 1. Exact or bidirectional inclusion match
    let found = sortedChars.find(c => {
      const normName = c.name.toLowerCase().replace(/[^\w\sа-яё]/gi, '').trim();
      return normalizedInput === normName || normalizedInput.includes(normName) || normName.includes(normalizedInput);
    });

    return found || characters[0];
  } catch (e) { 
    console.error('Pick speaker AI failed:', e);
    return characters[0]; 
  }
}

async function generateGroupResponse(respondingChar, group, characters, session) {
  isGroupGenerating = true;
  groupAbortController = new AbortController();
  btnSend?.classList.add('hidden');
  btnStop?.classList.remove('hidden');
  const assistantMsg = groupChatStore.addMessage('assistant', '', respondingChar.id, session);
  const msgEl = appendGroupMessage(assistantMsg, true);
  const contentEl = msgEl.querySelector('.group-msg-text');
  const apiMessages = buildGroupApiMessages(respondingChar, characters, session);
  let fullResponse = '';
  try {
    await api.streamChat(apiMessages, groupAbortController.signal, (chunk) => {
      fullResponse += chunk;
      if (contentEl) {
        const cleaned = stripJsonBlocks(fullResponse, true);
        let formatted = renderMarkdown(cleaned);
        formatted = processCharacterMentions(formatted);
        const html = wrapWordsInSpans(formatted);
        const temp = document.createElement('div');
        temp.innerHTML = html + '<span class="streaming-cursor"></span>';
        morphdom(contentEl, temp, { childrenOnly: true });
        scrollGroupToBottom();
      }
    }, async () => {
      groupChatStore.updateLastAssistantMessage(fullResponse, session);
      await groupChatStore.saveSession(session);
      const newEl = appendGroupMessage(assistantMsg, false);
      if (msgEl.parentNode) msgEl.replaceWith(newEl);
      finishGroupGeneration();
      renderGroupHistoryInPanel();
    }, (err) => {
      if (err.name === 'AbortError' && fullResponse) {
        groupChatStore.updateLastAssistantMessage(fullResponse, session);
        groupChatStore.saveSession(session);
        const newEl = appendGroupMessage(assistantMsg, false);
        if (msgEl.parentNode) msgEl.replaceWith(newEl);
      }
      finishGroupGeneration();
    });
  } catch (err) { finishGroupGeneration(); }
}

function finishGroupGeneration() {
  isGroupGenerating = false;
  groupAbortController = null;
  btnSend?.classList.remove('hidden');
  btnStop?.classList.add('hidden');
}

export function buildGroupApiMessages(respondingChar, allCharacters, session) {
  const settings = settingsStore.get();
  const userName = settings.user_name || 'User';
  const messages = [];
  const otherChars = allCharacters.filter(c => c.id !== respondingChar.id);
  
  let sys = respondingChar.system_prompt || [respondingChar.description, respondingChar.personality].filter(Boolean).join('\n\n') || `You are ${respondingChar.name}.`;
  sys = sys.replace(/\{\{user\}\}/gi, userName).replace(/\{\{char\}\}/gi, respondingChar.name);
  
  sys += `\n\n[GROUP CHAT RULES]
- You are ${respondingChar.name} in a group chat.
- Other members: ${otherChars.map(c => c.name).join(', ')}.
- In the history below, each message is prefixed with the speaker's name.
- Respond naturally as ${respondingChar.name}.`;

  messages.push({ role: 'system', content: sys });

  for (const m of session.messages) {
    if (m.role === 'user') {
      messages.push({ role: 'user', content: `${userName}: ${m.content}` });
    } else if (m.role === 'assistant' && m.content) {
      const char = allCharacters.find(x => x.id === m.character_id);
      const name = char?.name || 'AI';
      
      if (m.character_id === respondingChar.id) {
        messages.push({ role: 'assistant', content: `${name}: ${m.content}` });
      } else {
        // Use 'user' role for other AI characters so the model sees them as external participants
        messages.push({ role: 'user', content: `${name}: ${m.content}` });
      }
    }
  }
  return messages;
}

function appendGroupMessage(msg, isStreaming = false) {
  const empty = messagesContainer.querySelector('.empty-state');
  if (empty) empty.remove();
  const el = document.createElement('div');
  const isUser = msg.role === 'user';
  el.className = `group-message ${msg.role} message-enter`;
  const char = isUser ? null : characterStore.getById(msg.character_id);
  const settings = settingsStore.get();
  const senderName = isUser ? (settings.user_name || 'You') : (char?.name || 'Unknown');
  const avatarHtml = isUser ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>' : (char?.avatar ? `<img src="${char.avatar}">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>');
  
  const cleanedContent = stripJsonBlocks(msg.content || '', isStreaming);
  let formattedContent = renderMarkdown(cleanedContent);
  formattedContent = processCharacterMentions(formattedContent);
  const contentHtml = formattedContent;
  const meta = !isStreaming ? `<div class="group-msg-meta"><span class="group-msg-time">${formatTime(msg.timestamp)}</span><div class="message-actions"><button class="btn-regenerate ${isUser ? 'hidden' : ''}" title="Regen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg></button><button class="btn-edit-msg" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="btn-copy" title="Copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button><button class="btn-ai-comment ${isUser ? 'hidden' : ''}" title="Comment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><path d="M12 7l1.5 3 3.5.5-2.5 2.5.5 3.5-3-1.5-3 1.5.5-3.5-2.5-2.5 3.5-.5z"/></svg></button><button class="btn-delete-msg delete" title="Del"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div></div>` : '';
  el.innerHTML = `<div class="group-msg-avatar">${avatarHtml}</div><div class="group-msg-body"><div class="group-msg-sender">${escapeHtml(senderName)}</div><div class="group-msg-bubble"><div class="group-msg-text">${isStreaming ? '<span class="streaming-cursor"></span>' : contentHtml}</div></div>${meta}</div>`;
  if (!isStreaming) {
    el.querySelector('.btn-copy')?.addEventListener('click', () => { navigator.clipboard.writeText(msg.content); showToast('Copied'); });
    el.querySelector('.btn-delete-msg')?.addEventListener('click', async () => { if (await showConfirm('Delete?')) { groupChatStore.deleteMessage(msg.id); el.remove(); groupChatStore.saveGroups(); } });
    el.querySelector('.btn-edit-msg')?.addEventListener('click', () => { 
      const t = prompt('Edit:', msg.content); 
      if (t !== null) { 
        msg.content = t; 
        const cleaned = stripJsonBlocks(t, false);
        let formatted = renderMarkdown(cleaned);
        formatted = processCharacterMentions(formatted);
        el.querySelector('.group-msg-text').innerHTML = formatted; 
        groupChatStore.saveGroups(); 
      } 
    });
    el.querySelector('.btn-ai-comment')?.addEventListener('click', () => { if (window.requestAiComment && char) window.requestAiComment(msg, char); });
    el.querySelector('.btn-regenerate')?.addEventListener('click', () => regenerateGroupResponse(msg, el));
  }
  messagesContainer.appendChild(el);
  scrollGroupToBottom();
  return el;
}

async function regenerateGroupResponse(oldMsg, el) {
  if (isGroupGenerating) return;
  const session = groupChatStore.getActiveSession();
  const idx = session.messages.findIndex(m => m.id === oldMsg.id);
  if (idx === -1) return;
  session.messages = session.messages.slice(0, idx);
  while(el.nextElementSibling) el.nextElementSibling.remove();
  el.remove();
  await groupChatStore.saveGroups();
  handleSend();
}

function clearGroupMessages() { messagesContainer.innerHTML = '<div class="empty-state"><h2>Group Chat</h2><p>Send a message!</p></div>'; }
function scrollGroupToBottom() {
  requestAnimationFrame(() => {
    if (!messagesContainer) return;
    const messages = Array.from(messagesContainer.querySelectorAll('.group-message'));
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      const containerRect = messagesContainer.getBoundingClientRect();
      const lastRect = lastMsg.getBoundingClientRect();
      
      const lastBottom = lastRect.bottom - containerRect.top + messagesContainer.scrollTop;
      const maxScrollTop = messagesContainer.scrollHeight - containerRect.height;
      
      let targetScrollTop = maxScrollTop;
      
      let lastUserMsg = null;
      let lastAssistantMsg = null;
      
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.classList.contains('user')) {
          if (!lastUserMsg) lastUserMsg = msg;
        } else {
          if (!lastAssistantMsg) lastAssistantMsg = msg;
        }
        if (lastUserMsg && lastAssistantMsg) break;
      }
      
      if (lastUserMsg && lastAssistantMsg) {
        const userIndex = messages.indexOf(lastUserMsg);
        const assistantIndex = messages.indexOf(lastAssistantMsg);
        const firstEl = userIndex < assistantIndex ? lastUserMsg : lastAssistantMsg;
        const lastEl = lastMsg;
        
        const firstRect = firstEl.getBoundingClientRect();
        const lastRect = lastEl.getBoundingClientRect();
        
        const firstTop = firstRect.top - containerRect.top + messagesContainer.scrollTop;
        const lastBottom = lastRect.bottom - containerRect.top + messagesContainer.scrollTop;
        const combinedHeight = lastBottom - firstTop;
        
        if (combinedHeight < containerRect.height - 40) {
          targetScrollTop = Math.max(0, firstTop - 20);
          targetScrollTop = Math.min(targetScrollTop, maxScrollTop);
        }
      } else {
        const lastTop = lastRect.top - containerRect.top + messagesContainer.scrollTop;
        if (lastBottom - lastTop < containerRect.height - 40) {
          targetScrollTop = Math.max(0, lastTop - 20);
          targetScrollTop = Math.min(targetScrollTop, maxScrollTop);
        }
      }
      
      messagesContainer.scrollTop = targetScrollTop;
    } else {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  });
}

export function renderGroupHeader(group) {
  if (!group) return;
  if (headerGroupName) headerGroupName.textContent = group.name;
  if (headerMembersAvatars) {
    const chars = (group.character_ids || []).map(id => characterStore.getById(id)).filter(Boolean).slice(0, 5);
    headerMembersAvatars.innerHTML = chars.map(c => `<div class="group-header-avatar">${c.avatar ? `<img src="${c.avatar}">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>'}</div>`).join('');
    if (group.character_ids.length > 5) headerMembersAvatars.innerHTML += `<div class="group-header-avatar-more">+${group.character_ids.length - 5}</div>`;
  }
  renderHeaderModeUI(group);
}

function renderHeaderModeUI(group) {
  if (!group) group = groupChatStore.getGroupById(groupChatStore.getActiveGroupId());
  if (group && headerModeDropdown) {
    const mode = group.response_mode || 'round_robin';
    const textEl = headerModeDropdown.querySelector('#group-mode-selected-text');
    const options = headerModeDropdown.querySelectorAll('.dropdown-option');
    if (textEl) textEl.textContent = mode === 'auto' ? '🤖 Auto' : '↻ Round-robin';
    options.forEach(opt => opt.classList.toggle('active', opt.dataset.value === mode));
  }
}

function toggleMembersPopover() {
  if (membersPopover?.classList.contains('hidden')) { renderMembersPopover(); membersPopover.classList.remove('hidden'); }
  else membersPopover?.classList.add('hidden');
}

function renderMembersPopover() {
  const group = groupChatStore.getGroupById(groupChatStore.getActiveGroupId());
  if (!group) return;
  const all = characterStore.getAll();
  const ids = new Set(group.character_ids || []);
  membersPopover.innerHTML = `<div class="group-popover-header"><span>Edit Members</span><button id="btn-close-group-popover" class="btn-icon small"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="group-popover-members">${all.map(c => `<div class="group-popover-member"><div class="group-popover-avatar">${c.avatar ? `<img src="${c.avatar}">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>'}</div><span class="group-popover-name">${escapeHtml(c.name)}</span><label class="toggle-switch small" style="margin-left:auto; flex-shrink:0;"><input type="checkbox" class="member-toggle" data-char-id="${c.id}" ${ids.has(c.id) ? 'checked' : ''}><span class="toggle-slider"></span></label></div>`).join('')}</div>`;
  membersPopover.querySelector('#btn-close-group-popover')?.addEventListener('click', () => membersPopover.classList.add('hidden'));
  membersPopover.querySelectorAll('.member-toggle').forEach(cb => cb.addEventListener('change', async () => {
    let current = [...(group.character_ids || [])];
    if (cb.checked) { if (!current.includes(cb.dataset.charId)) current.push(cb.dataset.charId); }
    else current = current.filter(id => id !== cb.dataset.charId);
    await groupChatStore.updateGroupMembers(group.id, current);
    renderGroupHeader(group);
    window.dispatchEvent(new CustomEvent('group-updated', { detail: { id: group.id } }));
  }));
}

export function showGroupChatView() {
  document.getElementById('chat-view-container')?.classList.add('hidden');
  document.getElementById('chat-view-container') && (document.getElementById('chat-view-container').style.display = 'none');
  document.getElementById('book-view-container')?.classList.add('hidden');
  document.getElementById('book-view-container') && (document.getElementById('book-view-container').style.display = 'none');
  const v = document.getElementById('group-chat-view-container');
  if (v) { v.classList.remove('hidden'); v.style.display = 'flex'; }
}

export function renderGroupHistoryInPanel() {
  const list = document.getElementById('group-history-list');
  if (!list) return;
  const groupId = groupChatStore.getActiveGroupId();
  if (!groupId) return;
  const sessions = groupChatStore.getSessionsForGroup(groupId);
  const current = groupChatStore.getCurrentSession();
  if (!sessions.length) { list.innerHTML = '<div class="empty-state small">No chats</div>'; return; }
  list.innerHTML = sessions.map(s => {
    const first = s.messages.find(m => m.role === 'user');
    const title = first ? first.content.substring(0, 40) + '...' : 'New Chat';
    return `<div class="chat-history-item ${current?.id === s.id ? 'active' : ''}" data-group-session-id="${s.id}"><div class="chat-history-item-info"><div class="chat-history-item-title">${escapeHtml(title)}</div><div class="chat-history-item-date">${formatTime(s.updated_at)}</div></div><button class="chat-history-item-delete" data-delete-group-session="${s.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`;
  }).join('');
  if (!list._groupListeners) {
    list._groupListeners = true;
    list.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-delete-group-session]');
      if (del) { e.stopPropagation(); await groupChatStore.deleteSession(groupId, del.dataset.deleteGroupSession); renderGroupHistoryInPanel(); return; }
      const item = e.target.closest('[data-group-session-id]');
      if (item) { const s = groupChatStore.getSessionsForGroup(groupId).find(x => x.id === item.dataset.groupSessionId); if (s) loadGroupSession(s); }
    });
  }
}

// ─── Character Mentions & JSON Cleaning Helpers ───

function cleanCharacterName(name) {
  if (!name) return '';
  return name.replace(/\{\{char:/g, '').replace(/\}\}/g, '').replace(/char:/g, '').trim();
}

function stripJsonBlocks(text, isStreaming = false) {
  if (!text) return '';
  
  let cleaned = text;

  // 1. Remove complete markdown JSON blocks
  cleaned = cleaned.replace(/```json[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/```[\s\S]*?```/g, (match) => {
    const inner = match.slice(3, -3).trim();
    if ((inner.startsWith('{') && inner.endsWith('}')) || (inner.startsWith('[') && inner.endsWith(']'))) {
      return '';
    }
    return match;
  });

  // 2. If streaming, remove any incomplete markdown code blocks starting with ```json or ```{
  if (isStreaming) {
    const index = cleaned.indexOf('```json');
    if (index !== -1) {
      cleaned = cleaned.substring(0, index);
    }
    const indexPlain = cleaned.indexOf('```');
    if (indexPlain !== -1) {
      const rest = cleaned.substring(indexPlain + 3).trim();
      if (rest.startsWith('{') || rest.startsWith('[')) {
        cleaned = cleaned.substring(0, indexPlain);
      }
    }
    // Hide partial char mentions so they don't leak as raw text during streaming
    cleaned = cleaned.replace(/\{\{[^}]*$/, '');
  }

  // 3. Remove raw trailing JSON objects or arrays
  const lastCurly = cleaned.lastIndexOf('{');
  if (lastCurly !== -1) {
    const candidate = cleaned.substring(lastCurly).trim();
    if (candidate.startsWith('{') && (candidate.includes('":') || candidate.endsWith('}'))) {
      cleaned = cleaned.substring(0, lastCurly);
    }
  }
  const lastSquare = cleaned.lastIndexOf('[');
  if (lastSquare !== -1) {
    const candidate = cleaned.substring(lastSquare).trim();
    if (candidate.startsWith('[') && (candidate.includes('{') || candidate.endsWith(']')) && !candidate.toLowerCase().includes('loader:')) {
      cleaned = cleaned.substring(0, lastSquare);
    }
  }

  return cleaned.trim();
}

function processCharacterMentions(text) {
  if (!text) return '';
  return text.replace(/\{\{char:([^|}]+)(?:\|([^}]+))?\}\}/g, (match, name, alias) => {
    const displayName = alias ? alias.trim() : name.trim();
    return `<span class="char-mention" data-char-name="${name.trim()}">${displayName}</span>`;
  });
}

function showCharacterTooltip(element, char) {
  // Remove existing tooltips
  document.querySelectorAll('.char-tooltip').forEach(t => t.remove());

  const tooltip = document.createElement('div');
  tooltip.className = 'char-tooltip';
  tooltip.style.position = 'absolute';
  tooltip.style.background = 'rgba(15, 15, 20, 0.95)';
  tooltip.style.backdropFilter = 'blur(10px)';
  tooltip.style.border = '1px solid var(--border-subtle)';
  tooltip.style.borderRadius = 'var(--radius-md)';
  tooltip.style.padding = '12px 16px';
  tooltip.style.zIndex = '9999';
  tooltip.style.maxWidth = '250px';
  tooltip.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
  tooltip.style.color = 'var(--text-primary)';
  tooltip.style.animation = 'fadeIn 0.2s ease';
  
  const shortDesc = char.short_description || char.description || 'No description available.';
  tooltip.innerHTML = `
    <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 4px; color: var(--text-accent);">${char.name}</div>
    <div style="font-size: 0.85rem; line-height: 1.4; color: var(--text-secondary);">${shortDesc}</div>
  `;

  document.body.appendChild(tooltip);

  const rect = element.getBoundingClientRect();
  tooltip.style.top = `${rect.bottom + window.scrollY + 8}px`;
  
  // Center relative to element, but keep inside window bounds
  let left = rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2);
  if (left < 10) left = 10;
  if (left + tooltip.offsetWidth > window.innerWidth - 10) {
    left = window.innerWidth - tooltip.offsetWidth - 10;
  }
  tooltip.style.left = `${left}px`;

  // Close when clicking outside
  const closeHandler = (e) => {
    if (!tooltip.contains(e.target) && e.target !== element) {
      tooltip.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  
  // Use timeout to avoid immediately closing from the current click event
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
  }, 10);
}
