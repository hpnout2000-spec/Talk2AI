/* ════════════════════════════════════════════════════════════════════
   Character Store — CRUD operations for characters
   ════════════════════════════════════════════════════════════════════ */

import { generateId } from '../utils/helpers.js';

let characters = [];

async function invokeTauri(cmd, args = {}) {
  if (window.__TAURI_INTERNALS__) {
    return await window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  throw new Error('Not running in Tauri environment');
}

export const characterStore = {
  async load() {
    let parsedTauri = [];
    let parsedLocal = [];

    // Try Tauri
    try {
      const result = await invokeTauri('load_characters');
      if (result) {
        parsedTauri = JSON.parse(result).map(c => ({
          ...c,
          last_chat_at: c.last_chat_at || c.created_at || new Date().toISOString()
        }));
      }
    } catch (e) {
      console.warn('Tauri load characters failed:', e);
    }

    // Try LocalStorage
    try {
      const saved = localStorage.getItem('llmchat_characters');
      if (saved) {
        parsedLocal = JSON.parse(saved).map(c => ({
          ...c,
          last_chat_at: c.last_chat_at || c.created_at || new Date().toISOString()
        }));
      }
    } catch (e) {
      console.warn('LocalStorage load characters failed:', e);
    }

    // Merge: For characters, we must merge by ID and pick the one with the newest last_chat_at
    const mergedMap = new Map();
    
    parsedLocal.forEach(c => mergedMap.set(c.id, c));
    
    parsedTauri.forEach(c => {
      if (mergedMap.has(c.id)) {
        const localChar = mergedMap.get(c.id);
        const tauriTime = new Date(c.last_chat_at || 0).getTime();
        const localTime = new Date(localChar.last_chat_at || 0).getTime();
        if (tauriTime > localTime) {
          mergedMap.set(c.id, c);
        }
      } else {
        mergedMap.set(c.id, c);
      }
    });

    characters = Array.from(mergedMap.values());

    return characters;
  },

  getAll() {
    return [...characters];
  },

  getById(id) {
    return characters.find(c => c.id === id) || null;
  },

  async save(characterData) {
    const isNew = !characterData.id;
    const character = {
      id: characterData.id || generateId(),
      name: characterData.name || 'Unnamed',
      avatar: characterData.avatar || '',
      description: characterData.description || '',
      personality: characterData.personality || '',
      image_tags: characterData.image_tags || '',
      scenario: characterData.scenario || '',
      system_prompt: characterData.system_prompt || '',
      first_message: characterData.first_message || '',
      alternate_greetings: characterData.alternate_greetings || [],
      created_at: characterData.created_at || new Date().toISOString(),
      last_chat_at: characterData.last_chat_at || characterData.created_at || new Date().toISOString(),
      message_examples: characterData.message_examples || '',
    };

    if (isNew) {
      characters.push(character);
    } else {
      const idx = characters.findIndex(c => c.id === character.id);
      if (idx >= 0) characters[idx] = character;
      else characters.push(character);
    }

    const dataStr = JSON.stringify(characters);
    
    // 1. Always save to LocalStorage
    try {
      localStorage.setItem('llmchat_characters', dataStr);
    } catch (e) {}

    // 2. Try Tauri
    try {
      await invokeTauri('save_character', { data: JSON.stringify(character) });
    } catch (e) {
      console.warn('Tauri save character failed:', e);
    }

    return character;
  },

  async updateLastChat(id) {
    const char = characters.find(c => c.id === id);
    if (char) {
      char.last_chat_at = new Date().toISOString();
      const dataStr = JSON.stringify(characters);
      try { localStorage.setItem('llmchat_characters', dataStr); } catch (e) {}

      try {
        await invokeTauri('save_character', { data: JSON.stringify(char) });
      } catch (e) {
        console.warn('Tauri updateLastChat failed:', e);
      }
    }
  },

  async delete(id) {
    characters = characters.filter(c => c.id !== id);
    const dataStr = JSON.stringify(characters);
    try { localStorage.setItem('llmchat_characters', dataStr); } catch (e) {}

    try {
      await invokeTauri('delete_character', { id });
    } catch (e) {
      console.warn('Tauri delete_character failed:', e);
    }
  },
};
