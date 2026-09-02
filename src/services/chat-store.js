/* ════════════════════════════════════════════════════════════════════
   Chat Store — Chat session persistence
   ════════════════════════════════════════════════════════════════════ */

import { generateId } from '../utils/helpers.js';
import { localSyncService } from './local-sync-service.js';

let currentSession = null;
let sessions = {};

async function invokeTauri(cmd, args = {}) {
  if (localSyncService.isClientMode) {
    if (cmd === 'save_chat') localSyncService.pushChatToHost(args.characterId, JSON.parse(args.data));
    else if (cmd === 'delete_chat') localSyncService.deleteChatOnHost(args.characterId, args.chatId);
  }

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

    // Smart Merge: Merge sessions by ID, picking the newest version of each
    const mergedMap = new Map();
    
    // Process local first
    if (Array.isArray(parsedLocal)) {
      parsedLocal.forEach(s => {
        if (s && s.id) mergedMap.set(s.id, s);
      });
    }
    
    // Process tauri, overriding if newer or if local doesn't have it
    if (Array.isArray(parsedTauri)) {
      parsedTauri.forEach(s => {
        if (!s || !s.id) return;
        if (mergedMap.has(s.id)) {
          const localSession = mergedMap.get(s.id);
          const tauriTime = new Date(s.updated_at || 0).getTime();
          const localTime = new Date(localSession.updated_at || 0).getTime();
          
          const localMsgLen = localSession.messages ? localSession.messages.length : 0;
          const tauriMsgLen = s.messages ? s.messages.length : 0;

          // If tauri has more messages or is newer, pick it
          if (tauriTime > localTime || tauriMsgLen > localMsgLen) {
            mergedMap.set(s.id, s);
          }
        } else {
          mergedMap.set(s.id, s);
        }
      });
    }

    sessions[characterId] = Array.from(mergedMap.values()).sort((a, b) => {
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    });

    // Clean recovery & summaryChunks normalization
    sessions[characterId].forEach(s => {
      if (!s.summaryChunks && s.summary_chunks) {
        s.summaryChunks = s.summary_chunks;
      } else if (!s.summary_chunks && s.summaryChunks) {
        s.summary_chunks = s.summaryChunks;
      }
      if (!s.summaryChunks) {
        s.summaryChunks = [];
        s.summary_chunks = [];
      }

      if (Array.isArray(s.messages)) {
        s.messages.forEach(m => {
          if (m.content && typeof m.content === 'string' && m.content.includes('[[loader:')) {
            if (m.original_text) {
              m.content = m.original_text;
            } else {
              m.content = m.content.replace(/\n\n\[\[loader:[^\]]*\]\]/g, '').replace(/\[\[loader:[^\]]*\]\]/g, '').trim();
            }
          }
        });
      } else {
        s.messages = [];
      }
    });

    // Write merged state back to LocalStorage to protect against sync mismatches
    try {
      localStorage.setItem(`llmchat_chats_${characterId}`, JSON.stringify(sessions[characterId]));
    } catch (e) {
      console.warn('Failed to cache merged chats in LocalStorage', e);
    }

    return sessions[characterId];
  },

  getSessions(characterId) {
    const list = sessions[characterId] || [];
    const seen = new Set();
    return list.filter(s => {
      if (!s || !s.id || seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
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

  updateLastAssistantMessage(content, thinking = null, session = null, translatedContent = null, thinkingTime = null) {
    const targetSession = session || currentSession;
    if (!targetSession) return;
    const msgs = targetSession.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i].content = content;
        if (thinking !== null) msgs[i].thinking = thinking;
        if (thinkingTime !== null) msgs[i].thinking_time = thinkingTime;
        if (translatedContent !== null) {
          msgs[i].translated_content = translatedContent;
          msgs[i].show_original = false;
        }
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
    targetSession.updated_at = new Date().toISOString();
    if (!targetSession.summaryChunks && targetSession.summary_chunks) {
      targetSession.summaryChunks = targetSession.summary_chunks;
    }
    if (!targetSession.summary_chunks && targetSession.summaryChunks) {
      targetSession.summary_chunks = targetSession.summaryChunks;
    }
    if (!targetSession.summaryChunks) {
      targetSession.summaryChunks = [];
      targetSession.summary_chunks = [];
    }
    const characterId = targetSession.character_id;
    if (!characterId) return;

    if (!sessions[characterId]) {
      sessions[characterId] = [targetSession];
    } else if (!sessions[characterId].some(s => s.id === targetSession.id)) {
      sessions[characterId].unshift(targetSession);
    }

    const allSessions = sessions[characterId];

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
          data: JSON.stringify(targetSession),
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

  async renameSession(chatId, newTitle, characterId) {
    const charId = characterId || (currentSession?.character_id);
    if (!charId) return;
    
    // Ensure sessions are loaded
    await this.loadForCharacter(charId);
    
    const session = sessions[charId]?.find(s => s.id === chatId);
    if (session) {
      session.custom_title = newTitle;
      session.title = newTitle;
      session.updated_at = new Date().toISOString();
      await this.saveSession(session);
    }
    if (currentSession && currentSession.id === chatId) {
      currentSession.custom_title = newTitle;
      currentSession.title = newTitle;
      currentSession.updated_at = new Date().toISOString();
    }
  },

  async saveCharacterSettings(characterId, settings) {
    if (!characterId) return;
    if (!sessions[characterId]) sessions[characterId] = [];
    sessions[characterId].settings = settings;
    try {
      localStorage.setItem(`llmchat_chats_${characterId}`, JSON.stringify(sessions[characterId]));
    } catch (e) {}
  },

  // Clear in-memory cache, e.g. when syncing from another device
  clearCache() {
    sessions = {};
    currentSession = null;
    console.log('Chat store cache cleared');
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

  clearCache() {
    sessions = {};
    currentSession = null;
  },
};
