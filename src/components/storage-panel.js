/* ════════════════════════════════════════════════════════════════════
   Storage Panel — Advanced Storage Stats and Interactive Cleanup
   ════════════════════════════════════════════════════════════════════ */

import { chatStore } from '../services/chat-store.js';
import { characterStore } from '../services/character-store.js';

let cleanupList = [];
let filteredCategory = null;

export function initStorageSettings() {
  const modal = document.getElementById('modal-settings-storage');
  if (!modal) return;

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        if (!modal.classList.contains('hidden')) {
          refreshStorageStats();
        }
      }
    });
  });
  
  observer.observe(modal, { attributes: true });

  const btnCleanup = document.getElementById('btn-storage-cleanup');
  if (btnCleanup) {
    btnCleanup.addEventListener('click', async () => {
      await applySmartCleanup();
    });
  }

  // Setup Toolbar
  document.getElementById('btn-storage-select-all')?.addEventListener('click', (e) => {
    e.preventDefault();
    cleanupList.forEach(item => {
      if (!filteredCategory || item.category === filteredCategory) item.selected = true;
    });
    renderCleanupList();
  });
  
  document.getElementById('btn-storage-deselect-all')?.addEventListener('click', (e) => {
    e.preventDefault();
    cleanupList.forEach(item => {
      if (!filteredCategory || item.category === filteredCategory) item.selected = false;
    });
    renderCleanupList();
  });

  document.getElementById('storage-sort-select')?.addEventListener('change', () => {
    renderCleanupList();
  });

  // Setup Diagram & Legend Filtering
  const setupFilter = (el) => {
    el.addEventListener('click', (e) => {
      let target = e.target;
      while(target && target !== el) {
        if (target.dataset.category) {
          if (filteredCategory === target.dataset.category) {
            filteredCategory = null; // toggle off
            document.getElementById('storage-filter-indicator').style.display = 'none';
          } else {
            filteredCategory = target.dataset.category;
            const indicator = document.getElementById('storage-filter-indicator');
            indicator.textContent = `Filtering: ${target.dataset.category}`;
            indicator.style.display = 'block';
          }
          renderCleanupList();
          break;
        }
        target = target.parentNode;
      }
    });
  };

  const chartBar = document.getElementById('storage-chart-bar');
  const legend = document.getElementById('storage-legend');
  if (chartBar) setupFilter(chartBar);
  if (legend) setupFilter(legend);
}

const formatBytes = (bytes) => {
  if (bytes === 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return (bytes / 1024).toFixed(1) + ' KB';
  if (mb >= 1000) return (mb / 1024).toFixed(2) + ' GB';
  return mb.toFixed(2) + ' MB';
};

async function getImageSize(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const size = parseInt(res.headers.get('content-length') || 0);
    return size > 0 ? size : 1500000; // default 1.5MB if missing header
  } catch (e) {
    return 1500000; // fallback if cors fails
  }
}

async function refreshStorageStats() {
  const listEl = document.getElementById('storage-cleanup-list');
  listEl.innerHTML = '<div id="storage-cleanup-stats" style="font-size: 0.85rem; font-weight: 500; color: var(--text-tertiary); text-align: center; padding: 20px 0;">Scanning...</div>';
  document.getElementById('storage-toolbar').style.display = 'none';
  document.getElementById('btn-storage-cleanup').style.display = 'none';
  
  let charsSize = 0;
  let chatsSize = 0;
  let genaiSize = 0;
  let avatarsSize = 0;
  let generatedImagesSize = 0;
  
  cleanupList = [];
  const now = new Date().getTime();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const imgRegex = /!\[.*?\]\(([^)]+)\)/g;

  // 1. Characters
  // We use characterStore which mirrors Tauri's truth
  const characters = characterStore.getAll();
  charsSize = new Blob([JSON.stringify(characters)]).size;

  // 2. Chats & Chat Images
  for (const char of characters) {
    const sessions = await chatStore.loadForCharacter(char.id);
    if (!sessions) continue;
    
    chatsSize += new Blob([JSON.stringify(sessions)]).size;

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      const isOldSession = i > 0 && (now - new Date(session.updated_at || session.created_at || 0).getTime() > threeDaysMs);
      
      if (isOldSession) {
        cleanupList.push({
          id: `chat-${session.id}`,
          type: 'chat',
          category: 'chats',
          charId: char.id,
          chatId: session.id,
          title: session.custom_title || `Chat with ${char.name}`,
          date: new Date(session.updated_at || session.created_at).toLocaleDateString(),
          size: new Blob([JSON.stringify(session)]).size,
          selected: false,
          rawTimestamp: new Date(session.updated_at || session.created_at || 0).getTime()
        });
      }

      // Check for images
      for (const msg of session.messages) {
        const text = msg.original_text || msg.content || '';
        let match;
        while ((match = imgRegex.exec(text)) !== null) {
          const url = match[1];
          const size = await getImageSize(url);
          generatedImagesSize += size;
          
          const msgTime = new Date(msg.timestamp || 0).getTime();
          if (now - msgTime > threeDaysMs) {
            cleanupList.push({
              id: `img-${msg.id}-${Math.random()}`,
              type: 'image',
              category: 'images',
              charId: char.id,
              chatId: session.id,
              msgId: msg.id,
              url: url,
              title: `Generated Image with ${char.name}`,
              date: new Date(msg.timestamp).toLocaleDateString(),
              size: size,
              selected: false,
              rawTimestamp: msgTime
            });
          }
        }
      }
    }
  }

  // 3. GenAI
  const genaiStr = localStorage.getItem('vibechat_genai_sessions') || '[]';
  genaiSize += new Blob([genaiStr]).size;
  try {
    const genaiSessions = JSON.parse(genaiStr);
    for (const session of genaiSessions) {
      for (const msg of session.messages) {
        const text = msg.content || '';
        let match;
        while ((match = imgRegex.exec(text)) !== null) {
          const url = match[1];
          const size = await getImageSize(url);
          generatedImagesSize += size;
          
          const msgTime = new Date(msg.timestamp || 0).getTime();
          if (now - msgTime > threeDaysMs) {
            cleanupList.push({
              id: `gimg-${msg.id}-${Math.random()}`,
              type: 'image',
              category: 'images',
              isGenAi: true,
              sessionId: session.id,
              msgId: msg.id,
              url: url,
              title: `Generated Image (GenAI)`,
              date: new Date(msg.timestamp).toLocaleDateString(),
              size: size,
              selected: false,
              rawTimestamp: msgTime
            });
          }
        }
      }
    }
  } catch(e){}

  const imagesSize = generatedImagesSize;
  const totalSize = charsSize + chatsSize + genaiSize + imagesSize;
  
  // UI Updates
  document.getElementById('storage-total-size').textContent = formatBytes(totalSize);
  document.getElementById('storage-val-chars').textContent = formatBytes(charsSize);
  document.getElementById('storage-val-chats').textContent = formatBytes(chatsSize);
  document.getElementById('storage-val-genai').textContent = formatBytes(genaiSize);
  document.getElementById('storage-val-images').textContent = formatBytes(imagesSize);

  const safePct = (val) => totalSize > 0 ? (val / totalSize) * 100 : 0;
  document.getElementById('storage-bar-chars').style.width = `${safePct(charsSize)}%`;
  document.getElementById('storage-bar-chats').style.width = `${safePct(chatsSize)}%`;
  document.getElementById('storage-bar-genai').style.width = `${safePct(genaiSize)}%`;
  document.getElementById('storage-bar-images').style.width = `${safePct(imagesSize)}%`;

  renderCleanupList();
}

function renderCleanupList() {
  const listEl = document.getElementById('storage-cleanup-list');
  const toolbar = document.getElementById('storage-toolbar');
  const btnCleanup = document.getElementById('btn-storage-cleanup');
  const statsEl = document.getElementById('storage-selected-stats');

  listEl.innerHTML = '';

  const displayList = filteredCategory 
    ? cleanupList.filter(item => item.category === filteredCategory)
    : [...cleanupList];

  const sortEl = document.getElementById('storage-sort-select');
  if (sortEl) {
    if (sortEl.value === 'size') {
      displayList.sort((a, b) => b.size - a.size);
    } else if (sortEl.value === 'date') {
      displayList.sort((a, b) => a.rawTimestamp - b.rawTimestamp);
    }
  }

  if (displayList.length === 0) {
    toolbar.style.display = 'none';
    btnCleanup.style.display = 'none';
    listEl.innerHTML = `<div style="font-size: 0.85rem; color: var(--text-secondary); text-align: center; padding: 20px 0;">No items found ${filteredCategory ? 'for this category' : ''}.</div>`;
    return;
  }

  toolbar.style.display = 'flex';
  btnCleanup.style.display = 'block';

  let selectedCount = 0;
  let selectedSize = 0;

  displayList.forEach((item, index) => {
    if (item.selected) {
      selectedCount++;
      selectedSize += item.size;
    }

    const itemEl = document.createElement('div');
    itemEl.style.display = 'flex';
    itemEl.style.alignItems = 'center';
    itemEl.style.gap = '12px';
    itemEl.style.padding = '8px';
    itemEl.style.background = 'var(--bg-secondary)';
    itemEl.style.borderRadius = '6px';
    itemEl.style.cursor = 'pointer';

    // Checkbox
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = item.selected;
    cb.style.cursor = 'pointer';
    
    // Thumbnail if image
    let thumbHtml = '';
    if (item.type === 'image') {
      thumbHtml = `<img src="${item.url}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 4px; background: #000;" />`;
    } else {
      thumbHtml = `<div style="width: 40px; height: 40px; border-radius: 4px; background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center; color: var(--text-secondary);"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></div>`;
    }

    itemEl.innerHTML = `
      <div style="display: flex; align-items: center;"></div>
      ${thumbHtml}
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 0.85rem; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.title}</div>
        <div style="font-size: 0.75rem; color: var(--text-secondary);">${item.date} • ${formatBytes(item.size)}</div>
      </div>
    `;
    itemEl.firstElementChild.appendChild(cb);

    itemEl.addEventListener('click', (e) => {
      if (e.target !== cb) cb.checked = !cb.checked;
      item.selected = cb.checked;
      renderCleanupList();
    });

    listEl.appendChild(itemEl);
  });

  statsEl.textContent = `${selectedCount} selected (${formatBytes(selectedSize)})`;
  btnCleanup.disabled = selectedCount === 0;
  btnCleanup.textContent = selectedCount > 0 ? `Delete Selected (${formatBytes(selectedSize)})` : 'Select items to delete';
  if(selectedCount === 0) btnCleanup.style.background = 'var(--bg-tertiary)';
  else btnCleanup.style.background = 'var(--warning)';
}

async function applySmartCleanup() {
  const toDelete = cleanupList.filter(item => item.selected);
  if (toDelete.length === 0) return;
  
  const confirmDel = confirm(`Permanently delete ${toDelete.length} selected items?`);
  if (!confirmDel) return;

  const btn = document.getElementById('btn-storage-cleanup');
  btn.textContent = 'Cleaning...';
  btn.disabled = true;

  try {
    for (const item of toDelete) {
      if (item.type === 'chat') {
        await chatStore.deleteSession(item.charId, item.chatId);
      } else if (item.type === 'image') {
        if (item.isGenAi) {
           // We'll mutate localStorage directly for GenAI
           try {
             const str = localStorage.getItem('vibechat_genai_sessions');
             if(str) {
               let sessions = JSON.parse(str);
               let s = sessions.find(x => x.id === item.sessionId);
               if (s) {
                 let m = s.messages.find(x => x.id === item.msgId);
                 if (m) {
                   m.content = m.content.replace(`![${item.title}](${item.url})`, '').replace(`![](${item.url})`, '');
                   // Also clean regex precisely
                   const preciseRegex = new RegExp(`!\\[.*?\\]\\(${item.url.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\\\$&')}\\)`, 'g');
                   m.content = m.content.replace(preciseRegex, '');
                 }
               }
               localStorage.setItem('vibechat_genai_sessions', JSON.stringify(sessions));
             }
           }catch(e){}
        } else {
           // Character Chat image
           const sessions = await chatStore.loadForCharacter(item.charId);
           const s = sessions.find(x => x.id === item.chatId);
           if (s) {
             const m = s.messages.find(x => x.id === item.msgId);
             if (m) {
                const preciseRegex = new RegExp(`!\\[.*?\\]\\(${item.url.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\\\$&')}\\)`, 'g');
                if (m.original_text) m.original_text = m.original_text.replace(preciseRegex, '');
                if (m.content) m.content = m.content.replace(preciseRegex, '');
                await chatStore.saveSession(s);
             }
           }
        }
      }
    }
    await refreshStorageStats();
  } catch (err) {
    console.error('Failed to cleanup items:', err);
    alert('An error occurred during cleanup.');
  } finally {
    btn.textContent = 'Clean Up';
    btn.disabled = false;
  }
}
