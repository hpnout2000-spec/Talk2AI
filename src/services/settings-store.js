/* ════════════════════════════════════════════════════════════════════
   Settings Store — Persistent app settings via Tauri or localStorage
   ════════════════════════════════════════════════════════════════════ */

const DEFAULTS = {
  api_url: 'http://localhost:5001',
  max_tokens: 2048,
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  rep_penalty: 1.1,
  thinking_enabled: false,
  memory_enabled: true,
  font_size: 15,
};

let settings = { ...DEFAULTS };

// Try to use Tauri backend, fallback to localStorage
async function invokeTauri(cmd, args = {}) {
  if (window.__TAURI_INTERNALS__) {
    return await window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  return null;
}

export const settingsStore = {
  async load() {
    try {
      const result = await invokeTauri('load_settings');
      if (result) {
        settings = { ...DEFAULTS, ...JSON.parse(result) };
      } else {
        // localStorage fallback
        const saved = localStorage.getItem('llmchat_settings');
        if (saved) {
          settings = { ...DEFAULTS, ...JSON.parse(saved) };
        }
      }
    } catch (e) {
      console.warn('Failed to load settings, using defaults:', e);
    }
    return settings;
  },

  get() {
    return { ...settings };
  },

  async save(newSettings) {
    settings = { ...settings, ...newSettings };
    try {
      await invokeTauri('save_settings', { data: JSON.stringify(settings) });
    } catch {
      localStorage.setItem('llmchat_settings', JSON.stringify(settings));
    }
    return settings;
  },

  update(key, value) {
    settings[key] = value;
  },
};
