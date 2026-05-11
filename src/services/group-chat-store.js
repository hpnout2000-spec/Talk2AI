/* ════════════════════════════════════════════════════════════════════
   Group Chat Store — Group chat persistence
   ════════════════════════════════════════════════════════════════════ */

import { generateId } from '../utils/helpers.js';

const GROUPS_KEY = 'vibechat_groups';
const SESSIONS_KEY_PREFIX = 'vibechat_group_sessions_';

let groups = [];           // { id, name, character_ids, response_mode, created_at, updated_at }
let sessions = {};         // groupId → [session]
let currentGroupSession = null;
let activeGroupId = null;

async function invokeTauri(cmd, args = {}) {
  if (window.__TAURI_INTERNALS__) {
    return await window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  throw new Error('Not running in Tauri environment');
}

export const groupChatStore = {

  // ─── Groups ──────────────────────────────────────────────────────

  async loadGroups() {
    try {
      const saved = localStorage.getItem(GROUPS_KEY);
      if (saved) groups = JSON.parse(saved);
    } catch (e) {
      groups = [];
    }
    return groups;
  },

  getGroups() {
    return groups;
  },

  getGroupById(id) {
    return groups.find(g => g.id === id) || null;
  },

  async saveGroup(groupData) {
    if (groupData.id) {
      const idx = groups.findIndex(g => g.id === groupData.id);
      if (idx !== -1) {
        groups[idx] = { ...groups[idx], ...groupData, updated_at: new Date().toISOString() };
      } else {
        groups.push({ ...groupData, updated_at: new Date().toISOString() });
      }
    } else {
      const newGroup = {
        id: generateId(),
        name: groupData.name || 'New Group',
        character_ids: groupData.character_ids || [],
        response_mode: groupData.response_mode || 'round_robin',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      groups.unshift(newGroup);
      groupData = newGroup;
    }

    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
    } catch (e) {
      console.warn('Failed to save groups to localStorage', e);
    }

    return groups.find(g => g.id === groupData.id);
  },

  async deleteGroup(id) {
    groups = groups.filter(g => g.id !== id);
    delete sessions[id];
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
      localStorage.removeItem(SESSIONS_KEY_PREFIX + id);
    } catch (e) {}

    if (activeGroupId === id) activeGroupId = null;
    if (currentGroupSession?.group_id === id) currentGroupSession = null;
  },

  async updateGroupMembers(groupId, character_ids) {
    const group = this.getGroupById(groupId);
    if (!group) return null;
    group.character_ids = character_ids;
    group.updated_at = new Date().toISOString();
    await this.saveGroup(group);
    return group;
  },

  async updateGroupResponseMode(groupId, mode) {
    const group = this.getGroupById(groupId);
    if (!group) return null;
    group.response_mode = mode;
    group.updated_at = new Date().toISOString();
    await this.saveGroup(group);
    return group;
  },

  // ─── Sessions ─────────────────────────────────────────────────────

  async loadSessionsForGroup(groupId) {
    if (sessions.hasOwnProperty(groupId)) return sessions[groupId];

    try {
      const saved = localStorage.getItem(SESSIONS_KEY_PREFIX + groupId);
      if (saved) sessions[groupId] = JSON.parse(saved);
      else sessions[groupId] = [];
    } catch (e) {
      sessions[groupId] = [];
    }

    return sessions[groupId];
  },

  getSessionsForGroup(groupId) {
    return sessions[groupId] || [];
  },

  getCurrentSession() {
    return currentGroupSession;
  },

  setCurrentSession(session) {
    currentGroupSession = session;
  },

  getActiveGroupId() {
    return activeGroupId;
  },

  setActiveGroupId(id) {
    activeGroupId = id;
  },

  createSession(groupId) {
    const session = {
      id: generateId(),
      group_id: groupId,
      messages: [],
      next_character_idx: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    currentGroupSession = session;
    if (!sessions[groupId]) sessions[groupId] = [];
    sessions[groupId].unshift(session);
    return session;
  },

  addMessage(role, content, characterId = null, session = null) {
    const targetSession = session || currentGroupSession;
    if (!targetSession) return null;

    const message = {
      id: generateId(),
      role,
      content,
      character_id: characterId,
      timestamp: new Date().toISOString(),
    };
    targetSession.messages.push(message);
    targetSession.updated_at = new Date().toISOString();
    return message;
  },

  updateLastAssistantMessage(content, session = null) {
    const targetSession = session || currentGroupSession;
    if (!targetSession) return;
    const msgs = targetSession.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i].content = content;
        break;
      }
    }
    targetSession.updated_at = new Date().toISOString();
  },

  addAiComment(targetMessageId, targetContentSnippet, commentContent, session = null) {
    const targetSession = session || currentGroupSession;
    if (!targetSession) return null;

    // Ensure array exists for backward compatibility
    if (!targetSession.ai_comments) targetSession.ai_comments = [];

    const comment = {
      id: generateId(),
      target_message_id: targetMessageId,
      target_content_snippet: targetContentSnippet,
      content: commentContent,
      timestamp: new Date().toISOString(),
    };

    targetSession.ai_comments.push(comment);
    targetSession.updated_at = new Date().toISOString();
    return comment;
  },

  deleteMessage(messageId, session = null) {
    const targetSession = session || currentGroupSession;
    if (!targetSession) return;
    targetSession.messages = targetSession.messages.filter(m => m.id !== messageId);
    targetSession.updated_at = new Date().toISOString();
  },

  advanceRoundRobin(session, groupCharacterIds) {
    if (!session || !groupCharacterIds.length) return 0;
    const current = session.next_character_idx || 0;
    const next = (current + 1) % groupCharacterIds.length;
    session.next_character_idx = next;
    return current;
  },

  async saveSession(session = null) {
    const targetSession = session || currentGroupSession;
    if (!targetSession) return;
    const groupId = targetSession.group_id;
    const allSessions = sessions[groupId] || [];

    try {
      const dataStr = JSON.stringify(allSessions);
      localStorage.setItem(SESSIONS_KEY_PREFIX + groupId, dataStr);
    } catch (e) {
      console.warn('Failed to save group session', e);
    }
  },

  async saveCurrentSession() {
    return this.saveSession(currentGroupSession);
  },

  async deleteSession(groupId, sessionId) {
    if (sessions[groupId]) {
      sessions[groupId] = sessions[groupId].filter(s => s.id !== sessionId);
    }
    if (currentGroupSession?.id === sessionId) {
      currentGroupSession = null;
    }
    try {
      localStorage.setItem(SESSIONS_KEY_PREFIX + groupId, JSON.stringify(sessions[groupId] || []));
    } catch (e) {}
  },
};
