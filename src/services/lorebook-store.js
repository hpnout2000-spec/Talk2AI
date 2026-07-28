/* ════════════════════════════════════════════════════════════════════
   Lorebook Store — CRUD operations for Lorebooks (World Info)
   ════════════════════════════════════════════════════════════════════ */

import { generateId } from '../utils/helpers.js';
import { localSyncService } from './local-sync-service.js';

// IndexedDB Helper for unlimited storage
const DB_NAME = 'LLMChatDB';
const STORE_NAME = 'keyval';

function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function idbGet(key) {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch(e) {
    console.error('IndexedDB get failed:', e);
    return null;
  }
}

export async function idbSet(key, val) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(val, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

let lorebooks = [];
let lorebookSettings = {
  scanDepth: 50,
  contextPercent: 25,
  budgetCap: 500,
  minActivations: 0,
  maxDepth: 0,
  maxRecursionSteps: 0,
  insertionStrategy: 'Character Lore First',
  includeNames: true,
  recursiveScan: true,
  caseSensitive: false,
  matchWholeWords: true,
  useGroupScoring: false,
  alertOnOverflow: false
};

async function invokeTauri(cmd, args = {}) {
  // Optional local sync for client mode if we implement it later
  // if (localSyncService.isClientMode) {
  //   if (cmd === 'save_lorebook') localSyncService.pushLorebookToHost(JSON.parse(args.data));
  //   else if (cmd === 'delete_lorebook') localSyncService.deleteLorebookOnHost(args.id);
  // }

  if (window.__TAURI_INTERNALS__) {
    return await window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  throw new Error('Not running in Tauri environment');
}

export const lorebookStore = {
  async load() {
    let parsedTauri = [];
    let parsedLocal = [];

    // Try Tauri
    try {
      const result = await invokeTauri('load_lorebooks');
      if (result) {
        parsedTauri = JSON.parse(result).map(l => ({
          ...l,
          created_at: l.created_at || new Date().toISOString()
        }));
      }
    } catch (e) {
      console.warn('Tauri load lorebooks failed:', e);
    }

    try {
      let savedSettings = await idbGet('llmchat_lorebook_settings');
      if (savedSettings) {
        lorebookSettings = { ...lorebookSettings, ...JSON.parse(savedSettings) };
      }
    } catch (e) {
      console.warn('Local load lorebook settings failed:', e);
    }

    // Try IndexedDB (with LocalStorage fallback/migration)
    try {
      let saved = await idbGet('llmchat_lorebooks');
      if (!saved) {
        saved = localStorage.getItem('llmchat_lorebooks');
        if (saved) {
          // Migrate to IndexedDB
          await idbSet('llmchat_lorebooks', saved);
        }
      }
      if (saved) {
        const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
        parsedLocal = parsed.map(l => ({
          ...l,
          created_at: l.created_at || new Date().toISOString()
        }));
      }
    } catch (e) {
      console.warn('Local load lorebooks failed:', e);
    }

    // Merge: Tauri wins if duplicate IDs exist, but we keep local if only in local
    const mergedMap = new Map();
    parsedLocal.forEach(l => mergedMap.set(l.id, l));
    parsedTauri.forEach(l => mergedMap.set(l.id, l));

    lorebooks = Array.from(mergedMap.values());
    return lorebooks;
  },

  getSettings() {
    return lorebookSettings;
  },

  async saveSettings(settings) {
    lorebookSettings = { ...lorebookSettings, ...settings };
    try {
      await idbSet('llmchat_lorebook_settings', JSON.stringify(lorebookSettings));
    } catch (e) {
      console.warn('IndexedDB save lorebook settings failed:', e);
    }
  },

  getAll() {
    return lorebooks;
  },

  get(id) {
    return lorebooks.find(l => l.id === id);
  },

  async save(lorebookData) {
    const isNew = !lorebookData.id;
    const lorebook = {
      id: isNew ? generateId() : lorebookData.id,
      name: lorebookData.name || 'Untitled Lorebook',
      description: lorebookData.description || '',
      entries: lorebookData.entries || [],
      favorite: !!lorebookData.favorite,
      created_at: lorebookData.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (isNew) {
      lorebooks.push(lorebook);
    } else {
      const idx = lorebooks.findIndex(l => l.id === lorebook.id);
      if (idx !== -1) {
        lorebooks[idx] = lorebook;
      } else {
        lorebooks.push(lorebook);
      }
    }

    let savedLocal = false;
    try {
      await idbSet('llmchat_lorebooks', JSON.stringify(lorebooks));
      savedLocal = true;
    } catch (e) {
      console.warn('IndexedDB save lorebook failed:', e);
      if (e.name === 'QuotaExceededError') {
        throw new Error('Local storage is full! Please delete some data or clear chat history.');
      }
    }

    // 2. Try Tauri
    let savedTauri = false;
    try {
      await invokeTauri('save_lorebook', { data: JSON.stringify(lorebook) });
      savedTauri = true;
    } catch (e) {
      console.warn('Tauri save lorebook failed:', e);
    }

    if (!savedLocal && !savedTauri) {
      throw new Error('Failed to save lorebook. Storage might be full or unavailable.');
    }

    return lorebook;
  },

  async delete(id) {
    lorebooks = lorebooks.filter(l => l.id !== id);

    try {
      await idbSet('llmchat_lorebooks', JSON.stringify(lorebooks));
    } catch (e) {
      console.warn('IndexedDB delete lorebook failed:', e);
    }

    try {
      await invokeTauri('delete_lorebook', { id });
    } catch (e) {
      console.warn('Tauri delete lorebook failed:', e);
    }
  },

  // Helper to create a new default entry
  createEntry() {
    return {
      id: String(Date.now()),
      keys: [],
      logic: 'AND ANY',
      filter: [],
      content: '',
      enabled: true,
      constant: false,
      strategy: 'selective',
      position: 'Before Char',
      depth: 4,
      order: 100,
      triggerPercent: 100,
      scanDepth: null,
      caseSensitive: null,
      wholeWords: null,
      groupScoring: null,
      automationId: '',
      inclusionGroup: '',
      groupWeight: 100,
      sticky: 0,
      cooldown: 0,
      delay: 0,
      priority: 100
    };
  },

  // Helper to scan text against an array of active lorebooks
  // returns an array of matching entries
  scanText(text, activeLorebooks = []) {
    const matchedEntries = [];
    const settings = this.getSettings();

    console.groupCollapsed(`[Lorebooks] Scanning text (Length: ${text.length}) against ${activeLorebooks.length} active books`);
    console.log("Settings:", settings);

    for (const book of activeLorebooks) {
      if (!book || !book.entries) continue;
      console.groupCollapsed(`📖 Scanning Book: "${book.name}" (${book.entries.length} entries)`);

      for (const entry of book.entries) {
        if (!entry.enabled) continue;
        
        const entryName = entry.memo || entry.id;
        
        // Trigger % check
        const trigger = entry.triggerPercent !== undefined ? entry.triggerPercent : 100;
        if (trigger < 100) {
          const roll = Math.random() * 100;
          if (roll > trigger) {
            console.log(`❌ [${entryName}] Failed RNG check: rolled ${roll.toFixed(1)} > ${trigger}%`);
            continue; // Failed RNG check
          } else {
            console.log(`🎲 [${entryName}] Passed RNG check: rolled ${roll.toFixed(1)} <= ${trigger}%`);
          }
        }

        if (entry.strategy === 'constant' || entry.constant) {
          console.log(`✅ [${entryName}] Activated unconditionally (Constant Strategy).`);
          matchedEntries.push({ ...entry, bookName: book.name });
          continue;
        }

        const keys = entry.keys || [];
        if (keys.length === 0) {
          console.log(`⏭️ [${entryName}] Skipped (No keywords defined).`);
          continue;
        }

        const isCaseSensitive = entry.caseSensitive !== null && entry.caseSensitive !== undefined 
          ? entry.caseSensitive 
          : settings.caseSensitive;
        
        const isWholeWords = entry.wholeWords !== null && entry.wholeWords !== undefined 
          ? entry.wholeWords 
          : settings.matchWholeWords;

        const checkKeyword = (kw) => {
          const pattern = isWholeWords ? `\\b${kw}\\b` : kw;
          const flags = isCaseSensitive ? '' : 'i';
          try {
            const regex = new RegExp(pattern, flags);
            return regex.test(text);
          } catch(e) {
            if (isCaseSensitive) return text.includes(kw);
            return text.toLowerCase().includes(kw.toLowerCase());
          }
        };

        const logic = entry.logic || 'AND ANY';
        let matched = false;
        
        let matchingKeys = keys.filter(checkKeyword);

        if (logic === 'AND ANY') {
          matched = matchingKeys.length > 0;
        } else if (logic === 'AND ALL') {
          matched = matchingKeys.length === keys.length;
        } else if (logic === 'NOT ANY') {
          matched = matchingKeys.length === 0;
        } else if (logic === 'NOT ALL') {
          matched = matchingKeys.length < keys.length;
        }

        if (!matched) {
           console.log(`⛔ [${entryName}] Failed logic (${logic}). Keys matched: [${matchingKeys.join(', ')}] out of [${keys.join(', ')}]`);
        }

        // Optional filter check
        if (matched && entry.filter && entry.filter.length > 0) {
          let matchingFilters = entry.filter.filter(checkKeyword);
          matched = matchingFilters.length > 0;
          if (!matched) {
             console.log(`⛔ [${entryName}] Passed keys but failed secondary filter. Filters matched: none out of [${entry.filter.join(', ')}]`);
          }
        }

        if (matched) {
          console.log(`✅ [${entryName}] Matched successfully! Logic: ${logic}, Keys matched: [${matchingKeys.join(', ')}]`);
          matchedEntries.push({ ...entry, bookName: book.name });
        }
      }
      console.groupEnd();
    }

    // Apply Group Scoring (only 1 per inclusionGroup, pick highest groupWeight)
    const useGroupScoring = settings.useGroupScoring;
    const grouped = {};
    const finals = [];
    
    for (const entry of matchedEntries) {
      const group = entry.inclusionGroup;
      if (!useGroupScoring || !group || group.trim() === '') {
        finals.push(entry);
      } else {
        if (!grouped[group]) {
          grouped[group] = [];
        }
        grouped[group].push(entry);
      }
    }

    if (useGroupScoring) {
      console.groupCollapsed(`⚖️ Group Scoring Evaluation`);
      for (const groupName in grouped) {
        const gEntries = grouped[groupName];
        gEntries.sort((a, b) => {
          const wA = a.groupWeight !== undefined ? a.groupWeight : 100;
          const wB = b.groupWeight !== undefined ? b.groupWeight : 100;
          if (wB !== wA) return wB - wA; // highest weight first
          // tiebreaker: order
          const oA = a.order !== undefined ? a.order : 100;
          const oB = b.order !== undefined ? b.order : 100;
          return oB - oA; 
        });
        const winner = gEntries[0];
        console.log(`Group "${groupName}": Winner is [${winner.memo || winner.id}] (Weight ${winner.groupWeight || 100}, Order ${winner.order || 100}) out of ${gEntries.length} entries.`);
        finals.push(winner);
      }
      console.groupEnd();
    }

    // Final sorting: sort by Order (ascending, so higher order = inserted last)
    finals.sort((a, b) => {
      const oA = a.order !== undefined ? a.order : 100;
      const oB = b.order !== undefined ? b.order : 100;
      return oA - oB;
    });

    console.log(`🚀 Final Injection List: ${finals.length} entries`, finals);
    console.groupEnd();

    return finals;
  }
};
