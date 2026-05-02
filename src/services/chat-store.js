/* ════════════════════════════════════════════════════════════════════
   Chat Store — Chat session persistence
   ════════════════════════════════════════════════════════════════════ */

import { generateId } from '../utils/helpers.js';

let currentSession = null;
let sessions = {};

async function invokeTauri(cmd, args = {}) {
  if (window.__TAURI_INTERNALS__) {
    return await window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  return null;
}

export const chatStore = {
  async loadForCharacter(characterId) {
    try {
      const result = await invokeTauri('load_chats', { characterId });
      if (result) {
        sessions[characterId] = JSON.parse(result);
      } else {
        const saved = localStorage.getItem(`llmchat_chats_${characterId}`);
        if (saved) sessions[characterId] = JSON.parse(saved);
        else sessions[characterId] = [];
      }
    } catch {
      const saved = localStorage.getItem(`llmchat_chats_${characterId}`);
      if (saved) sessions[characterId] = JSON.parse(saved);
      else sessions[characterId] = [];
    }
    return sessions[characterId] || [];
  },

  getSessions(characterId) {
    return sessions[characterId] || [];
  },

  getCurrentSession() {
    return currentSession;
  },

  createSession(characterId) {
    const session = {
      id: generateId(),
      character_id: characterId,
      messages: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    currentSession = session;
    if (!sessions[characterId]) sessions[characterId] = [];
    sessions[characterId].unshift(session);
    return session;
  },

  setCurrentSession(session) {
    currentSession = session;
  },

  addMessage(role, content, thinking = null) {
    if (!currentSession) return null;
    const message = {
      id: generateId(),
      role,
      content,
      thinking,
      timestamp: new Date().toISOString(),
    };
    currentSession.messages.push(message);
    currentSession.updated_at = new Date().toISOString();
    return message;
  },

  updateLastAssistantMessage(content, thinking = null) {
    if (!currentSession) return;
    const msgs = currentSession.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i].content = content;
        if (thinking !== null) msgs[i].thinking = thinking;
        break;
      }
    }
    currentSession.updated_at = new Date().toISOString();
  },

  deleteMessage(messageId) {
    if (!currentSession) return;
    currentSession.messages = currentSession.messages.filter(m => m.id !== messageId);
    currentSession.updated_at = new Date().toISOString();
  },

  async saveCurrentSession() {
    if (!currentSession) return;
    try {
      await invokeTauri('save_chat', {
        characterId: currentSession.character_id,
        data: JSON.stringify(currentSession),
      });
    } catch {
      const key = `llmchat_chats_${currentSession.character_id}`;
      localStorage.setItem(key, JSON.stringify(sessions[currentSession.character_id] || []));
    }
  },

  async deleteSession(characterId, chatId) {
    if (sessions[characterId]) {
      sessions[characterId] = sessions[characterId].filter(s => s.id !== chatId);
    }
    if (currentSession && currentSession.id === chatId) {
      currentSession = null;
    }
    try {
      await invokeTauri('delete_chat', { characterId, chatId });
    } catch {
      const key = `llmchat_chats_${characterId}`;
      localStorage.setItem(key, JSON.stringify(sessions[characterId] || []));
    }
  },
};
