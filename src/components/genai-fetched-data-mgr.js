/* ════════════════════════════════════════════════════════════════════
   GenAI Fetched Data Manager — View and prune fetched web content
   ════════════════════════════════════════════════════════════════════ */

import { getGenaiHistory, saveHistory, renderMessages } from './genai-panel.js';
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
}

function getFetchedDataList() {
  const history = getGenaiHistory();
  const list = [];

  history.forEach((msg, msgIdx) => {
    if (msg.role === 'assistant' && Array.isArray(msg.tools)) {
      msg.tools.forEach((tool, toolIdx) => {
        const action = tool.action || {};
        const name = action.genai_action;
        if (tool.state === 'done' && (name === 'web_search' || name === 'web_fetch')) {
          let size = 0;
          let label = '';
          let isCleared = false;
          
          if (name === 'web_search') {
            const resultsStr = typeof tool.result?.results === 'string' ? tool.result.results : JSON.stringify(tool.result?.results || '');
            size = resultsStr.length;
            label = `Web Search: "${action.query || 'unknown'}"`;
            isCleared = resultsStr === "Cleared by user." || resultsStr.includes("Cleared by user");
          } else {
            const contentStr = typeof tool.result?.content === 'string' ? tool.result.content : JSON.stringify(tool.result?.content || '');
            size = contentStr.length;
            label = `Web Fetch: "${action.url || 'unknown'}"`;
            isCleared = contentStr === "Cleared by user." || contentStr.includes("Cleared by user");
          }

          list.push({
            msgIdx,
            toolIdx,
            name,
            label,
            size,
            isCleared,
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

  if (dataList.length === 0) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--space-6) 0; color: var(--text-tertiary); text-align: center; gap: 8px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 32px; height: 32px; color: var(--text-tertiary); opacity: 0.6;">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
          <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
        <div style="font-size: var(--text-sm); font-weight: 500;">No fetched data found</div>
        <div style="font-size: var(--text-xs); opacity: 0.8; max-width: 280px;">Scraped website content or search results will be listed here after successful tool execution.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = dataList.map(entry => {
    const sizeBadge = entry.isCleared
      ? `<span class="memory-entry-category" style="background: rgba(255, 255, 255, 0.05); color: var(--text-tertiary); border: 1px solid var(--border-light);">0 bytes (Cleared)</span>`
      : `<span class="memory-entry-category" style="background: rgba(99, 102, 241, 0.1); color: var(--text-accent); border: 1px solid rgba(99, 102, 241, 0.2);">${entry.size.toLocaleString()} chars</span>`;

    return `
      <div class="memory-entry" style="align-items: center; justify-content: space-between;">
        <div class="memory-entry-icon" style="font-size: 16px; margin-top: 0;">🌐</div>
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

  // Attach event handlers to delete buttons
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
}

function clearFetchedData(msgIdx, toolIdx) {
  const history = getGenaiHistory();
  const msg = history[msgIdx];
  if (msg && Array.isArray(msg.tools)) {
    const tool = msg.tools[toolIdx];
    if (tool && tool.result) {
      if (tool.action.genai_action === 'web_search') {
        tool.result.results = "Cleared by user.";
      } else if (tool.action.genai_action === 'web_fetch') {
        tool.result.content = "Cleared by user.";
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
  const uncleared = dataList.filter(d => !d.isCleared);
  if (uncleared.length === 0) {
    showToast('All fetched data is already cleared', 'error');
    return;
  }

  const confirmed = await showConfirm(
    'Clear All Fetched Data',
    `Are you sure you want to clear all ${uncleared.length} fetched web results? This will drastically reduce context usage.`
  );

  if (confirmed) {
    const history = getGenaiHistory();
    let clearedCount = 0;
    
    history.forEach(msg => {
      if (msg.role === 'assistant' && Array.isArray(msg.tools)) {
        msg.tools.forEach(tool => {
          const name = tool.action?.genai_action;
          if (tool.state === 'done' && (name === 'web_search' || name === 'web_fetch') && tool.result) {
            if (name === 'web_search' && tool.result.results !== "Cleared by user.") {
              tool.result.results = "Cleared by user.";
              clearedCount++;
            } else if (name === 'web_fetch' && tool.result.content !== "Cleared by user.") {
              tool.result.content = "Cleared by user.";
              clearedCount++;
            }
          }
        });
      }
    });

    if (clearedCount > 0) {
      saveHistory();
      renderMessages();
      renderFetchedData();
      showToast(`Cleared ${clearedCount} web data entries from context`);
    }
  }
}
