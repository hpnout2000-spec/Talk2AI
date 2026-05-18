/* ════════════════════════════════════════════════════════════════════
   GenAI Memory Store — Dedicated memory for the GenAI assistant
   ════════════════════════════════════════════════════════════════════ */

import { generateId } from '../utils/helpers.js';

const STORAGE_KEY = 'vibechat_genai_memories';
let memories = [];

export const genaiMemoryStore = {
  load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        memories = JSON.parse(saved);
      } else {
        memories = [];
      }
    } catch (e) {
      memories = [];
    }
    return memories;
  },

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(memories));
    } catch (e) {
      console.error('Failed to save GenAI memories:', e);
    }
  },

  getAll() {
    this.load();
    return memories;
  },

  getById(id) {
    return memories.find(m => m.id === id);
  },

  add(content) {
    const memory = {
      id: generateId(),
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };
    memories.unshift(memory); // Newest first
    this.save();
    return memory;
  },

  delete(id) {
    const index = memories.findIndex(m => m.id === id);
    if (index !== -1) {
      memories.splice(index, 1);
      this.save();
      return true;
    }
    return false;
  },

  clear() {
    memories = [];
    this.save();
  }
};
