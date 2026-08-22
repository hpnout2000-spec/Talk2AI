/* ════════════════════════════════════════════════════════════════════
   Smart Context Manager — Automatic & manual chat summaries
   ════════════════════════════════════════════════════════════════════ */

import { api } from '../services/api.js';
import { settingsStore } from '../services/settings-store.js';
import { getGenaiSessions, saveHistory } from './genai-panel.js';
import { showToast, openWindow, closeWindow } from '../main.js';
import { escapeHtml } from '../utils/helpers.js';
import { genaiEmbeddingsStore } from './genai-embeddings-store.js';

let isSyncRunning = false;
let activeSummarizations = {}; // Keeps track of active summarization promises by session ID
let autoUpdateTimers = {}; // Inactivity timers by session ID
let isProceedingOverride = false; // State to handle user overriding warning dialog

export function initSmartContextMgr() {
  const btnOpen = document.getElementById('btn-open-smart-context');
  const btnOpenGear = document.getElementById('btn-genai-smart-context-settings');
  const btnClose = document.getElementById('btn-close-smart-context');
  const modal = document.getElementById('modal-smart-context');
  const backdrop = modal ? modal.querySelector('.modal-backdrop') : null;
  const btnAutoSync = document.getElementById('btn-smart-context-autosync');
  const inputLimit = document.getElementById('setting-smart-context-limit');
  const sliderDepth = document.getElementById('setting-smart-context-depth');
  const labelDepth = document.getElementById('label-smart-context-depth');
  const toggleDropdown = document.getElementById('toggle-genai-smart-context');

  const warningPopup = document.getElementById('genai-smart-context-warning');
  const btnWarningWait = document.getElementById('btn-genai-sc-warning-wait');
  const btnWarningProceed = document.getElementById('btn-genai-sc-warning-proceed');

  if (!modal) {
    console.error('modal-smart-context element not found');
    return;
  }

  const btnRagInstall = document.getElementById('btn-rag-model-install');
  const labelRagStatus = document.getElementById('label-rag-model-status');
  const btnRagReindex = document.getElementById('btn-rag-reindex-all');
  const btnToggleAdvanced = document.getElementById('btn-toggle-sc-advanced');
  const contentAdvanced = document.getElementById('content-sc-advanced');
  const chevronAdvanced = document.getElementById('chevron-sc-advanced');

  if (btnToggleAdvanced && contentAdvanced) {
    btnToggleAdvanced.addEventListener('click', () => {
      const isHidden = contentAdvanced.classList.toggle('hidden');
      if (chevronAdvanced) {
        chevronAdvanced.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(180deg)';
      }
    });
  }

  async function updateRagModelUI() {
    if (!btnRagInstall || !labelRagStatus) return;

    const isInstalledOnDisk = localStorage.getItem('smart_context_model_installed') === 'true';
    const isModelLoaded = genaiEmbeddingsStore.isModelLoaded();
    const isCurrentlyInitializing = genaiEmbeddingsStore.isModelInitializing();

    // If localStorage flag is missing, check if vectors exist in IndexedDB as a secondary signal
    let hasVectorsInDB = false;
    if (!isInstalledOnDisk && !isModelLoaded && !isCurrentlyInitializing) {
      try {
        const vectors = await genaiEmbeddingsStore.getVectorCount();
        hasVectorsInDB = vectors > 0;
        if (hasVectorsInDB) {
          // Restore the lost localStorage flag
          localStorage.setItem('smart_context_model_installed', 'true');
          console.log('[RAG UI] Restored smart_context_model_installed flag from IndexedDB data');
        }
      } catch (e) {
        // Ignore — DB might not be open yet
      }
    }

    const isEffectivelyInstalled = isInstalledOnDisk || hasVectorsInDB;

    console.log('[RAG UI] updateRagModelUI called:', { isModelLoaded, isCurrentlyInitializing, isInstalledOnDisk, hasVectorsInDB });

    if (isModelLoaded || isEffectivelyInstalled) {
      labelRagStatus.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; margin-right: 2px;">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        ${isModelLoaded ? 'Ready' : 'Installed'}
      `;
      btnRagInstall.disabled = true;
      btnRagInstall.style.opacity = '0.7';
      btnRagInstall.style.cursor = 'default';

      // Auto-load silently in the background if installed but not loaded in memory yet
      if (!isModelLoaded && !isCurrentlyInitializing) {
        console.log('[RAG UI] Model installed on disk but not loaded, initiating background load...');
        genaiEmbeddingsStore.init(false).then((success) => {
          console.log('[RAG UI] Background load completed:', success);
          updateRagModelUI();
        }).catch(err => {
          console.error('[RAG UI] Background load failed:', err);
        });
      }
    } else if (isCurrentlyInitializing) {
      labelRagStatus.textContent = 'Loading...';
      btnRagInstall.disabled = true;
      btnRagInstall.style.opacity = '0.7';
      btnRagInstall.style.cursor = 'default';
    } else {
      labelRagStatus.textContent = 'Install';
      btnRagInstall.disabled = false;
      btnRagInstall.style.opacity = '1';
      btnRagInstall.style.cursor = 'pointer';
    }
  }

  // Open modal from settings
  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      openWindow(modal);
      loadSettingsToSC();
      renderSmartContextChats();
      updateRagModelUI();
      const sessions = getGenaiSessions() || [];
      genaiEmbeddingsStore.migrateExistingSummaries(sessions).then(updateRagModelUI);
    });
  }

  // Open modal from dropdown gear icon (shortcut)
  if (btnOpenGear) {
    btnOpenGear.addEventListener('click', (e) => {
      e.stopPropagation();
      // Hide the chat popover dropdown
      const chatMenuPopover = document.getElementById('genai-chat-menu-popover');
      if (chatMenuPopover) {
        chatMenuPopover.classList.add('hidden');
      }
      openWindow(modal);
      loadSettingsToSC();
      renderSmartContextChats();
      updateRagModelUI();
      const sessions = getGenaiSessions() || [];
      genaiEmbeddingsStore.migrateExistingSummaries(sessions).then(updateRagModelUI);
    });
  }

  // RAG Model Install button
  if (btnRagInstall) {
    btnRagInstall.addEventListener('click', async () => {
      if (genaiEmbeddingsStore.isModelLoaded() || genaiEmbeddingsStore.isModelInitializing()) return;
      labelRagStatus.textContent = 'Installing...';
      btnRagInstall.disabled = true;
      btnRagInstall.style.opacity = '0.7';
      await genaiEmbeddingsStore.init(true);
      updateRagModelUI();
    });
  }

  // Re-index all summaries button
  if (btnRagReindex) {
    btnRagReindex.addEventListener('click', async () => {
      btnRagReindex.disabled = true;
      btnRagReindex.style.opacity = '0.7';
      const initialText = btnRagReindex.querySelector('span')?.textContent || 'Re-index all summaries';
      const span = btnRagReindex.querySelector('span');
      if (span) span.textContent = 'Re-indexing...';

      try {
        const sessions = getGenaiSessions() || [];
        await genaiEmbeddingsStore.reindexAllSummaries(sessions);
      } finally {
        btnRagReindex.disabled = false;
        btnRagReindex.style.opacity = '1';
        if (span) span.textContent = initialText;
        updateRagModelUI();
      }
    });
  }

  // Close modal via X button
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      closeWindow(modal);
    });
  }

  // Close modal via backdrop click
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      closeWindow(modal);
    });
  }

  // Auto Sync Button
  if (btnAutoSync) {
    btnAutoSync.addEventListener('click', runAutoSync);
  }

  // Settings: input token limit
  if (inputLimit) {
    inputLimit.addEventListener('change', () => {
      let val = parseInt(inputLimit.value);
      if (isNaN(val) || val < 100) val = 1500;
      settingsStore.save({ genai_smart_context_token_limit: val });
    });
  }

  const setRangeFill = (el) => {
    if (!el) return;
    const min = parseFloat(el.min) || 1;
    const max = parseFloat(el.max) || 10;
    const val = parseFloat(el.value) || 1;
    const pct = ((val - min) / (max - min)) * 100;
    el.style.setProperty('--range-fill', `${pct}%`);
  };

  function updateDepthLabel(val) {
    if (sliderDepth) setRangeFill(sliderDepth);
    if (!labelDepth) return;
    const num = parseInt(val, 10);
    if (num === 1) {
      labelDepth.textContent = '1 (Only last message)';
    } else if (num >= 10) {
      labelDepth.textContent = 'Max (Keep all)';
    } else {
      labelDepth.textContent = `${num}`;
    }
  }

  // Settings: Context retention depth slider
  if (sliderDepth) {
    setRangeFill(sliderDepth);
    sliderDepth.addEventListener('input', (e) => {
      updateDepthLabel(e.target.value);
    });
    sliderDepth.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      settingsStore.save({ genai_rag_context_depth: val });
      updateDepthLabel(val);
    });
  }

  // Settings: dropdown checkbox quick toggle
  if (toggleDropdown) {
    // Initial sync
    const settings = settingsStore.get();
    toggleDropdown.checked = !!settings.genai_smart_context;

    toggleDropdown.addEventListener('change', (e) => {
      const checked = e.target.checked;
      settingsStore.save({ genai_smart_context: checked });
      showToast(checked ? 'Smart Context enabled' : 'Smart Context disabled');
    });
  }

  // Warning Popup handling
  if (btnWarningWait) {
    btnWarningWait.addEventListener('click', () => {
      if (warningPopup) warningPopup.classList.add('hidden');
      window.showingSmartContextWarning = false;
    });
  }

  if (btnWarningProceed) {
    btnWarningProceed.addEventListener('click', () => {
      proceedSendingMessage();
    });
  }

  // Sync settings when modified elsewhere
  window.addEventListener('settings-updated', () => {
    if (toggleDropdown) {
      toggleDropdown.checked = !!settingsStore.get().genai_smart_context;
    }
    if (inputLimit) {
      inputLimit.value = settingsStore.get().genai_smart_context_token_limit || 1500;
    }
    if (sliderDepth) {
      const depth = settingsStore.get().genai_rag_context_depth !== undefined ? settingsStore.get().genai_rag_context_depth : 1;
      sliderDepth.value = depth;
      updateDepthLabel(depth);
    }
  });

  // Global checker for active background summarizations
  window.isSmartContextRunning = () => {
    return Object.keys(activeSummarizations).length > 0 || isSyncRunning;
  };

  // Pre-load model in background to prevent UI freeze on the first message sent.
  // We always attempt to load if smart_context is enabled, regardless of localStorage flag
  // (the flag may not persist reliably across Tauri restarts).
  setTimeout(() => {
    const settings = settingsStore.get();
    if (settings.genai_smart_context && !genaiEmbeddingsStore.isModelLoaded() && !genaiEmbeddingsStore.isModelInitializing()) {
      console.log('[Smart Context] Pre-loading model in background...');
      genaiEmbeddingsStore.init(false).then(success => {
        console.log('[Smart Context] Background pre-load result:', success);
      }).catch(err => {
        console.error('[Smart Context] Background pre-load failed:', err);
      });
    }
  }, 2000);

  // Run migration in background after a short delay so it doesn't block startup
  setTimeout(async () => {
    const sessions = getGenaiSessions() || [];
    if (sessions.length > 0) {
      await genaiEmbeddingsStore.migrateExistingSummaries(sessions);
    }
  }, 5000);
}

function loadSettingsToSC() {
  const settings = settingsStore.get();
  const inputLimit = document.getElementById('setting-smart-context-limit');
  if (inputLimit) {
    inputLimit.value = settings.genai_smart_context_token_limit || 1500;
  }
  const sliderDepth = document.getElementById('setting-smart-context-depth');
  const labelDepth = document.getElementById('label-smart-context-depth');
  if (sliderDepth) {
    const depth = settings.genai_rag_context_depth !== undefined ? settings.genai_rag_context_depth : 1;
    sliderDepth.value = depth;
    const min = parseFloat(sliderDepth.min) || 1;
    const max = parseFloat(sliderDepth.max) || 10;
    const pct = ((depth - min) / (max - min)) * 100;
    sliderDepth.style.setProperty('--range-fill', `${pct}%`);
    if (labelDepth) {
      if (depth === 1) {
        labelDepth.textContent = '1 (Only last message)';
      } else if (depth >= 10) {
        labelDepth.textContent = 'Max (Keep all)';
      } else {
        labelDepth.textContent = `${depth}`;
      }
    }
  }
}

// Proceed with sending the message
function proceedSendingMessage() {
  const warningPopup = document.getElementById('genai-smart-context-warning');
  if (warningPopup) warningPopup.classList.add('hidden');
  window.showingSmartContextWarning = false;
  
  // Set proceed override flag so the next call bypasses check
  isProceedingOverride = true;
  
  // Trigger send message click in genai-panel
  const sendBtn = document.getElementById('btn-genai-send');
  if (sendBtn) sendBtn.click();
}

// Expose proceed helper to global
window.proceedSmartContextWarning = proceedSendingMessage;

export function renderSmartContextChats() {
  const container = document.getElementById('smart-context-chats-list');
  if (!container) return;

  const sessions = (getGenaiSessions() || []).slice().sort((a, b) => {
    const timeA = new Date(a.updated_at || a.created_at || 0).getTime();
    const timeB = new Date(b.updated_at || b.created_at || 0).getTime();
    return timeB - timeA;
  });

  if (sessions.length === 0) {
    container.innerHTML = `
      <div style="padding: 16px; color: var(--text-tertiary); text-align: center; font-size: var(--text-sm);">
        No recent chats
      </div>
    `;
    return;
  }

  container.innerHTML = sessions.map(session => {
    const hasSummary = session.summary && session.summary.trim().length > 0;
    const isRunning = !!activeSummarizations[session.id];
    const isIncluded = hasSummary;
    
    let badgeHtml = '';
    if (isRunning) {
      badgeHtml = `<span class="badge" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.2); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 500;">Syncing...</span>`;
    } else if (hasSummary) {
      badgeHtml = `<span class="badge" style="background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 500;">Saved</span>`;
    } else {
      badgeHtml = `<span class="badge" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 500;">Not preserved</span>`;
    }

    const toggleButtonHtml = `
      <button class="btn-sc-modal-toggle ${isIncluded ? 'active' : ''}" data-id="${session.id}" title="${isIncluded ? 'Remove from Smart Context' : 'Add to Smart Context'}" type="button">
        ${isIncluded ? `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 14px; height: 14px;">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        ` : `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        `}
      </button>
    `;

    return `
      <div class="sc-chat-row" data-id="${session.id}" style="border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 12px; cursor: pointer; transition: all var(--transition-fast); background: var(--bg-primary); display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
          <span style="font-weight: 500; font-size: var(--text-sm); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">
            ${escapeHtml(session.title || 'New Chat')}
          </span>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${toggleButtonHtml}
            ${badgeHtml}
          </div>
        </div>
        ${hasSummary ? `
          <div class="sc-chat-summary-text" style="display: none; font-size: var(--text-xs); color: var(--text-secondary); font-style: italic; margin-top: 6px; padding: 8px 12px; background: rgba(255,255,255,0.02); border-left: 2px solid var(--text-accent); border-radius: 2px; line-height: 1.4; word-break: break-word; white-space: pre-wrap;">${escapeHtml(session.summary)}</div>
        ` : ''}
      </div>
    `;
  }).join('');

  // Bind click expand/collapse
  container.querySelectorAll('.sc-chat-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.btn-sc-modal-toggle')) return;
      const summaryText = row.querySelector('.sc-chat-summary-text');
      if (summaryText) {
        const isCollapsed = summaryText.style.display === 'none';
        summaryText.style.display = isCollapsed ? 'block' : 'none';
        row.style.background = isCollapsed ? 'var(--bg-secondary)' : 'var(--bg-primary)';
      }
    });
  });

  // Bind click toggle inclusion (summarizing or deleting)
  container.querySelectorAll('.btn-sc-modal-toggle').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const sessions = getGenaiSessions() || [];
      const session = sessions.find(s => s.id === id);
      if (session) {
        const hasSummary = session.summary && session.summary.trim().length > 0;
        if (hasSummary) {
          session.summary = '';
          genaiEmbeddingsStore.removeSession(session.id).catch(console.error);
          saveHistory();
          renderSmartContextChats();
          if (window.renderRecentChatsList) {
            window.renderRecentChatsList();
          }
        } else {
          // Trigger background summarization
          await updateSessionSummaryIfNeeded(session, true);
          if (window.renderRecentChatsList) {
            window.renderRecentChatsList();
          }
        }
      }
    });
  });
}

// Background summarization function
export async function updateSessionSummaryIfNeeded(session, force = false) {
  if (!session) return;
  const settings = settingsStore.get();
  
  // Skip if feature is disabled and it's not a forced/auto-sync run
  if (!settings.genai_smart_context && !force) return;

  const messages = (session.messages || []).filter(m => m.role !== 'system');
  if (messages.length === 0) {
    if (session.summary) {
      session.summary = '';
      genaiEmbeddingsStore.removeSession(session.id).catch(console.error);
      saveHistory();
      renderSmartContextChats();
    }
    return;
  }

  // Check if already summarizing this session
  if (activeSummarizations[session.id]) {
    return activeSummarizations[session.id];
  }

  const tokenLimit = settings.genai_smart_context_token_limit || 1500;
  const charLimit = tokenLimit * 4; // Approximated characters

  const promise = (async () => {
    try {
      console.log(`[Smart Context] Starting summary for session ${session.id}...`);
      renderSmartContextChats();

      // Step 1: Chunk messages by character length approximation
      const chunks = [];
      let currentChunk = [];
      let currentLength = 0;

      for (const msg of messages) {
        const msgLen = (msg.content || '').length;
        if (currentLength + msgLen > charLimit && currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = [];
          currentLength = 0;
        }
        currentChunk.push(msg);
        currentLength += msgLen;
      }
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }

      const summaries = [];

      // Step 2: Summarize each chunk sequentially
      for (let i = 0; i < chunks.length; i++) {
        const chunkMsgs = chunks[i];
        const textToSummarize = chunkMsgs.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n') + '\nEND OF THE CHUNK. MAKE SUMMARY NOW';
        
        const payload = [
          {
            role: 'system',
            content: "You are a summarization agent that writes extremely concise summaries of the conversation history. MANDATORY RULE 1: Write a brief summary of what happened in the conversation chunk (literally 50-100 words). MANDATORY RULE 2: The summary MUST ALWAYS be written strictly in English, regardless of the language used in the conversation. Return ONLY the summary in English, no other text. Do NOT continue chat or roleplay. You're writing SUMMARY."
          },
          {
            role: 'user',
            content: textToSummarize
          }
        ];

        const summary = await api.chatCompletion(payload, { 
          priority: 'background',
          temperature: 0.8,
          reasoning_effort: 'none'
        });
        
        if (summary && summary.trim().length > 0) {
          summaries.push(summary.trim());
        }
      }

      // Step 3: Combine summaries if we have multiple
      let finalSummary = '';
      if (summaries.length === 1) {
        finalSummary = summaries[0];
      } else if (summaries.length > 1) {
        const payload = [
          {
            role: 'system',
            content: "You are a summarization agent that writes comprehensive summaries of the conversation history. MANDATORY RULE 1: Merge multiple conversation summaries into one coherent, comprehensive summary (recommended length: 300-400 words). MANDATORY RULE 2: The summary MUST ALWAYS be written strictly in English, regardless of the language used in the conversation. Return ONLY the summary in English, no other text. Do NOT continue chat or roleplay. You're writing SUMMARY."
          },
          {
            role: 'user',
            content: summaries.join('\n\n')
          }
        ];
        
        const combined = await api.chatCompletion(payload, {
          priority: 'background',
          temperature: 0.8,
          reasoning_effort: 'none'
        });
        
        finalSummary = combined ? combined.trim() : '';
      }

      // Save summary and all intermediate chunks to session
      session.summary = finalSummary;
      session.summary_chunks = summaries;
      saveHistory();
      
      // Save all summary chunks (both intermediate and final) to the embeddings RAG store
      const allChunksToIndex = summaries.length > 1 && finalSummary ? [...summaries, finalSummary] : summaries;
      if (allChunksToIndex.length > 0) {
        await genaiEmbeddingsStore.saveSessionChunks(session.id, allChunksToIndex);
      } else {
        await genaiEmbeddingsStore.removeSession(session.id);
      }
      
      console.log(`[Smart Context] Summary completed for session ${session.id}.`);
    } catch (err) {
      console.error(`[Smart Context] Failed to summarize session ${session.id}:`, err);
    } finally {
      delete activeSummarizations[session.id];
      renderSmartContextChats();
    }
  })();

  activeSummarizations[session.id] = promise;
  return promise;
}

// Inactivity timer scheduler
export function scheduleSmartContextAutoUpdate(sessionId) {
  if (autoUpdateTimers[sessionId]) {
    clearTimeout(autoUpdateTimers[sessionId]);
  }

  const settings = settingsStore.get();
  if (!settings.genai_smart_context) return;

  autoUpdateTimers[sessionId] = setTimeout(() => {
    const sessions = getGenaiSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      updateSessionSummaryIfNeeded(session);
    }
    delete autoUpdateTimers[sessionId];
  }, 60000); // 60 seconds
}

// Auto Sync for recent 15 chats
async function runAutoSync() {
  if (isSyncRunning) return;
  
  const btn = document.getElementById('btn-smart-context-autosync');
  const initialText = btn ? btn.innerHTML : 'Auto Sync (15 Chats)';
  
  try {
    isSyncRunning = true;
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.7';
    }

    const sessions = getGenaiSessions() || [];
    const recent15 = sessions.slice(0, 15);

    for (let i = 0; i < recent15.length; i++) {
      const session = recent15[i];
      if (btn) {
        btn.innerHTML = `Syncing (${i + 1}/${recent15.length})...`;
      }
      
      // Force summarize even if the setting is currently disabled globally
      await updateSessionSummaryIfNeeded(session, true);
    }

    showToast('Smart Context auto-sync completed');
  } catch (err) {
    console.error('[Smart Context] Auto-sync failed:', err);
    showToast('Smart Context auto-sync failed', 'error');
  } finally {
    isSyncRunning = false;
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.innerHTML = initialText;
    }
    renderSmartContextChats();
  }
}

// Clean up helper when chat is switched
export function handleChatSwitched(previousSessionId) {
  // Clear any active timer on the previous session
  if (autoUpdateTimers[previousSessionId]) {
    clearTimeout(autoUpdateTimers[previousSessionId]);
    delete autoUpdateTimers[previousSessionId];
  }
}

// Getter/setter for the bypass check flag
export function getAndResetProceedOverride() {
  const val = isProceedingOverride;
  isProceedingOverride = false;
  return val;
}

window.updateSessionSummary = (session) => updateSessionSummaryIfNeeded(session, true);
