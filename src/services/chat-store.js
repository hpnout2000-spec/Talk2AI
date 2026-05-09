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
  throw new Error('Not running in Tauri environment');
}

export const chatStore = {
  async loadForCharacter(characterId) {
    // If already in memory (even if empty list), don't reload from disk
    if (sessions.hasOwnProperty(characterId)) {
      return sessions[characterId];
    }

    let parsedTauri = [];
    let parsedLocal = [];

    // Try Tauri
    try {
      const result = await invokeTauri('load_chats', { characterId });
      if (result) parsedTauri = JSON.parse(result);
    } catch (e) {
      console.warn('Tauri load failed', e);
    }

    // Try LocalStorage
    try {
      const saved = localStorage.getItem(`llmchat_chats_${characterId}`);
      if (saved) parsedLocal = JSON.parse(saved);
    } catch (e) {
      console.warn('LocalStorage load failed', e);
    }

    // Merge: Use whichever has more sessions (safer fallback)
    if (parsedLocal.length > parsedTauri.length) {
      sessions[characterId] = parsedLocal;
    } else {
      sessions[characterId] = parsedTauri.length > 0 ? parsedTauri : parsedLocal;
    }

    return sessions[characterId];
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
      ai_comments: [],
      indicators: { enabled: false, list: [] },
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
    
    // Clear all previous options to ensure they only appear on the last message
    msgs.forEach(m => {
      if (m.options) delete m.options;
    });

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

  addAiComment(targetMessageId, targetContentSnippet, commentContent, session = null) {
    const targetSession = session || currentSession;
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

  async saveSession(session = null) {
    const targetSession = session || currentSession;
    if (!targetSession) return;
    const characterId = targetSession.character_id;
    const allSessions = sessions[characterId] || [];

    try {
      const dataStr = JSON.stringify(allSessions);
      
      // 1. Always save to LocalStorage as a rock-solid backup
      try {
        localStorage.setItem(`llmchat_chats_${characterId}`, dataStr);
      } catch (e) {
        console.warn('LocalStorage save failed', e);
      }

      // 2. Try Tauri
      try {
        await invokeTauri('save_chat', {
          characterId,
          data: dataStr,
        });
      } catch (err) {
        console.warn('Tauri save failed', err);
      }
    } catch (stringifyErr) {
      console.error('Failed to stringify or save sessions!', stringifyErr);
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
    
    const dataStr = JSON.stringify(sessions[characterId] || []);
    
    // 1. Always save to LocalStorage
    try {
      localStorage.setItem(`llmchat_chats_${characterId}`, dataStr);
    } catch (e) {}

    // 2. Try Tauri
    try {
      await invokeTauri('delete_chat', { characterId, chatId });
    } catch (e) {
      console.warn('Tauri delete_chat failed', e);
    }
  },
};
