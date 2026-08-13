/* ════════════════════════════════════════════════════════════════════
   GenAI Embeddings Store — RAG Vector Database & Search
   ════════════════════════════════════════════════════════════════════ */

import { pipeline, env } from '../vendor/transformers.js';

// Configuration
env.allowLocalModels = false; // Force downloading from HuggingFace Hub (cached locally by browser)
const MODEL_NAME = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const DB_NAME = 'genai_embeddings_db';
const STORE_NAME = 'vectors';

let extractorPipeline = null;
let db = null;
let isInitializing = false;

// ─── IndexedDB Setup ────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const request = window.indexedDB.open(DB_NAME, 1);
    
    request.onerror = (e) => reject(e.target.error);
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        // We'll use a composite key for uniqueness, e.g., `${session_id}_${chunk_index}`
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('session_id', 'session_id', { unique: false });
      }
    };
  });
}

function putVector(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function getVectorsBySession(sessionId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('session_id');
    const req = index.getAll(IDBKeyRange.only(sessionId));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function deleteVector(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function getAllVectors() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
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
        window.showToast('Smart Context: Downloading search model (~45 MB)... This will take a moment on first run.', 'info');
      }
      // We use feature-extraction pipeline
      extractorPipeline = await pipeline('feature-extraction', MODEL_NAME, {
        dtype: 'fp32' // standard Float32 for JS arrays
      });
      console.log('[Embeddings] Model loaded successfully.');
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

  async getVector(text) {
    if (!extractorPipeline) await this.init();
    if (!extractorPipeline) throw new Error('Embeddings pipeline not initialized');

    // Run the text through the model
    const output = await extractorPipeline(text, { pooling: 'mean', normalize: true });
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
        const embedding = await this.getVector(text);
        
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

    // If currently downloading the model, don't block the user's chat. Just skip RAG.
    if (isInitializing) {
      console.log('[Embeddings] Search skipped because model is still initializing/downloading.');
      return [];
    }
    
    // Pass false to not spam toasts during search
    if (!await this.init(false)) return [];

    let queryVector;
    try {
      queryVector = await this.getVector(queryText);
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
    if (!await this.init()) return;
    const existing = await getVectorsBySession(sessionId);
    for (const rec of existing) {
      await deleteVector(rec.id);
    }
  }
};
