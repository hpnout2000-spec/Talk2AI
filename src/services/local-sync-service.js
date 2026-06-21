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

class LocalSyncService {
  constructor() {
    // ── Client state ──────────────────────────────────────────────────
    this.isClientMode = false;
    this.hostBaseUrl  = '';  // e.g. "http://192.168.1.5:8765"
    this.hostKey      = '';

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

  /**
   * Attempt to connect to a host.
   * @returns {Promise<{ok: boolean, error?: string}>}
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

    // 1. Settings — merge (do NOT overwrite local api_url etc.)
    if (bundle.settings && typeof bundle.settings === 'object') {
      const { api_url, ...hostSettings } = bundle.settings;
      // Apply host settings but keep our own network settings
      try {
        const localRaw = await invoke('load_settings');
        const local = localRaw ? JSON.parse(localRaw) : {};
        const merged = { ...hostSettings, ...local }; // local takes priority for network fields
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

    // Notify app to reload characters and chats
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
