/* ════════════════════════════════════════════════════════════════════
   Storage Panel — Advanced Storage Stats and Interactive Cleanup
   ════════════════════════════════════════════════════════════════════ */

import { chatStore } from '../services/chat-store.js';
import { characterStore } from '../services/character-store.js';
import { showToast } from '../main.js';

let cleanupList = [];
let activeCategory = 'all'; // 'all', 'chars', 'chats', 'genai', 'images'
let searchQuery = '';

export function initStorageSettings() {
  const modal = document.getElementById('modal-settings-storage');
  if (!modal) return;

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        if (!modal.classList.contains('hidden')) {
          activeCategory = 'all';
          searchQuery = '';
          const searchInput = document.getElementById('storage-search-input');
          if (searchInput) searchInput.value = '';
          
          updateTabUI();
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
    const visibleList = getFilteredAndSortedList();
    visibleList.forEach(item => {
      item.selected = true;
    });
    renderCleanupList();
  });
  
  document.getElementById('btn-storage-deselect-all')?.addEventListener('click', (e) => {
    e.preventDefault();
    const visibleList = getFilteredAndSortedList();
    visibleList.forEach(item => {
      item.selected = false;
    });
    renderCleanupList();
  });

  document.getElementById('storage-sort-select')?.addEventListener('change', () => {
    renderCleanupList();
  });

  // Setup Live Search
  document.getElementById('storage-search-input')?.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderCleanupList();
  });

  // Setup Segmented Tabs
  const setupTabs = () => {
    const tabs = document.querySelectorAll('.storage-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        activeCategory = tab.dataset.category || 'all';
        updateTabUI();
        renderCleanupList();
      });
    });

    // Make interactive legends filter like tabs too!
    const legends = document.querySelectorAll('.storage-legend-item');
    legends.forEach(legend => {
      legend.addEventListener('click', () => {
        activeCategory = legend.dataset.category || 'all';
        updateTabUI();
        renderCleanupList();
      });
    });
  };

  setupTabs();
}

function updateTabUI() {
  const tabs = document.querySelectorAll('.storage-tab');
  tabs.forEach(tab => {
    if (tab.dataset.category === activeCategory) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  const legends = document.querySelectorAll('.storage-legend-item');
  legends.forEach(legend => {
    if (legend.dataset.category === activeCategory) {
      legend.style.borderColor = 'var(--text-accent)';
      legend.style.background = 'rgba(196, 181, 253, 0.15)';
    } else {
      legend.style.borderColor = 'var(--border-light)';
      legend.style.background = 'var(--bg-primary)';
    }
  });
}

const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 KB';
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return (bytes / 1024).toFixed(1) + ' KB';
  if (mb >= 1000) return (mb / 1024).toFixed(2) + ' GB';
  return mb.toFixed(2) + ' MB';
};

async function refreshStorageStats() {
  const listEl = document.getElementById('storage-cleanup-list');
  listEl.innerHTML = '<div id="storage-cleanup-stats" style="font-size: 0.85rem; font-weight: 500; color: var(--text-tertiary); text-align: center; padding: 40px 0;">Scanning application database...</div>';
  document.getElementById('btn-storage-cleanup').disabled = true;
  document.getElementById('btn-storage-cleanup').textContent = 'Select items to delete';
  
  let charsSize = 0;
  let chatsSize = 0;
  let genaiSize = 0;
  let imagesSize = 0;
  
  cleanupList = [];
  const now = new Date().getTime();
  const imgRegex = /!\[.*?\]\(([^)]+)\)/g;

  // 1. Scan Characters
  const characters = characterStore.getAll();
  for (const char of characters) {
    const charSize = new Blob([JSON.stringify(char)]).size;
    charsSize += charSize;

    cleanupList.push({
      id: `char-${char.id}`,
      type: 'character',
      category: 'chars',
      charId: char.id,
      title: char.name,
      description: char.description || 'No description',
      date: new Date(char.created_at || char.last_chat_at || now).toLocaleDateString(),
      size: charSize,
      avatar: char.avatar || '',
      selected: false,
      rawTimestamp: new Date(char.created_at || char.last_chat_at || 0).getTime()
    });
  }

  // 2. Scan Chats & Chat Images
  for (const char of characters) {
    const sessions = await chatStore.loadForCharacter(char.id);
    if (!sessions) continue;
    
    for (const session of sessions) {
      const sessionSize = new Blob([JSON.stringify(session)]).size;
      chatsSize += sessionSize;

      cleanupList.push({
        id: `chat-${session.id}`,
        type: 'chat',
        category: 'chats',
        charId: char.id,
        chatId: session.id,
        title: session.custom_title || `Chat with ${char.name}`,
        date: new Date(session.updated_at || session.created_at || now).toLocaleDateString(),
        size: sessionSize,
        avatar: char.avatar || '',
        selected: false,
        rawTimestamp: new Date(session.updated_at || session.created_at || 0).getTime(),
        messagesCount: session.messages ? session.messages.length : 0
      });

      // Parse Chat Images
      if (session.messages) {
        for (const msg of session.messages) {
          const text = msg.original_text || msg.content || '';
          let match;
          while ((match = imgRegex.exec(text)) !== null) {
            const url = match[1];
            
            // Fast Size Calculation
            let size = 1500000; // Estimated 1.5MB standard for ComfyUI hosted images
            if (url.startsWith('data:')) {
              const base64Str = url.split(',')[1] || '';
              size = Math.round(base64Str.length * 0.75) || 1500000;
            }
            imagesSize += size;
            
            const msgTime = new Date(msg.timestamp || session.updated_at || now).getTime();
            cleanupList.push({
              id: `img-${msg.id}-${url}`,
              type: 'image',
              category: 'images',
              charId: char.id,
              chatId: session.id,
              msgId: msg.id,
              url: url,
              title: `Illustration in chat with ${char.name}`,
              date: new Date(msg.timestamp || session.updated_at || now).toLocaleDateString(),
              size: size,
              selected: false,
              rawTimestamp: msgTime
            });
          }
        }
      }
    }
  }

  // 3. Scan GenAI Sessions & Images
  const genaiStr = localStorage.getItem('vibechat_genai_sessions') || '[]';
  try {
    const genaiSessions = JSON.parse(genaiStr);
    for (const session of genaiSessions) {
      const sessionSize = new Blob([JSON.stringify(session)]).size;
      genaiSize += sessionSize;

      cleanupList.push({
        id: `genai-${session.id}`,
        type: 'genai',
        category: 'genai',
        sessionId: session.id,
        title: session.title || 'GenAI Session',
        date: new Date(session.updated_at || now).toLocaleDateString(),
        size: sessionSize,
        selected: false,
        rawTimestamp: new Date(session.updated_at || 0).getTime(),
        messagesCount: session.messages ? session.messages.length : 0
      });

      // Parse GenAI Images
      if (session.messages) {
        for (const msg of session.messages) {
          const text = msg.content || '';
          let match;
          while ((match = imgRegex.exec(text)) !== null) {
            const url = match[1];
            
            // Fast Size Calculation
            let size = 1500000; 
            if (url.startsWith('data:')) {
              const base64Str = url.split(',')[1] || '';
              size = Math.round(base64Str.length * 0.75) || 1500000;
            }
            imagesSize += size;
            
            const msgTime = new Date(msg.timestamp || session.updated_at || now).getTime();
            cleanupList.push({
              id: `gimg-${msg.id}-${url}`,
              type: 'image',
              category: 'images',
              isGenAi: true,
              sessionId: session.id,
              msgId: msg.id,
              url: url,
              title: `Illustration in GenAI session`,
              date: new Date(msg.timestamp || session.updated_at || now).toLocaleDateString(),
              size: size,
              selected: false,
              rawTimestamp: msgTime
            });
          }
        }
      }
    }
  } catch(e){}

  const totalSize = charsSize + chatsSize + genaiSize + imagesSize;
  
  // UI Stats Updates
  document.getElementById('storage-total-size').textContent = formatBytes(totalSize);
  document.getElementById('storage-val-chars').textContent = formatBytes(charsSize);
  document.getElementById('storage-val-chats').textContent = formatBytes(chatsSize);
  document.getElementById('storage-val-genai').textContent = formatBytes(genaiSize);
  document.getElementById('storage-val-images').textContent = formatBytes(imagesSize);

  // Fill Progress bar
  const safePct = (val) => totalSize > 0 ? (val / totalSize) * 100 : 0;
  document.getElementById('storage-bar-chars').style.width = `${safePct(charsSize)}%`;
  document.getElementById('storage-bar-chats').style.width = `${safePct(chatsSize)}%`;
  document.getElementById('storage-bar-genai').style.width = `${safePct(genaiSize)}%`;
  document.getElementById('storage-bar-images').style.width = `${safePct(imagesSize)}%`;

  renderCleanupList();
}

function getFilteredAndSortedList() {
  // Category Filter
  let displayList = activeCategory === 'all' 
    ? cleanupList
    : cleanupList.filter(item => item.category === activeCategory);

  // Search filter
  if (searchQuery) {
    displayList = displayList.filter(item => {
      const titleMatch = item.title && item.title.toLowerCase().includes(searchQuery);
      const descMatch = item.description && item.description.toLowerCase().includes(searchQuery);
      const urlMatch = item.url && item.url.toLowerCase().includes(searchQuery);
      return titleMatch || descMatch || urlMatch;
    });
  }

  // Sorting
  const sortEl = document.getElementById('storage-sort-select');
  if (sortEl) {
    if (sortEl.value === 'size') {
      displayList.sort((a, b) => b.size - a.size);
    } else if (sortEl.value === 'date') {
      displayList.sort((a, b) => b.rawTimestamp - a.rawTimestamp);
    }
  }

  return displayList;
}

function renderCleanupList() {
  const listEl = document.getElementById('storage-cleanup-list');
  const btnCleanup = document.getElementById('btn-storage-cleanup');
  const statsEl = document.getElementById('storage-selected-stats');

  listEl.innerHTML = '';

  const displayList = getFilteredAndSortedList();

  if (displayList.length === 0) {
    listEl.innerHTML = `<div style="font-size: 0.85rem; color: var(--text-tertiary); text-align: center; padding: 40px 0;">No matching items found.</div>`;
    statsEl.textContent = '0 items selected';
    btnCleanup.disabled = true;
    btnCleanup.textContent = 'Select items to delete';
    btnCleanup.style.background = 'var(--bg-primary)';
    return;
  }

  let selectedCount = 0;
  let selectedSize = 0;

  // Track global selection totals for selected state
  cleanupList.forEach(item => {
    if (item.selected) {
      selectedCount++;
      selectedSize += item.size;
    }
  });

  displayList.forEach((item) => {
    const itemEl = document.createElement('div');
    itemEl.className = 'storage-item-card';

    // Thumbnail / Icon construction
    let thumbHtml = '';
    if (item.type === 'image') {
      thumbHtml = `
        <div class="storage-item-thumb">
          <img src="${item.url}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22><rect x=%223%22 y=%223%22 width=%2218%22 height=%2218%22 rx=%222%22/><circle cx=%228.5%22 cy=%228.5%22 r=%221.5%22/><polyline points=%2221 15 16 10 5 21%22/></svg>';" />
          <div class="image-zoom-overlay">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </div>
        </div>
      `;
    } else if (item.type === 'character') {
      if (item.avatar) {
        thumbHtml = `<div class="storage-item-thumb"><img src="${item.avatar}" /></div>`;
      } else {
        thumbHtml = `<div class="storage-item-thumb"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>`;
      }
    } else if (item.type === 'chat') {
      if (item.avatar) {
        thumbHtml = `<div class="storage-item-thumb"><img src="${item.avatar}" /></div>`;
      } else {
        thumbHtml = `<div class="storage-item-thumb"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></div>`;
      }
    } else {
      // GenAI icon
      thumbHtml = `<div class="storage-item-thumb" style="color: var(--text-accent);"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>`;
    }

    // Badge logic
    const badgeLabel = item.type.toUpperCase();
    const badgeClass = item.category;

    // Subtitle creation
    let subtitle = item.date;
    if (item.type === 'chat' || item.type === 'genai') {
      subtitle = `${item.messagesCount} messages • ${item.date}`;
    } else if (item.type === 'character') {
      subtitle = `${item.description.substring(0, 42)}${item.description.length > 42 ? '...' : ''} • ${item.date}`;
    }

    itemEl.innerHTML = `
      <div class="storage-item-checkbox">
        <input type="checkbox" ${item.selected ? 'checked' : ''} />
      </div>
      ${thumbHtml}
      <div class="storage-item-info">
        <div class="storage-item-title">${item.title}</div>
        <div class="storage-item-meta">
          <span class="storage-item-badge ${badgeClass}">${badgeLabel}</span>
          <span>${subtitle}</span>
          <span style="margin-left: auto; font-weight: 600; color: var(--text-primary);">${formatBytes(item.size)}</span>
        </div>
      </div>
    `;

    const cb = itemEl.querySelector('input[type="checkbox"]');
    
    // Add Click listener to card
    itemEl.addEventListener('click', (e) => {
      // Avoid double toggling if checkbox itself was clicked
      if (e.target !== cb) {
        cb.checked = !cb.checked;
      }
      item.selected = cb.checked;
      renderCleanupList();
    });

    listEl.appendChild(itemEl);
  });

  statsEl.textContent = `${selectedCount} items selected (${formatBytes(selectedSize)})`;
  btnCleanup.disabled = selectedCount === 0;
  
  if (selectedCount > 0) {
    btnCleanup.textContent = `Clean Selected (${formatBytes(selectedSize)})`;
    btnCleanup.style.background = 'var(--error)';
  } else {
    btnCleanup.textContent = 'Select items to delete';
    btnCleanup.style.background = 'var(--bg-primary)';
  }
}

async function applySmartCleanup() {
  const toDelete = cleanupList.filter(item => item.selected);
  if (toDelete.length === 0) return;
  
  const confirmDel = confirm(`Permanently delete ${toDelete.length} selected items? This action is irreversible.`);
  if (!confirmDel) return;

  const btn = document.getElementById('btn-storage-cleanup');
  const oldText = btn.textContent;
  btn.textContent = 'Purging storage...';
  btn.disabled = true;

  try {
    let charactersDeletedCount = 0;
    let chatsDeletedCount = 0;
    let genaiDeletedCount = 0;
    let imagesDeletedCount = 0;

    for (const item of toDelete) {
      if (item.type === 'character') {
        // 1. Delete character card
        await characterStore.delete(item.charId);
        charactersDeletedCount++;

        // 2. Also automatically delete related chats dynamically
        try {
          const sessions = await chatStore.loadForCharacter(item.charId);
          if (sessions) {
            for (const s of sessions) {
              await chatStore.deleteSession(item.charId, s.id);
            }
          }
        } catch(e){}
      } else if (item.type === 'chat') {
        // Delete a specific character chat session
        await chatStore.deleteSession(item.charId, item.chatId);
        chatsDeletedCount++;
      } else if (item.type === 'genai') {
        // Delete a specific GenAI session
        try {
          const str = localStorage.getItem('vibechat_genai_sessions');
          if (str) {
            let sessions = JSON.parse(str);
            sessions = sessions.filter(x => x.id !== item.sessionId);
            localStorage.setItem('vibechat_genai_sessions', JSON.stringify(sessions));
            genaiDeletedCount++;
          }
        } catch(e){}
      } else if (item.type === 'image') {
        // Delete image markdown precisely
        if (item.isGenAi) {
          try {
            const str = localStorage.getItem('vibechat_genai_sessions');
            if (str) {
              let sessions = JSON.parse(str);
              let s = sessions.find(x => x.id === item.sessionId);
              if (s && s.messages) {
                let m = s.messages.find(x => x.id === item.msgId);
                if (m) {
                  const preciseRegex = new RegExp(`!\\[.*?\\]\\(${item.url.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\\\$&')}\\)`, 'g');
                  m.content = m.content.replace(preciseRegex, '').trim();
                  imagesDeletedCount++;
                }
              }
              localStorage.setItem('vibechat_genai_sessions', JSON.stringify(sessions));
            }
          }catch(e){}
        } else {
          try {
            const sessions = await chatStore.loadForCharacter(item.charId);
            const s = sessions.find(x => x.id === item.chatId);
            if (s && s.messages) {
              const m = s.messages.find(x => x.id === item.msgId);
              if (m) {
                const preciseRegex = new RegExp(`!\\[.*?\\]\\(${item.url.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\\\$&')}\\)`, 'g');
                if (m.original_text) m.original_text = m.original_text.replace(preciseRegex, '').trim();
                if (m.content) m.content = m.content.replace(preciseRegex, '').trim();
                await chatStore.saveSession(s);
                imagesDeletedCount++;
              }
            }
          } catch(e){}
        }
      }
    }

    // Compose a beautiful success notification summary
    let summaryMsg = 'Storage Purged: ';
    const parts = [];
    if (charactersDeletedCount > 0) parts.push(`${charactersDeletedCount} Chars`);
    if (chatsDeletedCount > 0) parts.push(`${chatsDeletedCount} Chats`);
    if (genaiDeletedCount > 0) parts.push(`${genaiDeletedCount} GenAI`);
    if (imagesDeletedCount > 0) parts.push(`${imagesDeletedCount} Images`);
    
    summaryMsg += parts.length > 0 ? parts.join(', ') : 'No items deleted';
    showToast(summaryMsg);

    await refreshStorageStats();
  } catch (err) {
    console.error('Failed to cleanup items:', err);
    alert('An error occurred during cleanup.');
  } finally {
    btn.textContent = oldText;
    btn.disabled = false;
  }
}
