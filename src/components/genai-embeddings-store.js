/* ════════════════════════════════════════════════════════════════════
   GenAI Embeddings Store — RAG Vector Database & Search
   ════════════════════════════════════════════════════════════════════ */

import { pipeline, env } from '../vendor/transformers.js';

// Configuration
env.allowLocalModels = false; // Force downloading from HuggingFace Hub (cached locally by browser)
// We upgrade to E5 which is much more advanced for multilingual tasks
const MODEL_NAME = 'Xenova/multilingual-e5-small';
const DB_NAME = 'genai_embeddings_db';
const STORE_NAME = 'vectors';

let extractorPipeline = null;
let db = null;
let openDbPromise = null;
let isInitializing = false;

// ─── IndexedDB Setup ────────────────────────────────────────────────

function openDB() {
  if (db) return Promise.resolve(db);
  if (openDbPromise) return openDbPromise;
  openDbPromise = new Promise((resolve, reject) => {
    // Increment version to 2 to flush old vectors (incompatible models)
    const request = window.indexedDB.open(DB_NAME, 2);
    
    request.onerror = (e) => {
      openDbPromise = null;
      reject(e.target.error);
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      openDbPromise = null;
      resolve(db);
    };
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (database.objectStoreNames.contains(STORE_NAME)) {
        database.deleteObjectStore(STORE_NAME);
      }
      const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('session_id', 'session_id', { unique: false });
    };
  });
  return openDbPromise;
}

async function putVector(record) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getVectorsBySession(sessionId) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('session_id');
    const req = index.getAll(IDBKeyRange.only(sessionId));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function deleteVector(id) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getAllVectors() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// ─── Math & Hashing ─────────────────────────────────────────────────

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function computeHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(16);
}

// ─── Core Logic ─────────────────────────────────────────────────────

export const genaiEmbeddingsStore = {
  
  async init(showToasts = true) {
    if (extractorPipeline) return true;
    if (isInitializing) {
      // Wait for initialization to complete
      while (isInitializing) {
        await new Promise(r => setTimeout(r, 100));
      }
      return !!extractorPipeline;
    }

    try {
      isInitializing = true;
      await openDB();
      console.log('[Embeddings] Downloading/Loading model:', MODEL_NAME);
      if (showToasts && window.showToast) {
        window.showToast('Smart Context: Downloading advanced search model (~118 MB)... This will take a moment on first run.', 'info');
      }
      // We use feature-extraction pipeline with 8-bit quantization for performance and memory
      extractorPipeline = await pipeline('feature-extraction', MODEL_NAME, {
        dtype: 'q8'
      });
      console.log('[Embeddings] Model loaded successfully.');
      localStorage.setItem('smart_context_model_installed', 'true');
      
      if (showToasts && window.showToast) {
        window.showToast('Smart Context: Model loaded successfully!', 'success');
      }
      return true;
    } catch (e) {
      console.error('[Embeddings] Initialization failed:', e);
      if (showToasts && window.showToast) {
        window.showToast('Smart Context: Failed to load model. Search is temporarily disabled.', 'error');
      }
      return false;
    } finally {
      isInitializing = false;
    }
  },

  async getVector(text, isQuery = false) {
    if (!extractorPipeline) await this.init();
    if (!extractorPipeline) throw new Error('Embeddings pipeline not initialized');

    // E5 models require 'query: ' or 'passage: ' prefixes
    const prefix = isQuery ? 'query: ' : 'passage: ';
    const formattedText = text.startsWith('query:') || text.startsWith('passage:') ? text : prefix + text;

    // Run the text through the model
    const output = await extractorPipeline(formattedText, { pooling: 'mean', normalize: true });
    // Convert Tensor to standard JS Array
    return Array.from(output.data);
  },

  /**
   * Saves or updates chunks for a session using hashing for invalidation.
   * @param {string} sessionId
   * @param {string[]} chunkTexts Array of raw text summaries
   */
  async saveSessionChunks(sessionId, chunkTexts) {
    if (!await this.init()) return;

    // Load existing chunks for this session
    const existing = await getVectorsBySession(sessionId);
    const existingMap = new Map();
    existing.forEach(rec => existingMap.set(rec.id, rec));

    const processedIds = new Set();

    for (let i = 0; i < chunkTexts.length; i++) {
      const text = chunkTexts[i];
      const hash = computeHash(text);
      const id = `${sessionId}_${i}`;
      processedIds.add(id);

      const existingRecord = existingMap.get(id);

      // Check if unchanged
      if (existingRecord && existingRecord.text_hash === hash) {
        // No change, skip vectorization
        continue;
      }

      // Changed or New
      try {
        console.log(`[Embeddings] Vectorizing chunk ${i} for session ${sessionId}...`);
        const embedding = await this.getVector(text, false);
        
        await putVector({
          id,
          session_id: sessionId,
          chunk_index: i,
          text_hash: hash,
          embedding,
          text
        });
      } catch (e) {
        console.error(`[Embeddings] Failed to vectorize chunk ${i}:`, e);
      }
    }

    // Cleanup removed chunks (if chat got shorter somehow)
    for (const [id, rec] of existingMap.entries()) {
      if (!processedIds.has(id)) {
        console.log(`[Embeddings] Removing orphaned chunk ${id}...`);
        await deleteVector(id);
      }
    }
  },

  /**
   * Retrieves relevant chunks using cosine similarity and diversity rules.
   * @param {string} queryText The user's query with context window
   * @param {object} options { topK, threshold, maxPerSession, excludeSessionId }
   */
  async search(queryText, options = {}) {
    const topK = options.topK || 3;
    const threshold = options.threshold || 0.6;
    const maxPerSession = options.maxPerSession || 2;
    const excludeSessionId = options.excludeSessionId;

    // If model is not loaded and not initializing, try to load it.
    // If it's already initializing (background pre-load), init() will wait for it.
    // Pass false to not spam toasts during search
    if (!await this.init(false)) return [];

    let queryVector;
    try {
      queryVector = await this.getVector(queryText, true); // use 'query: '
    } catch (e) {
      console.error('[Embeddings] Failed to vectorize query:', e);
      return [];
    }

    const allVectors = await getAllVectors();
    if (allVectors.length === 0) return [];

    // Calculate similarities
    const scored = allVectors.map(rec => ({
      ...rec,
      score: cosineSimilarity(queryVector, rec.embedding)
    }));

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // Filter, Deduplicate and Pick Top K
    const results = [];
    const sessionCounts = {};

    for (const rec of scored) {
      if (excludeSessionId && rec.session_id === excludeSessionId) continue;
      
      if (results.length >= topK) break;
      if (rec.score < threshold) continue;

      const sid = rec.session_id;
      if (!sessionCounts[sid]) sessionCounts[sid] = 0;
      
      // Diversity check
      if (sessionCounts[sid] >= maxPerSession) {
        continue;
      }

      results.push(rec);
      sessionCounts[sid]++;
    }

    return results;
  },

  /**
   * Remove all vectors for a given session (e.g., when a chat is deleted)
   */
  async removeSession(sessionId) {
    if (!await this.init(false)) return;
    const existing = await getVectorsBySession(sessionId);
    for (const rec of existing) {
      await deleteVector(rec.id);
    }
  },

  isModelLoaded() {
    return !!extractorPipeline;
  },

  isModelInitializing() {
    return isInitializing;
  },

  /**
   * Returns the number of vectors in the store (cheap count, no model needed)
   */
  async getVectorCount() {
    try {
      const allVecs = await getAllVectors();
      return allVecs.length;
    } catch (e) {
      return 0;
    }
  },

  /**
   * Migrate existing summaries from localStorage into the vector database
   */
  async migrateExistingSummaries(sessions) {
    try {
      const sessionsWithSummaries = (sessions || []).filter(s => s.summary && s.summary.trim().length > 0);
      if (sessionsWithSummaries.length === 0) {
        console.log('[Embeddings] No existing summaries found to index.');
        return;
      }

      const allVectors = await getAllVectors();
      const existingSessionIds = new Set(allVectors.map(v => v.session_id));
      const missing = sessionsWithSummaries.filter(s => !existingSessionIds.has(s.id));

      if (missing.length === 0) {
        console.log('[Embeddings] All session summaries are already indexed in vector DB.');
        return;
      }

      console.log(`[Embeddings] Found ${missing.length} unindexed session summaries. Initializing model...`);
      if (window.showToast) {
        window.showToast(`Smart Context: Indexing ${missing.length} chats into RAG database...`, 'info');
      }

      if (!await this.init(true)) {
        console.error('[Embeddings] Cannot migrate: Model initialization failed');
        return;
      }

      for (let i = 0; i < missing.length; i++) {
        const session = missing[i];
        console.log(`[Embeddings] Indexing (${i + 1}/${missing.length}): ${session.title || session.id}`);
        const chunks = (session.summary_chunks && session.summary_chunks.length > 0)
          ? (session.summary_chunks.length > 1 && session.summary ? [...session.summary_chunks, session.summary] : session.summary_chunks)
          : (session.summary ? [session.summary] : []);
        if (chunks.length > 0) {
          await this.saveSessionChunks(session.id, chunks);
        }
      }
      
      console.log('[Embeddings] Migration complete.');
      if (window.showToast) {
        window.showToast(`Smart Context: ${missing.length} chats added to RAG successfully!`, 'success');
      }
    } catch (e) {
      console.error('[Embeddings] Failed to migrate existing summaries:', e);
    }
  },

  /**
   * Re-index all saved summaries from scratch
   */
  async reindexAllSummaries(sessions) {
    const sessionsWithSummaries = (sessions || []).filter(s => s.summary && s.summary.trim().length > 0);
    if (sessionsWithSummaries.length === 0) {
      if (window.showToast) {
        window.showToast('Smart Context: No chat summaries found to index', 'info');
      }
      return;
    }

    if (window.showToast) {
      window.showToast(`Smart Context: Re-indexing ${sessionsWithSummaries.length} chat summaries...`, 'info');
    }

    if (!await this.init(true)) {
      if (window.showToast) {
        window.showToast('Smart Context: Failed to load search model', 'error');
      }
      return;
    }

    try {
      const dbInstance = await openDB();
      const tx = dbInstance.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      await new Promise((resolve, reject) => {
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      for (let i = 0; i < sessionsWithSummaries.length; i++) {
        const session = sessionsWithSummaries[i];
        console.log(`[Embeddings] Re-indexing (${i + 1}/${sessionsWithSummaries.length}): ${session.title || session.id}`);
        const chunks = (session.summary_chunks && session.summary_chunks.length > 0)
          ? (session.summary_chunks.length > 1 && session.summary ? [...session.summary_chunks, session.summary] : session.summary_chunks)
          : (session.summary ? [session.summary] : []);
        if (chunks.length > 0) {
          await this.saveSessionChunks(session.id, chunks);
        }
      }

      if (window.showToast) {
        window.showToast(`Smart Context: Re-indexed ${sessionsWithSummaries.length} chat summaries successfully!`, 'success');
      }
    } catch (e) {
      console.error('[Embeddings] Re-index failed:', e);
      if (window.showToast) {
        window.showToast('Smart Context: Re-indexing failed', 'error');
      }
    }
  }
};
