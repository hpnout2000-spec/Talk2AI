/* ════════════════════════════════════════════════════════════════════
   Character Store — CRUD operations for characters
   ════════════════════════════════════════════════════════════════════ */

import { generateId } from '../utils/helpers.js';

let characters = [];

async function invokeTauri(cmd, args = {}) {
  if (window.__TAURI_INTERNALS__) {
    return await window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  return null;
}

export const characterStore = {
  async load() {
    try {
      const result = await invokeTauri('load_characters');
      if (result) {
        characters = JSON.parse(result).map(c => ({
          ...c,
          last_chat_at: c.last_chat_at || c.created_at || new Date().toISOString()
        }));
      } else {
        const saved = localStorage.getItem('llmchat_characters');
        if (saved) {
          characters = JSON.parse(saved).map(c => ({
            ...c,
            last_chat_at: c.last_chat_at || c.created_at || new Date().toISOString()
          }));
        }
      }
    } catch (e) {
      console.warn('Failed to load characters:', e);
      const saved = localStorage.getItem('llmchat_characters');
      if (saved) characters = JSON.parse(saved);
    }
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
      scenario: characterData.scenario || '',
      system_prompt: characterData.system_prompt || '',
      first_message: characterData.first_message || '',
      created_at: characterData.created_at || new Date().toISOString(),
      last_chat_at: characterData.last_chat_at || characterData.created_at || new Date().toISOString(),
    };

    if (isNew) {
      characters.push(character);
    } else {
      const idx = characters.findIndex(c => c.id === character.id);
      if (idx >= 0) characters[idx] = character;
      else characters.push(character);
    }

    try {
      await invokeTauri('save_character', { data: JSON.stringify(character) });
    } catch {
      localStorage.setItem('llmchat_characters', JSON.stringify(characters));
    }

    return character;
  },

  async updateLastChat(id) {
    const char = characters.find(c => c.id === id);
    if (char) {
      char.last_chat_at = new Date().toISOString();
      try {
        await invokeTauri('save_character', { data: JSON.stringify(char) });
      } catch {
        localStorage.setItem('llmchat_characters', JSON.stringify(characters));
      }
    }
  },

  async delete(id) {
    characters = characters.filter(c => c.id !== id);
    try {
      await invokeTauri('delete_character', { id });
    } catch {
      localStorage.setItem('llmchat_characters', JSON.stringify(characters));
    }
  },
};
