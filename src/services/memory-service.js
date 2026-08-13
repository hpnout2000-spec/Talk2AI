/* ════════════════════════════════════════════════════════════════════
   Memory Service — Auto-extract and manage character memories
   ════════════════════════════════════════════════════════════════════ */

import { api } from './api.js';
import { settingsStore } from './settings-store.js';
import { generateId } from '../utils/helpers.js';
import { localSyncService } from './local-sync-service.js';

let memories = {}; // characterId -> { character_id, entries: [] }

async function invokeTauri(cmd, args = {}) {
  if (localSyncService.isClientMode) {
    if (cmd === 'save_memory') {
      localSyncService.pushMemoryToHost(args.characterId, args.data);
    }
  }

  if (window.__TAURI_INTERNALS__) {
    return await window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  throw new Error('Not running in Tauri environment');
}

const MEMORY_EXTRACTION_PROMPT = `You are a memory manager. Analyze the last exchange and update the character's long-term memory.

Be VERY selective. Only extract information that is:
1. Highly important for future interactions.
2. A permanent fact or a significant long-term preference.
3. A major life event.
Most casual conversation should NOT be remembered.

You can also DELETE memories if they are now outdated, incorrect, or superseded by new information.

Return ONLY a valid JSON object with this structure:
{"facts": ["new fact"], "preferences": ["new pref"], "events": ["new event"], "delete_ids": ["id1", "id2"]}

If nothing to add or delete, return empty arrays for all fields.
IMPORTANT: Return ONLY the JSON, no other text.`;

export const memoryService = {
  async loadForCharacter(characterId) {
    if (memories.hasOwnProperty(characterId)) {
      return memories[characterId];
    }

    try {
      const result = await invokeTauri('load_memory', { characterId });
      if (result) {
        memories[characterId] = JSON.parse(result);
      } else {
        const saved = localStorage.getItem(`llmchat_memory_${characterId}`);
        if (saved) memories[characterId] = JSON.parse(saved);
        else memories[characterId] = { character_id: characterId, entries: [] };
      }
    } catch {
      const saved = localStorage.getItem(`llmchat_memory_${characterId}`);
      if (saved) memories[characterId] = JSON.parse(saved);
      else memories[characterId] = { character_id: characterId, entries: [] };
    }
    return memories[characterId];
  },

  getMemory(characterId) {
    return memories[characterId] || { character_id: characterId, entries: [] };
  },

  /**
   * Extract memories from the latest exchange
   * @param {string} characterId
   * @param {string} userMessage
   * @param {string} assistantResponse
   * @returns {Array} extracted memory entries
   */
  async extractMemories(characterId, userMessage, assistantResponse) {
    const settings = settingsStore.get();
    if (!settings.memory_enabled) return [];

    try {
      const currentEntries = memories[characterId]?.entries || [];
      const memoryList = currentEntries
        .map(e => `ID: ${e.id} | [${e.category}] ${e.content}`)
        .join('\n');

      const messages = [
        { role: 'system', content: MEMORY_EXTRACTION_PROMPT },
        {
          role: 'user',
          content: `Current Memories:\n${memoryList || 'None'}\n\nLast Exchange:\nUser said: "${userMessage}"\nAssistant replied: "${assistantResponse.substring(0, 1000)}"`,
        },
      ];

      const response = await api.chatCompletion(messages, { priority: 'background', reasoning_effort: 'none' });

      // Parse JSON from response
      let extracted;
      try {
        // Strip any rogue <think> blocks that the model might generate despite instructions
        const cleanResponse = response.replace(/(?:<\|?think\|?>|<reasoning>|<\|?channel\|?>?thought)([\s\S]*?)(?:<\|?\/think\|?>|<\/reasoning>|<channel\|>)/gi, '');
        
        // Try to find JSON in the cleaned response
        const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          extracted = JSON.parse(jsonMatch[0]);
        } else {
          return [];
        }
      } catch {
        console.warn('Failed to parse memory extraction response:', response);
        return [];
      }

      if (Array.isArray(extracted.delete_ids)) {
        for (const id of extracted.delete_ids) {
          await this.deleteEntry(characterId, id);
        }
      }

      const newEntries = [];
      const now = new Date().toISOString();

      const addEntries = (items, category) => {
        if (Array.isArray(items)) {
          for (const content of items) {
            if (content && content.trim()) {
              // Deduplicate: skip if similar memory already exists
              const isDuplicate = (memories[characterId]?.entries || []).some(
                e => e.content.toLowerCase() === content.content?.toLowerCase?.() || e.content.toLowerCase() === content.toLowerCase?.()
              );
              // Small fix for potential object content
              const finalContent = typeof content === 'string' ? content : (content.content || JSON.stringify(content));
              
              const alreadyExists = (memories[characterId]?.entries || []).some(
                e => e.content.toLowerCase() === finalContent.toLowerCase()
              );

              if (!alreadyExists) {
                newEntries.push({
                  id: generateId(),
                  timestamp: now,
                  category,
                  content: finalContent.trim(),
                });
              }
            }
          }
        }
      };

      addEntries(extracted.facts, 'fact');
      addEntries(extracted.preferences, 'preference');
      addEntries(extracted.events, 'event');

      if (newEntries.length > 0) {
        if (!memories[characterId]) {
          memories[characterId] = { character_id: characterId, entries: [] };
        }
        memories[characterId].entries.push(...newEntries);

        // Keep only last 100 entries
        if (memories[characterId].entries.length > 100) {
          memories[characterId].entries = memories[characterId].entries.slice(-100);
        }

        await this.save(characterId);
      }

      return newEntries;
    } catch (e) {
      console.warn('Memory extraction failed:', e);
      return [];
    }
  },

  /**
   * Get formatted memory string for injection into system prompt
   */
  getMemoryContext(characterId) {
    const memory = memories[characterId];
    if (!memory || memory.entries.length === 0) return '';

    const entries = memory.entries.slice(-30); // Last 30 entries
    const facts = entries.filter(e => e.category === 'fact').map(e => e.content);
    const prefs = entries.filter(e => e.category === 'preference').map(e => e.content);
    const events = entries.filter(e => e.category === 'event').map(e => e.content);

    let context = '\n\n[Character Memory]\n';
    if (facts.length) context += `Facts: ${facts.join('; ')}\n`;
    if (prefs.length) context += `User preferences: ${prefs.join('; ')}\n`;
    if (events.length) context += `Past events: ${events.join('; ')}\n`;
    context += '[End Memory]\n';

    return context;
  },

  async deleteEntry(characterId, entryId) {
    if (memories[characterId]) {
      memories[characterId].entries = memories[characterId].entries.filter(e => e.id !== entryId);
      await this.save(characterId);
    }
  },

  async save(characterId) {
    const memory = memories[characterId];
    if (!memory) return;
    try {
      await invokeTauri('save_memory', {
        characterId,
        data: JSON.stringify(memory),
      });
    } catch {
      localStorage.setItem(`llmchat_memory_${characterId}`, JSON.stringify(memory));
    }
  },
  clearCache() {
    memories = {};
  },
};
