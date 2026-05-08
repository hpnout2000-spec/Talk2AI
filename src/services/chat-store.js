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
    // If already in memory (even if empty list), don't reload from disk
    if (sessions.hasOwnProperty(characterId)) {
      return sessions[characterId];
    }

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

  addMessage(role, content, thinking = null, session = null) {
    const targetSession = session || currentSession;
    if (!targetSession) return null;
    const message = {
      id: generateId(),
      role,
      content,
      thinking,
      timestamp: new Date().toISOString(),
    };
    targetSession.messages.push(message);
    targetSession.updated_at = new Date().toISOString();
    return message;
  },

  updateLastAssistantMessage(content, thinking = null, session = null, translatedContent = null) {
    const targetSession = session || currentSession;
    if (!targetSession) return;
    const msgs = targetSession.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i].content = content;
        if (thinking !== null) msgs[i].thinking = thinking;
        if (translatedContent !== null) msgs[i].translated_content = translatedContent;
        break;
      }
    }
    targetSession.updated_at = new Date().toISOString();
  },

  updateMessage(messageId, updates, session = null) {
    const targetSession = session || currentSession;
    if (!targetSession) return;
    const msg = targetSession.messages.find(m => m.id === messageId);
    if (msg) {
      Object.assign(msg, updates);
      targetSession.updated_at = new Date().toISOString();
    }
  },

  updateLastAssistantOptions(options, session = null) {
    const targetSession = session || currentSession;
    if (!targetSession) return;
    const msgs = targetSession.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i].options = options;
        break;
      }
    }
    targetSession.updated_at = new Date().toISOString();
  },

  deleteMessage(messageId, session = null) {
    const targetSession = session || currentSession;
    if (!targetSession) return;
    targetSession.messages = targetSession.messages.filter(m => m.id !== messageId);
    targetSession.updated_at = new Date().toISOString();
  },

  async saveSession(session = null) {
    const targetSession = session || currentSession;
    if (!targetSession) return;
    try {
      await invokeTauri('save_chat', {
        characterId: targetSession.character_id,
        data: JSON.stringify(targetSession),
      });
    } catch {
      const key = `llmchat_chats_${targetSession.character_id}`;
      localStorage.setItem(key, JSON.stringify(sessions[targetSession.character_id] || []));
    }
  },

  async saveCurrentSession() {
    return this.saveSession(currentSession);
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
