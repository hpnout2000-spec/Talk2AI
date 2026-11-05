/* ════════════════════════════════════════════════════════════════════
   Offline Translation Service — Ultra-lightweight CPU NMT
   Uses Transformers.js + MarianMT (opus-mt-en-ru / opus-mt-ru-en)
   Zero LLM prefill delay, runs in-process with minimal RAM footprint.
   ════════════════════════════════════════════════════════════════════ */

import { pipeline, env } from '../vendor/transformers.js';

const baseUrl = (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null')
  ? window.location.origin
  : '';

// Configuration: allow local model assets via HTTP fetch and fast HF mirror fallback
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.localModelPath = baseUrl ? `${baseUrl}/models/` : './models/';
env.remoteHost = 'https://hf-mirror.com/';

// Point ONNX WASM binaries directly to local vendor directory
const vendorBase = baseUrl ? `${baseUrl}/vendor/` : './vendor/';
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.wasmPaths = {
    mjs: `${vendorBase}ort-wasm-simd-threaded.asyncify.mjs`,
    wasm: `${vendorBase}ort-wasm-simd-threaded.asyncify.wasm`
  };
}

const MODEL_EN_RU = 'Xenova/opus-mt-en-ru';
const MODEL_RU_EN = 'Xenova/opus-mt-ru-en';

let enRuPipeline = null;
let ruEnPipeline = null;
let initPromises = {
  'en-ru': null,
  'ru-en': null
};

// In-memory fallback flags in case browser localStorage quota is exceeded (5MB limit)
let isEnRuInstalledMemory = false;
let isRuEnInstalledMemory = false;

/**
 * Safe localStorage setter that never throws QuotaExceededError
 */
function safeSetStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`[Translation] localStorage quota exceeded or unavailable for ${key}. Falling back to in-memory state:`, e);
  }
}

/**
 * Safe localStorage getter
 */
function safeGetStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

export const translationService = {
  /**
   * Check if a specific translation model pipeline is loaded in RAM
   */
  isModelLoaded(langPair = 'en-ru') {
    return langPair === 'ru-en' ? !!ruEnPipeline : !!enRuPipeline;
  },

  /**
   * Fast synchronous check from memory flags or localStorage
   */
  isModelInstalledSync(langPair = 'en-ru') {
    if (langPair === 'ru-en') {
      if (isRuEnInstalledMemory || !!ruEnPipeline) return true;
      return safeGetStorage('translation_model_ru_en_installed') === 'true';
    } else {
      if (isEnRuInstalledMemory || !!enRuPipeline) return true;
      return safeGetStorage('translation_model_installed') === 'true';
    }
  },

  lastInitError: null,

  /**
   * Lightweight check: checks memory, localStorage, web assets, and Tauri disk
   * Never passes large binaries over IPC to avoid freezing WebView2.
   * @param {'en-ru' | 'ru-en'} langPair
   * @returns {Promise<boolean>}
   */
  async checkInstalled(langPair = 'en-ru') {
    if (this.isModelLoaded(langPair)) return true;
    if (this.isModelInstalledSync(langPair)) return true;

    const modelFolder = langPair === 'ru-en' ? 'opus-mt-ru-en' : 'opus-mt-en-ru';
    const key = langPair === 'ru-en' ? 'translation_model_ru_en_installed' : 'translation_model_installed';

    // 1. Check web assets (served directly via HTTP fetch from src/models)
    for (const prefix of ['./models/Xenova/', '/models/Xenova/', 'models/Xenova/']) {
      try {
        const res = await fetch(`${prefix}${modelFolder}/config.json`, { method: 'GET' });
        if (res.ok || res.status === 200 || res.status === 206) {
          if (langPair === 'ru-en') isRuEnInstalledMemory = true;
          else isEnRuInstalledMemory = true;
          safeSetStorage(key, 'true');
          console.log(`[Translation] Detected local model assets at ${prefix}${modelFolder}`);
          return true;
        }
      } catch (e) {
        // Continue checking
      }
    }

    // 2. Check Tauri disk status (simple boolean check, zero data overhead)
    if (window.__TAURI_INTERNALS__?.invoke) {
      try {
        const exists = await window.__TAURI_INTERNALS__.invoke('check_local_model_exists', { langPair });
        if (exists) {
          if (langPair === 'ru-en') isRuEnInstalledMemory = true;
          else isEnRuInstalledMemory = true;
          safeSetStorage(key, 'true');
          console.log(`[Translation] Detected offline model on disk for ${langPair}`);
          return true;
        }
      } catch (e) {
        console.warn('[Translation] check_local_model_exists error:', e);
      }
    }

    return false;
  },

  isModelInitializing(langPair = null) {
    if (langPair) return !!initPromises[langPair];
    return !!(initPromises['en-ru'] || initPromises['ru-en']);
  },

  /**
   * Detect language direction based on Cyrillic character presence
   * @param {string} text
   * @returns {'en-ru' | 'ru-en'}
   */
  detectDirection(text) {
    const hasCyrillic = /[а-яёА-ЯЁ]/.test(text || '');
    return hasCyrillic ? 'ru-en' : 'en-ru';
  },

  /**
   * Download and initialize the translation pipeline
   * @param {boolean} showToasts
   * @param {'en-ru' | 'ru-en'} langPair
   */
  async init(showToasts = true, langPair = 'en-ru') {
    const targetModel = langPair === 'ru-en' ? MODEL_RU_EN : MODEL_EN_RU;
    const currentPipeline = langPair === 'ru-en' ? ruEnPipeline : enRuPipeline;

    if (currentPipeline) return true;

    // Reuse in-flight initialization promise to prevent race conditions
    if (initPromises[langPair]) {
      return initPromises[langPair];
    }

    initPromises[langPair] = (async () => {
      try {
        this.lastInitError = null;
        console.log(`[Translation] Initializing CPU pipeline for ${targetModel}...`);

        if (showToasts && window.showToast) {
          window.showToast('Translation: Initializing CPU model...', 'info');
        }

        env.allowLocalModels = true;
        env.allowRemoteModels = true;
        env.localModelPath = baseUrl ? `${baseUrl}/models/` : './models/';
        env.remoteHost = 'https://hf-mirror.com/';

        if (env.backends?.onnx?.wasm) {
          env.backends.onnx.wasm.proxy = false;
          env.backends.onnx.wasm.wasmPaths = {
            mjs: `${vendorBase}ort-wasm-simd-threaded.asyncify.mjs`,
            wasm: `${vendorBase}ort-wasm-simd-threaded.asyncify.wasm`
          };
        }

        let loaded = null;
        let lastErr = null;

        try {
          loaded = await pipeline('translation', targetModel, {
            dtype: 'q8',
            device: 'wasm'
          });
        } catch (err1) {
          console.warn(`[Translation] Primary load via local/mirror failed:`, err1);
          lastErr = err1;

          // Fallback to official Hugging Face repository
          try {
            env.remoteHost = 'https://huggingface.co/';
            loaded = await pipeline('translation', targetModel, {
              dtype: 'q8',
              device: 'wasm'
            });
          } catch (err2) {
            console.warn(`[Translation] HuggingFace fallback failed:`, err2);
            lastErr = err2;
          }
        }

        if (!loaded) {
          throw lastErr || new Error(`Failed to load translation model for ${langPair}`);
        }

        if (langPair === 'ru-en') {
          ruEnPipeline = loaded;
          isRuEnInstalledMemory = true;
          safeSetStorage('translation_model_ru_en_installed', 'true');
        } else {
          enRuPipeline = loaded;
          isEnRuInstalledMemory = true;
          safeSetStorage('translation_model_installed', 'true');
        }

        console.log(`[Translation] Model ${targetModel} loaded and ready on CPU.`);
        window.dispatchEvent(new CustomEvent('translation-model-status-changed', {
          detail: { langPair, status: 'ready' }
        }));

        if (showToasts && window.showToast) {
          window.showToast('Translation: Offline model ready!', 'success');
        }
        return true;
      } catch (err) {
        console.error(`[Translation] Initialization failed for ${targetModel}:`, err);
        const errMsg = (err && typeof err === 'object')
          ? (err.message || err.toString())
          : String(err || 'Unknown error');
        this.lastInitError = new Error(errMsg);
        if (showToasts && window.showToast) {
          window.showToast(`Translation: ${errMsg.substring(0, 80)}`, 'error');
        }
        return false;
      } finally {
        initPromises[langPair] = null;
      }
    })();

    return initPromises[langPair];
  },

  /**
   * Translate text using local CPU MarianMT model
   * @param {string} text
   * @param {string} [direction] 'en-ru' or 'ru-en', auto-detected if omitted
   * @returns {Promise<{ translation: string, direction: string }>}
   */
  async translate(text, direction = null) {
    const trimmed = (text || '').trim();
    if (!trimmed) {
      return { translation: '', direction: 'en-ru' };
    }

    let dir = direction || this.detectDirection(trimmed);
    let targetPipeline = dir === 'ru-en' ? ruEnPipeline : enRuPipeline;

    if (!targetPipeline) {
      let ok = await this.init(false, dir);
      if (!ok && dir === 'ru-en') {
        // Fallback: check if primary en-ru is ready
        const okEnRu = await this.init(false, 'en-ru');
        if (okEnRu) {
          dir = 'en-ru';
          ok = true;
        }
      }

      targetPipeline = dir === 'ru-en' ? ruEnPipeline : enRuPipeline;
    }

    if (!targetPipeline) {
      const errDetail = this.lastInitError?.message || 'Model initialization failed';
      throw new Error(errDetail);
    }

    // Run inference with greedy search for maximum speed
    const output = await targetPipeline(trimmed, {
      max_new_tokens: 256
    });

    const translatedText = Array.isArray(output) && output[0] && output[0].translation_text
      ? output[0].translation_text.trim()
      : (typeof output === 'string' ? output : (output?.[0]?.translation_text || ''));

    return {
      translation: translatedText,
      direction: dir
    };
  }
};
