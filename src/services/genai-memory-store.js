/* ════════════════════════════════════════════════════════════════════
   GenAI Memory Store — Dedicated memory for the GenAI assistant
   ════════════════════════════════════════════════════════════════════ */

import { generateId } from '../utils/helpers.js';
import { localSyncService } from './local-sync-service.js';

const STORAGE_KEY = 'vibechat_genai_memories';
let memories = [];

async function invokeTauri(cmd, args = {}) {
  if (localSyncService.isClientMode) {
    if (cmd === 'save_genai_memories') {
      localSyncService.pushGenaiMemoriesToHost(args.data);
    }
  }

  if (window.__TAURI_INTERNALS__) {
    return await window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  throw new Error('Not running in Tauri environment');
}

export const genaiMemoryStore = {
  async load() {
    try {
      const result = await invokeTauri('load_genai_memories');
      if (result) {
        memories = JSON.parse(result);
      } else {
        const saved = localStorage.getItem(STORAGE_KEY);
        memories = saved ? JSON.parse(saved) : [];
      }
    } catch (e) {
      const saved = localStorage.getItem(STORAGE_KEY);
      memories = saved ? JSON.parse(saved) : [];
    }
    return memories;
  },

  async save() {
    try {
      await invokeTauri('save_genai_memories', { data: JSON.stringify(memories) });
    } catch (e) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(memories));
      } catch (err) {
        console.error('Failed to save GenAI memories:', err);
      }
    }
  },

  getAll() {
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

  update(id, content) {
    const memory = memories.find(m => m.id === id);
    if (memory) {
      memory.content = content.trim();
      memory.timestamp = new Date().toISOString();
      this.save();
      return memory;
    }
    return null;
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
