/* ════════════════════════════════════════════════════════════════════
   GenAI Fetched Data Manager — View and prune fetched web content & images
   ════════════════════════════════════════════════════════════════════ */

import { getGenaiHistory, saveHistory, renderMessages, getCurrentGenaiSession } from './genai-panel.js';
import { showToast, showConfirm, openWindow, closeWindow } from '../main.js';
import { escapeHtml } from '../utils/helpers.js';

export function initGenAIFetchedDataMgr() {
  const btnOpen = document.getElementById('btn-genai-fetched-data');
  const btnClose = document.getElementById('btn-close-genai-fetched-data');
  const modal = document.getElementById('modal-genai-fetched-data');
  const backdrop = modal ? modal.querySelector('.modal-backdrop') : null;
  const btnClearAll = document.getElementById('btn-clear-all-genai-fetched-data');

  if (!modal) {
    console.error('modal-genai-fetched-data element not found');
    return;
  }

  // Open modal
  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      openWindow(modal);
      renderFetchedData();
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

  // Clear all
  if (btnClearAll) {
    btnClearAll.addEventListener('click', clearAllFetchedData);
  }

  // Update button visibility on startup
  updateFetchedDataButtonVisibility();
}

export function updateFetchedDataButtonVisibility() {
  const btnOpen = document.getElementById('btn-genai-fetched-data');
  if (!btnOpen) return;
  const dataList = getFetchedDataList();
  if (dataList.length > 0) {
    btnOpen.classList.add('visible');
  } else {
    btnOpen.classList.remove('visible');
  }
}

window.updateFetchedDataButtonVisibility = updateFetchedDataButtonVisibility;
window.renderFetchedData = renderFetchedData;

function getFetchedDataList() {
  const history = getGenaiHistory();
  const list = [];

  // Add uploaded images from current session
  const session = getCurrentGenaiSession();
  if (session && Array.isArray(session.uploadedImages)) {
    session.uploadedImages.forEach((img) => {
      list.push({
        isUploadedImage: true,
        imgId: img.id,
        label: img.name,
        size: img.base64.length,
        enabled: img.enabled,
        base64: img.base64,
        timestamp: img.timestamp || new Date().toISOString()
      });
    });
  }

  history.forEach((msg, msgIdx) => {
    if (msg.role === 'assistant' && Array.isArray(msg.tools)) {
      msg.tools.forEach((tool, toolIdx) => {
        const action = tool.action || {};
        const name = action.genai_action;
        if (tool.state === 'done' && (name === 'web_search' || name === 'web_fetch' || name === 'gethistory' || name === 'get_chat_history' || name === 'get_group_chat_history')) {
          let size = 0;
          let label = '';
          let isCleared = false;
          let extraInfo = '';
          
          if (name === 'web_search') {
            const resultsStr = typeof tool.result?.results === 'string' ? tool.result.results : JSON.stringify(tool.result?.results || '');
            size = resultsStr.length;
            label = `Web Search: "${action.query || 'unknown'}"`;
            isCleared = resultsStr === "Cleared by user." || resultsStr.includes("Cleared by user");
          } else if (name === 'web_fetch') {
            const contentStr = typeof tool.result?.content === 'string' ? tool.result.content : JSON.stringify(tool.result?.content || '');
            size = contentStr.length;
            label = `Web Fetch: "${action.url || 'unknown'}"`;
            isCleared = contentStr === "Cleared by user." || contentStr.includes("Cleared by user");
          } else {
            const isHistory = tool.result?.history !== undefined;
            const isMessages = tool.result?.messages !== undefined;
            const historyStr = isHistory ? (typeof tool.result.history === 'string' ? tool.result.history : JSON.stringify(tool.result.history)) 
                              : (isMessages ? JSON.stringify(tool.result.messages) : '');
            
            size = historyStr.length;
            label = name === 'gethistory' ? 'Chat History (Context)' : 'Chat History (Specific)';
            isCleared = historyStr.includes("user deleted the context");
            
            const tokensApprox = Math.round(size / 3);
            const msgCount = tool.result?.messages_count || tool.result?.message_count || 0;
            extraInfo = `${msgCount} messages (~${tokensApprox} tokens)`;
          }

          list.push({
            msgIdx,
            toolIdx,
            name,
            label,
            size,
            isCleared,
            extraInfo,
            timestamp: msg.timestamp || new Date().toISOString()
          });
        }
      });
    }
  });

  return list;
}

export function renderFetchedData() {
  const container = document.getElementById('genai-fetched-data-list-container');
  const countEl = document.getElementById('genai-fetched-data-count');
  if (!container) return;

  const dataList = getFetchedDataList();

  if (countEl) {
    countEl.textContent = dataList.length;
  }

  // Keep button in sync
  updateFetchedDataButtonVisibility();

  if (dataList.length === 0) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--space-6) 0; color: var(--text-tertiary); text-align: center; gap: 8px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 32px; height: 32px; color: var(--text-tertiary); opacity: 0.6;">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
          <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
        <div style="font-size: var(--text-sm); font-weight: 500;">No fetched data found</div>
        <div style="font-size: var(--text-xs); opacity: 0.8; max-width: 280px;">Scraped website content, search results or uploaded images will be listed here.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = dataList.map(entry => {
    if (entry.isUploadedImage) {
      const activeText = entry.enabled ? 'Enabled' : 'Disabled';
      const sizeBadge = `<span class="memory-entry-category" style="background: rgba(167, 139, 250, 0.1); color: #38bdf8; border: 1px solid rgba(167, 139, 250, 0.2);">${(entry.size / 1024).toFixed(1)} KB (${activeText})</span>`;
      return `
        <div class="memory-entry" style="align-items: center; justify-content: space-between;">
          <div class="memory-entry-icon" style="font-size: 16px; margin-top: 0; cursor: pointer; display: flex; align-items: center;" onclick="if(window.openLightbox){window.openLightbox('${entry.base64}')}else{window.open('${entry.base64}','_blank')}">
            <img src="${entry.base64}" style="width: 24px; height: 24px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-light);" />
          </div>
          <div class="memory-entry-body" style="overflow: hidden; padding-right: 8px;">
            <div class="memory-entry-content" style="font-weight: 500; font-size: var(--text-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(entry.label)}">
              ${escapeHtml(entry.label)}
            </div>
            <div class="memory-entry-meta" style="margin-top: 4px; display: flex; align-items: center; gap: 8px;">
              ${sizeBadge}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px; margin-left: auto;">
            <label class="toggle-switch small" title="Toggle image usage in LLM context" style="margin: 0; display: flex;">
              <input type="checkbox" class="toggle-fetched-image" data-is-draft="${entry.isDraft}" data-msg-idx="${entry.msgIdx !== undefined ? entry.msgIdx : ''}" data-img-idx="${entry.imgIdx !== undefined ? entry.imgIdx : ''}" data-img-id="${entry.imgId}" ${entry.enabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
            <button class="memory-entry-delete btn-delete-fetched-image" data-is-draft="${entry.isDraft}" data-msg-idx="${entry.msgIdx !== undefined ? entry.msgIdx : ''}" data-img-idx="${entry.imgIdx !== undefined ? entry.imgIdx : ''}" data-img-id="${entry.imgId}" title="Delete this image" style="opacity: 0.8; margin-left: 0; padding: 0; background: transparent; border: none; cursor: pointer; color: var(--text-tertiary);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      `;
    }

    let sizeBadge = '';
    if (entry.isCleared) {
      sizeBadge = `<span class="memory-entry-category" style="background: rgba(255, 255, 255, 0.05); color: var(--text-tertiary); border: 1px solid var(--border-light);">Cleared</span>`;
    } else {
      if (entry.extraInfo) {
        sizeBadge = `<span class="memory-entry-category" style="background: rgba(14, 165, 233, 0.1); color: var(--text-accent); border: 1px solid rgba(14, 165, 233, 0.2);">${escapeHtml(entry.extraInfo)}</span>`;
      } else {
        sizeBadge = `<span class="memory-entry-category" style="background: rgba(14, 165, 233, 0.1); color: var(--text-accent); border: 1px solid rgba(14, 165, 233, 0.2);">${entry.size.toLocaleString()} chars</span>`;
      }
    }

    const iconStr = (entry.name === 'gethistory' || entry.name === 'get_chat_history' || entry.name === 'get_group_chat_history') ? '💬' : '🌐';

    return `
      <div class="memory-entry" style="align-items: center; justify-content: space-between;">
        <div class="memory-entry-icon" style="font-size: 16px; margin-top: 0;">${iconStr}</div>
        <div class="memory-entry-body" style="overflow: hidden; padding-right: 8px;">
          <div class="memory-entry-content" style="font-weight: 500; font-size: var(--text-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(entry.label)}">
            ${escapeHtml(entry.label)}
          </div>
          <div class="memory-entry-meta" style="margin-top: 4px; display: flex; align-items: center; gap: 8px;">
            ${sizeBadge}
          </div>
        </div>
        <button class="memory-entry-delete btn-delete-fetched-data" data-msg-idx="${entry.msgIdx}" data-tool-idx="${entry.toolIdx}" title="Clear this data" style="opacity: 0.8; margin-left: 8px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;
  }).join('');

  // Attach event handlers
  container.querySelectorAll('.btn-delete-fetched-data').forEach(btn => {
    btn.addEventListener('click', async () => {
      const msgIdx = parseInt(btn.dataset.msgIdx, 10);
      const toolIdx = parseInt(btn.dataset.toolIdx, 10);
      const confirmed = await showConfirm(
        'Clear Fetched Data',
        'Are you sure you want to clear this web content? The model will know it succeeded, but its heavy text will be pruned from context.'
      );
      if (confirmed) {
        clearFetchedData(msgIdx, toolIdx);
      }
    });
  });

  container.querySelectorAll('.btn-delete-fetched-image').forEach(btn => {
    btn.addEventListener('click', () => {
      const imgId = btn.dataset.imgId;
      const isDraft = btn.dataset.isDraft === 'true';
      if (isDraft) {
        if (window.deleteUploadedImage) {
          window.deleteUploadedImage(imgId);
        }
      } else {
        const msgIdx = parseInt(btn.dataset.msgIdx, 10);
        const imgIdx = parseInt(btn.dataset.imgIdx, 10);
        const history = getGenaiHistory();
        const msg = history[msgIdx];
        if (msg && Array.isArray(msg.images)) {
          msg.images.splice(imgIdx, 1);
          if (msg.images.length === 0) delete msg.images;
          saveHistory();
          renderMessages();
          renderFetchedData();
          if (window.updateFetchedDataButtonVisibility) {
            window.updateFetchedDataButtonVisibility();
          }
          showToast('Sent image deleted from history');
        }
      }
    });
  });

  container.querySelectorAll('.toggle-fetched-image').forEach(toggle => {
    toggle.addEventListener('change', () => {
      const imgId = toggle.dataset.imgId;
      const enabled = toggle.checked;
      const isDraft = toggle.dataset.isDraft === 'true';

      if (isDraft) {
        const session = getCurrentGenaiSession();
        if (session && Array.isArray(session.uploadedImages)) {
          const img = session.uploadedImages.find(i => i.id === imgId);
          if (img) {
            img.enabled = enabled;
            saveHistory();
            if (window.updateGenAIImagePreviews) {
              window.updateGenAIImagePreviews();
            }
            renderFetchedData();
            showToast(enabled ? 'Image enabled for AI context' : 'Image disabled for AI context');
          }
        }
      } else {
        const msgIdx = parseInt(toggle.dataset.msgIdx, 10);
        const imgIdx = parseInt(toggle.dataset.imgIdx, 10);
        const history = getGenaiHistory();
        const msg = history[msgIdx];
        if (msg && Array.isArray(msg.images)) {
          let img = msg.images[imgIdx];
          if (typeof img === 'string') {
            img = {
              id: imgId,
              name: `Sent Image ${imgIdx + 1}`,
              base64: img,
              enabled: enabled
            };
            msg.images[imgIdx] = img;
          } else if (typeof img === 'object' && img !== null) {
            img.enabled = enabled;
          }
          saveHistory();
          renderFetchedData();
          showToast(enabled ? 'Sent image enabled in history' : 'Sent image disabled in history');
        }
      }
    });
  });
}

function clearFetchedData(msgIdx, toolIdx) {
  const history = getGenaiHistory();
  const msg = history[msgIdx];
  if (msg && Array.isArray(msg.tools)) {
    const tool = msg.tools[toolIdx];
    if (tool && tool.result) {
      const actionName = tool.action.genai_action;
      if (actionName === 'web_search') {
        tool.result.results = "Cleared by user.";
      } else if (actionName === 'web_fetch') {
        tool.result.content = "Cleared by user.";
      } else if (actionName === 'gethistory' || actionName === 'get_chat_history' || actionName === 'get_group_chat_history') {
        if (tool.result.history !== undefined) {
          tool.result.history = "[user deleted the context for token saving purposes.]";
          delete tool.result.summary;
        } else if (tool.result.messages !== undefined) {
          tool.result.messages = "[user deleted the context for token saving purposes.]";
        }
      }
      saveHistory();
      renderMessages();
      renderFetchedData();
      showToast('Fetched web data cleared from context');
    }
  }
}

async function clearAllFetchedData() {
  const dataList = getFetchedDataList();
  const unclearedWeb = dataList.filter(d => !d.isUploadedImage && !d.isCleared);
  const uploadedImages = dataList.filter(d => d.isUploadedImage);

  if (unclearedWeb.length === 0 && uploadedImages.length === 0) {
    showToast('All fetched data is already cleared', 'error');
    return;
  }

  const confirmed = await showConfirm(
    'Clear All Fetched Data',
    `Are you sure you want to clear all fetched web results and uploaded images? This will drastically reduce context usage.`
  );

  if (confirmed) {
    const history = getGenaiHistory();
    let clearedCount = 0;
    
    history.forEach(msg => {
      if (msg.role === 'assistant' && Array.isArray(msg.tools)) {
        msg.tools.forEach(tool => {
          const name = tool.action?.genai_action;
          if (tool.state === 'done' && (name === 'web_search' || name === 'web_fetch' || name === 'gethistory' || name === 'get_chat_history' || name === 'get_group_chat_history') && tool.result) {
            if (name === 'web_search' && tool.result.results !== "Cleared by user.") {
              tool.result.results = "Cleared by user.";
              clearedCount++;
            } else if (name === 'web_fetch' && tool.result.content !== "Cleared by user.") {
              tool.result.content = "Cleared by user.";
              clearedCount++;
            } else if (name === 'gethistory' || name === 'get_chat_history' || name === 'get_group_chat_history') {
              if (tool.result.history !== undefined && tool.result.history !== "[user deleted the context for token saving purposes.]") {
                tool.result.history = "[user deleted the context for token saving purposes.]";
                delete tool.result.summary;
                clearedCount++;
              } else if (tool.result.messages !== undefined && tool.result.messages !== "[user deleted the context for token saving purposes.]") {
                tool.result.messages = "[user deleted the context for token saving purposes.]";
                clearedCount++;
              }
            }
          }
        });
      }
    });

    const session = getCurrentGenaiSession();
    if (session && Array.isArray(session.uploadedImages) && session.uploadedImages.length > 0) {
      clearedCount += session.uploadedImages.length;
      session.uploadedImages = [];
    }

    if (clearedCount > 0) {
      saveHistory();
      renderMessages();
      renderFetchedData();
      if (window.updateGenAIImagePreviews) {
        window.updateGenAIImagePreviews();
      }
      if (window.updateFetchedDataButtonVisibility) {
        window.updateFetchedDataButtonVisibility();
      }
      showToast(`Cleared ${clearedCount} fetched data entries from context`);
    }
  }
}
