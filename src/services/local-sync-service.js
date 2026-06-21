/* ════════════════════════════════════════════════════════════════════
   Local Network Sync Service
   ════════════════════════════════════════════════════════════════════
   
   Provides two modes:
   
   HOST MODE  — started from settings panel; Rust axum server runs on
                port 8765, broadcasts UDP, exposes relay + sync bundle.
   
   CLIENT MODE — connects to a host by IP + key; redirects LLM requests
                 through host relay; pushes all data mutations back to
                 host in real-time (fire-and-forget).
   ════════════════════════════════════════════════════════════════════ */

const RELAY_TIMEOUT_MS = 60_000; // max time to wait for relay to respond
const PUSH_RETRY_ATTEMPTS = 3;
const PUSH_RETRY_DELAY_MS = 2000;

import { settingsStore } from './settings-store.js';

class LocalSyncService {
  constructor() {
    // ── Client state ──────────────────────────────────────────────────
    let persistedIp = '';
    let persistedPort = '8765';
    let persistedKey = '';
    try {
      persistedIp   = localStorage.getItem('llmchat_sync_host_ip') || '';
      persistedPort = localStorage.getItem('llmchat_sync_host_port') || '8765';
      persistedKey  = localStorage.getItem('llmchat_sync_host_key') || '';
    } catch { /* ignore */ }

    if (persistedIp && persistedKey) {
      this.isClientMode = true;
      this.hostBaseUrl  = `http://${persistedIp}:${persistedPort}`;
      this.hostKey      = persistedKey;
    } else {
      this.isClientMode = false;
      this.hostBaseUrl  = '';
      this.hostKey      = '';
    }

    // ── Host state (mirrored from Rust via polling) ───────────────────
    this.isHostMode    = false;
    this.hostKey_local = '';
    this.hostIp        = '';
    this.hostPort      = 8765;
    this.clientCount   = 0;

    this._statusPollInterval = null;
  }

  // ────────────────────────────────────────────────────────────────────
  // Client-facing API
  // ────────────────────────────────────────────────────────────────────

  getDeviceId() {
    let id = localStorage.getItem('llmchat_client_device_id');
    if (!id) {
      id = 'dev-' + Math.random().toString(36).substring(2, 11) + '-' + Math.random().toString(36).substring(2, 11);
      localStorage.setItem('llmchat_client_device_id', id);
    }
    return id;
  }

  getDeviceName() {
    const settings = settingsStore?.get() || {};
    return settings.user_name || 'Web Client';
  }

  getSyncHeaders() {
    return {
      'x-device-id': this.getDeviceId(),
      'x-device-name': this.getDeviceName(),
    };
  }

  /**
   * Attempt to connect to a host.
   * @returns {Promise<{ok: boolean, status?: string, error?: string}>}
   */
  async connectToHost(ip, port, key) {
    const base = `http://${ip}:${port}`;
    try {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (!invoke) return { ok: false, error: 'Tauri not available' };

      const url = `${base}/ping?key=${encodeURIComponent(key)}`;
      const respText = await invoke('client_http_request', {
        method: 'GET',
        url,
        body: null,
        headers: this.getSyncHeaders(),
        timeoutSecs: 5,
      });

      const json = JSON.parse(respText);
      if (!json.ok) return { ok: false, error: 'Unexpected response' };

      this.isClientMode = true;
      this.hostBaseUrl  = base;
      this.hostKey      = key;

      // Persist for next session
      this._savePersisted(ip, port, key);

      return { ok: true };
    } catch (err) {
      const errMsg = err.message || String(err);
      if (errMsg.toLowerCase().includes('timeout') || errMsg.toLowerCase().includes('timed out')) {
        return { ok: false, error: 'Host not reachable (timeout)' };
      }
      if (errMsg.includes('401')) {
        return { ok: false, status: 'pending', error: 'Approval required. Please authorize this device on the Host PC settings.' };
      }
      return { ok: false, error: errMsg };
    }
  }

  disconnectFromHost() {
    this.isClientMode = false;
    this.hostBaseUrl  = '';
    this.hostKey      = '';
  }

  /**
   * Fetch the sync bundle from host and merge it into local stores.
   * Additive merge — host data is NEVER deleted.
   */
  async syncFromHost() {
    if (!this.isClientMode) return { ok: false, error: 'Not in client mode' };
    try {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (!invoke) return { ok: false, error: 'Tauri not available' };

      const url = `${this.hostBaseUrl}/sync/bundle?key=${encodeURIComponent(this.hostKey)}`;
      const respText = await invoke('client_http_request', {
        method: 'GET',
        url,
        body: null,
        headers: this.getSyncHeaders(),
        timeoutSecs: 15,
      });
      const bundle = JSON.parse(respText);

      await this._applyBundle(bundle);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  /** Returns the relay URL to use instead of api_url/v1/chat/completions */
  getRelayUrl() {
    return `${this.hostBaseUrl}/relay?key=${encodeURIComponent(this.hostKey)}`;
  }

  // ────────────────────────────────────────────────────────────────────
  // Push methods (client → host, fire-and-forget)
  // ────────────────────────────────────────────────────────────────────

  pushChatToHost(characterId, chatData) {
    if (!this.isClientMode) return;
    this._pushWithRetry(`${this.hostBaseUrl}/push/chat?key=${encodeURIComponent(this.hostKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_id: characterId, data: chatData }),
    });
  }

  deleteChatOnHost(characterId, chatId) {
    if (!this.isClientMode) return;
    this._pushWithRetry(`${this.hostBaseUrl}/push/chat?key=${encodeURIComponent(this.hostKey)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_id: characterId, chat_id: chatId }),
    });
  }

  pushCharacterToHost(characterData) {
    if (!this.isClientMode) return;
    this._pushWithRetry(`${this.hostBaseUrl}/push/character?key=${encodeURIComponent(this.hostKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(characterData),
    });
  }

  deleteCharacterOnHost(characterId) {
    if (!this.isClientMode) return;
    this._pushWithRetry(`${this.hostBaseUrl}/push/character?key=${encodeURIComponent(this.hostKey)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: characterId }),
    });
  }

  pushGenaiHistoryToHost(historyData) {
    if (!this.isClientMode) return;
    this._pushWithRetry(`${this.hostBaseUrl}/push/genai_history?key=${encodeURIComponent(this.hostKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: historyData }),
    });
  }

  pushMemoryToHost(characterId, memoryData) {
    if (!this.isClientMode) return;
    this._pushWithRetry(`${this.hostBaseUrl}/push/memory?key=${encodeURIComponent(this.hostKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_id: characterId, data: memoryData }),
    });
  }

  pushGenaiMemoriesToHost(memoriesData) {
    if (!this.isClientMode) return;
    this._pushWithRetry(`${this.hostBaseUrl}/push/genai_memories?key=${encodeURIComponent(this.hostKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: memoriesData }),
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Host-mode polling (updates isHostMode, clientCount, etc.)
  // ────────────────────────────────────────────────────────────────────

  startStatusPolling(onUpdate) {
    this.stopStatusPolling();
    const poll = async () => {
      try {
        const status = await window.__TAURI_INTERNALS__?.invoke('get_host_server_status');
        if (status) {
          this.isHostMode   = status.running;
          this.hostIp       = status.local_ip || '';
          this.hostPort     = status.port || 8765;
          this.clientCount  = status.client_count || 0;
          this.hostKey_local = status.key || '';
          if (onUpdate) onUpdate(status);
        }
      } catch { /* ignore */ }
    };
    poll();
    this._statusPollInterval = setInterval(poll, 5000);
  }

  stopStatusPolling() {
    if (this._statusPollInterval) {
      clearInterval(this._statusPollInterval);
      this._statusPollInterval = null;
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────────────

  /** Fire-and-forget push with simple retry */
  async _pushWithRetry(url, options, attempt = 1) {
    try {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (!invoke) throw new Error('Tauri not available');

      await invoke('client_http_request', {
        method: options.method || 'POST',
        url,
        body: options.body || null,
        headers: {
          ...options.headers,
          ...this.getSyncHeaders(),
        },
        timeoutSecs: 8,
      });
    } catch (err) {
      const errMsg = err.message || String(err);
      if (attempt < PUSH_RETRY_ATTEMPTS) {
        setTimeout(() => this._pushWithRetry(url, options, attempt + 1), PUSH_RETRY_DELAY_MS);
      } else {
        console.warn('[LocalSync] Push failed after retries:', errMsg);
      }
    }
  }

  /** Apply a sync bundle received from host into local Tauri storage */
  async _applyBundle(bundle) {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (!invoke) return;

    // 1. Settings — merge (Host settings take priority, preserving local network fields)
    if (bundle.settings && typeof bundle.settings === 'object') {
      const { api_url, ...hostSettings } = bundle.settings;
      try {
        const localRaw = await invoke('load_settings');
        const local = localRaw ? JSON.parse(localRaw) : {};
        const merged = {
          ...local,
          ...hostSettings,
          api_url: local.api_url || hostSettings.api_url,
          comfyui_url: local.comfyui_url || hostSettings.comfyui_url,
          local_sync_saved_host_ip: local.local_sync_saved_host_ip || hostSettings.local_sync_saved_host_ip,
          local_sync_saved_host_key: local.local_sync_saved_host_key || hostSettings.local_sync_saved_host_key,
        };
        await invoke('save_settings', { data: JSON.stringify(merged) });
      } catch { /* ignore */ }
    }

    // 2. Characters — additive upsert
    if (Array.isArray(bundle.characters)) {
      for (const char of bundle.characters) {
        try {
          await invoke('save_character', { data: JSON.stringify(char) });
        } catch { /* ignore individual failures */ }
      }
    }

    // 3. Chats — additive upsert per character
    if (bundle.chats && typeof bundle.chats === 'object') {
      for (const [charId, sessions] of Object.entries(bundle.chats)) {
        if (!Array.isArray(sessions)) continue;
        for (const session of sessions) {
          try {
            await invoke('save_chat', { characterId: charId, data: JSON.stringify(session) });
          } catch { /* ignore */ }
        }
      }
    }

    // 4. GenAI Memories
    if (bundle.memories && typeof bundle.memories === 'object') {
      for (const [charId, memoryData] of Object.entries(bundle.memories)) {
        try {
          await invoke('save_memory', { character_id: charId, data: JSON.stringify(memoryData) });
        } catch { /* ignore */ }
      }
    }

    // 5. GenAI History
    if (bundle.genai_history) {
      try {
        await invoke('save_genai_history', { data: JSON.stringify(bundle.genai_history) });
      } catch { /* ignore */ }
    }

    // 6. Games State (RPG)
    if (bundle.games_state) {
      try {
        await invoke('save_game_state', { data: JSON.stringify(bundle.games_state) });
      } catch { /* ignore */ }
    }

    // 7. Groups and 8. Group Chats
    if (bundle.groups) {
      try {
        await invoke('save_group_state', { data: JSON.stringify(bundle.groups) });
      } catch { /* ignore */ }
    }
    if (bundle.group_chats && typeof bundle.group_chats === 'object') {
      for (const [groupId, groupSession] of Object.entries(bundle.group_chats)) {
        try {
          await invoke('save_group_sessions', { group_id: groupId, data: JSON.stringify(groupSession) });
        } catch { /* ignore */ }
      }
    }

    // 9. Custom Skills
    if (bundle.skills && typeof bundle.skills === 'object') {
      for (const [filename, content] of Object.entries(bundle.skills)) {
        try {
          await invoke('save_skill', { filename, content });
        } catch { /* ignore */ }
      }
    }

    // 10. Credentials (API Keys)
    if (bundle.credentials && typeof bundle.credentials === 'object') {
      for (const [provider, key] of Object.entries(bundle.credentials)) {
        try {
          await invoke('save_credential', { provider, key });
        } catch { /* ignore */ }
      }
    }

    // 11. GenAI assistant memories (stored facts)
    if (bundle.genai_memories) {
      try {
        await invoke('save_genai_memories', { data: JSON.stringify(bundle.genai_memories) });
      } catch { /* ignore */ }
    }

    // Notify app to reload characters, chats, and other settings
    window.dispatchEvent(new CustomEvent('local-sync-applied'));
  }

  /** Persist connection details for next startup */
  _savePersisted(ip, port, key) {
    try {
      localStorage.setItem('llmchat_sync_host_ip', ip);
      localStorage.setItem('llmchat_sync_host_port', String(port));
      localStorage.setItem('llmchat_sync_host_key', key);
    } catch { /* ignore */ }
  }

  /** Load previously saved connection details */
  loadPersisted() {
    return {
      ip:   localStorage.getItem('llmchat_sync_host_ip') || '',
      port: parseInt(localStorage.getItem('llmchat_sync_host_port') || '8765', 10),
      key:  localStorage.getItem('llmchat_sync_host_key') || '',
    };
  }

  clearPersisted() {
    localStorage.removeItem('llmchat_sync_host_ip');
    localStorage.removeItem('llmchat_sync_host_port');
    localStorage.removeItem('llmchat_sync_host_key');
  }
}

export const localSyncService = new LocalSyncService();
