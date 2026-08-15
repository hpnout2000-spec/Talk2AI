/* ════════════════════════════════════════════════════════════════════
   Storage Panel — Advanced Storage Stats and Interactive Cleanup
   ════════════════════════════════════════════════════════════════════ */

import { chatStore } from '../services/chat-store.js';
import { characterStore } from '../services/character-store.js';
import { groupChatStore } from '../services/group-chat-store.js';
import { gameStore } from '../services/game-store.js';
import { lorebookStore } from '../services/lorebook-store.js';
import { albumStore } from '../services/album-store.js';
import { renderCharacterList } from './character-panel.js';
import { showToast, showConfirm } from '../main.js';

let cleanupList = [];
let activeCategory = 'all'; // 'all', 'chars', 'chats', 'groups', 'games', 'genai', 'lorebooks', 'albums', 'images'
let searchQuery = '';
let quickFilter = 'all'; // 'all', 'empty', 'old'
let currentlyInspectedItem = null;

export function initStorageSettings() {
  const modal = document.getElementById('modal-settings-storage');
  if (!modal) return;

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        if (!modal.classList.contains('hidden')) {
          activeCategory = 'all';
          searchQuery = '';
          quickFilter = 'all';
          
          const searchInput = document.getElementById('storage-search-input');
          if (searchInput) searchInput.value = '';

          document.querySelectorAll('.storage-quick-pill').forEach(btn => btn.classList.remove('active'));
          
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

  // Setup Toolbar Select All / Deselect All
  document.getElementById('btn-storage-select-all')?.addEventListener('click', (e) => {
    e.preventDefault();
    const visibleList = getFilteredAndSortedList();
    visibleList.forEach(item => {
      item.selected = true;
    });
    
    // Fast DOM Toggle
    const listEl = document.getElementById('storage-cleanup-list');
    const cards = listEl.querySelectorAll('.storage-item-card');
    cards.forEach(card => {
      card.classList.add('selected');
      const cb = card.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = true;
    });
    
    updateSelectedStats();
  });
  
  document.getElementById('btn-storage-deselect-all')?.addEventListener('click', (e) => {
    e.preventDefault();
    const visibleList = getFilteredAndSortedList();
    visibleList.forEach(item => {
      item.selected = false;
    });
    
    // Fast DOM Toggle
    const listEl = document.getElementById('storage-cleanup-list');
    const cards = listEl.querySelectorAll('.storage-item-card');
    cards.forEach(card => {
      card.classList.remove('selected');
      const cb = card.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = false;
    });
    
    updateSelectedStats();
  });

  // Sort Selector
  document.getElementById('storage-sort-select')?.addEventListener('change', () => {
    renderCleanupList();
  });

  // Setup Live Search
  document.getElementById('storage-search-input')?.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderCleanupList();
  });

  // Setup Quick Action Filter Pills
  document.getElementById('btn-storage-filter-empty')?.addEventListener('click', (e) => {
    e.preventDefault();
    quickFilter = quickFilter === 'empty' ? 'all' : 'empty';
    updateQuickFilterUI();
    renderCleanupList();
  });

  document.getElementById('btn-storage-filter-old')?.addEventListener('click', (e) => {
    e.preventDefault();
    quickFilter = quickFilter === 'old' ? 'all' : 'old';
    updateQuickFilterUI();
    renderCleanupList();
  });

  // Setup Segmented Category Tabs
  const setupTabs = () => {
    const tabs = document.querySelectorAll('.storage-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        activeCategory = tab.dataset.category || 'all';
        updateTabUI();
        renderCleanupList();
      });
    });

    // Make interactive legend items filter like tabs too
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

  // Setup Scroll Listener for Overlays
  const listEl = document.getElementById('storage-cleanup-list');
  if (listEl) {
    listEl.addEventListener('scroll', updateScrollOverlays);
  }

  // Smart Scroll Delegation: Redirect scroll events from static modal regions to the list
  const modalBody = modal.querySelector('.modal-body');
  if (modalBody && listEl) {
    modalBody.addEventListener('wheel', (e) => {
      if (listEl.contains(e.target) || e.target === listEl) return;
      listEl.scrollTop += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }

  // Setup Inspection Modal listeners
  initInspectModal();
}

function updateQuickFilterUI() {
  const btnEmpty = document.getElementById('btn-storage-filter-empty');
  const btnOld = document.getElementById('btn-storage-filter-old');
  if (btnEmpty) btnEmpty.classList.toggle('active', quickFilter === 'empty');
  if (btnOld) btnOld.classList.toggle('active', quickFilter === 'old');
}

function initInspectModal() {
  const inspectModal = document.getElementById('modal-storage-inspect');
  const btnClose = document.getElementById('btn-close-storage-inspect');
  const btnFooterClose = document.getElementById('btn-storage-inspect-close');
  const btnDelete = document.getElementById('btn-storage-inspect-delete');

  const closeInspect = () => {
    if (inspectModal) inspectModal.classList.add('hidden');
    currentlyInspectedItem = null;
  };

  btnClose?.addEventListener('click', closeInspect);
  btnFooterClose?.addEventListener('click', closeInspect);
  inspectModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeInspect);

  btnDelete?.addEventListener('click', async () => {
    if (!currentlyInspectedItem) return;
    const itemToDelete = currentlyInspectedItem;
    const confirmDel = await showConfirm(
      'Delete Item',
      `Permanently delete "${itemToDelete.title}"? This cannot be undone.`
    );
    if (!confirmDel) return;

    closeInspect();
    await deleteSingleItem(itemToDelete);
  });
}

function openStorageItemInspector(item) {
  const inspectModal = document.getElementById('modal-storage-inspect');
  const inspectBody = document.getElementById('storage-inspect-body');
  if (!inspectModal || !inspectBody) return;

  currentlyInspectedItem = item;

  let extraHtml = '';
  if (item.type === 'image') {
    extraHtml = `
      <div class="storage-inspect-image-wrap">
        <img src="${item.url}" alt="${item.title}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22><rect x=%223%22 y=%223%22 width=%2218%22 height=%2218%22 rx=%222%22/><circle cx=%228.5%22 cy=%228.5%22 r=%221.5%22/><polyline points=%2221 15 16 10 5 21%22/></svg>';" />
      </div>
    `;
  } else if (item.type === 'character' && item.avatar) {
    extraHtml = `
      <div class="storage-inspect-image-wrap" style="max-height: 160px;">
        <img src="${item.avatar}" style="width: 100px; height: 100px; border-radius: var(--radius-md); object-fit: cover;" />
      </div>
    `;
  }

  let countDetails = '';
  if (item.messagesCount !== undefined) countDetails = `${item.messagesCount} messages`;
  else if (item.scenesCount !== undefined) countDetails = `${item.scenesCount} scenes`;
  else if (item.entriesCount !== undefined) countDetails = `${item.entriesCount} entries`;
  else if (item.nodesCount !== undefined) countDetails = `${item.nodesCount} items`;

  inspectBody.innerHTML = `
    ${extraHtml}
    <div class="storage-inspect-grid">
      <div class="storage-inspect-key">Title</div>
      <div class="storage-inspect-val" style="font-weight: 600;">${item.title}</div>

      <div class="storage-inspect-key">Category</div>
      <div class="storage-inspect-val"><span class="storage-item-badge ${item.category}">${item.type.toUpperCase()}</span></div>

      <div class="storage-inspect-key">Item ID</div>
      <div class="storage-inspect-val"><span class="storage-item-id">#${item.shortId}</span> <span style="font-size: 10px; color: var(--text-tertiary);">(${item.id})</span></div>

      <div class="storage-inspect-key">Timestamp</div>
      <div class="storage-inspect-val">${item.formattedTime}</div>

      <div class="storage-inspect-key">Size</div>
      <div class="storage-inspect-val" style="font-weight: 600; color: var(--text-accent);">${formatBytes(item.size)} (${item.size.toLocaleString()} bytes)</div>

      ${countDetails ? `
        <div class="storage-inspect-key">Contents</div>
        <div class="storage-inspect-val">${countDetails}</div>
      ` : ''}

      ${item.description ? `
        <div class="storage-inspect-key">Description</div>
        <div class="storage-inspect-val" style="font-size: 11px; color: var(--text-secondary); max-height: 80px; overflow-y: auto;">${item.description}</div>
      ` : ''}
    </div>
  `;

  inspectModal.classList.remove('hidden');
}

function updateScrollOverlays() {
  const listEl = document.getElementById('storage-cleanup-list');
  const overlayTop = document.getElementById('storage-scroll-overlay-top');
  const overlayBottom = document.getElementById('storage-scroll-overlay-bottom');
  if (!listEl || !overlayTop || !overlayBottom) return;

  const scrollTop = listEl.scrollTop;
  const scrollHeight = listEl.scrollHeight;
  const clientHeight = listEl.clientHeight;

  overlayTop.style.opacity = scrollTop > 2 ? '1' : '0';
  overlayBottom.style.opacity = (scrollTop + clientHeight < scrollHeight - 2) ? '1' : '0';
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
  if (!bytes || bytes <= 0) return '0 KB';
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return (bytes / 1024).toFixed(1) + ' KB';
  if (mb >= 1000) return (mb / 1024).toFixed(2) + ' GB';
  return mb.toFixed(2) + ' MB';
};

function formatExactTime(ts) {
  if (!ts) return 'Unknown';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return 'Unknown';
  const pad = n => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  const secs = pad(d.getSeconds());
  return `${day}.${month}.${year} ${hours}:${mins}:${secs}`;
}

async function refreshStorageStats() {
  const listEl = document.getElementById('storage-cleanup-list');
  if (listEl) {
    listEl.innerHTML = '<div id="storage-cleanup-stats" style="font-size: 0.85rem; font-weight: 500; color: var(--text-tertiary); text-align: center; padding: 40px 0;">Scanning application database...</div>';
  }
  
  const btnCleanup = document.getElementById('btn-storage-cleanup');
  if (btnCleanup) {
    btnCleanup.disabled = true;
    btnCleanup.textContent = 'Select items to delete';
    btnCleanup.style.background = 'var(--bg-primary)';
  }
  
  let charsSize = 0;
  let chatsSize = 0;
  let groupsSize = 0;
  let gamesSize = 0;
  let genaiSize = 0;
  let lorebooksSize = 0;
  let albumsSize = 0;
  let imagesSize = 0;
  
  cleanupList = [];
  const imgRegex = /!\[(.*?)\]\(([^)]+)\)/g;

  // Deduplication tracking sets
  const seenCharIds = new Set();
  const seenChatSessionIds = new Set();
  const seenGroupIds = new Set();
  const seenGroupSessionIds = new Set();
  const seenGameIds = new Set();
  const seenGenAiSessionIds = new Set();
  const seenLorebookIds = new Set();
  const seenAlbumIds = new Set();
  const seenImageKeys = new Set();

  // 1. Scan Characters
  let characters = characterStore.getAll() || [];
  if (characters.length === 0) {
    try {
      characters = await characterStore.load() || [];
    } catch(e) {}
  }

  for (const char of characters) {
    if (!char || !char.id || seenCharIds.has(char.id)) continue;
    seenCharIds.add(char.id);

    const charSize = new Blob([JSON.stringify(char)]).size;
    charsSize += charSize;

    cleanupList.push({
      id: `char-${char.id}`,
      type: 'character',
      category: 'chars',
      charId: char.id,
      shortId: String(char.id || '').replace(/^[^-]+-/, '').substring(0, 7),
      title: char.name || 'Unnamed Character',
      description: char.description || 'No description',
      rawTimestamp: new Date(char.last_chat_at || char.created_at || 0).getTime(),
      formattedTime: formatExactTime(char.last_chat_at || char.created_at),
      size: charSize,
      avatar: char.avatar || '',
      selected: false,
      rawObj: char
    });
  }

  // 2. Scan Character Chats & Chat Images
  for (const char of characters) {
    if (!char || !char.id) continue;
    let sessions = [];
    try {
      sessions = await chatStore.loadForCharacter(char.id) || [];
    } catch(e) {
      sessions = chatStore.getSessions(char.id) || [];
    }
    
    for (const session of sessions) {
      if (!session || !session.id || seenChatSessionIds.has(session.id)) continue;
      seenChatSessionIds.add(session.id);

      const sessionJson = JSON.stringify(session);
      const sessionSize = new Blob([sessionJson]).size;
      let sessionEmbeddedImagesBytes = 0;

      // Parse Chat Images accurately without double counting
      if (session.messages && Array.isArray(session.messages)) {
        for (const msg of session.messages) {
          const text = msg.original_text || msg.content || '';
          let match;
          while ((match = imgRegex.exec(text)) !== null) {
            const alt = match[1] || '';
            const url = match[2];
            const imgKey = `img-${session.id}-${msg.id}-${url}`;
            if (seenImageKeys.has(imgKey)) continue;
            seenImageKeys.add(imgKey);
            
            let imgBytes = 0;
            if (url.startsWith('data:image/')) {
              const base64Str = url.split(',')[1] || '';
              imgBytes = Math.round(base64Str.length * 0.75);
              sessionEmbeddedImagesBytes += imgBytes;
            } else {
              imgBytes = new Blob([match[0]]).size;
            }
            imagesSize += imgBytes;
            
            const msgTime = new Date(msg.timestamp || session.updated_at || session.created_at || 0).getTime();
            cleanupList.push({
              id: `img-${session.id}-${msg.id}-${encodeURIComponent(url.slice(0, 32))}`,
              type: 'image',
              category: 'images',
              charId: char.id,
              chatId: session.id,
              msgId: msg.id,
              url: url,
              title: alt || `Illustration in "${session.custom_title || char.name}"`,
              rawTimestamp: msgTime,
              formattedTime: formatExactTime(msgTime),
              shortId: String(msg.id || '').substring(0, 7),
              size: imgBytes,
              selected: false
            });
          }
        }
      }

      // Net text size (excluding base64 images so total space is not double-counted)
      const netChatSize = Math.max(0, sessionSize - sessionEmbeddedImagesBytes);
      chatsSize += netChatSize;

      cleanupList.push({
        id: `chat-${session.id}`,
        type: 'chat',
        category: 'chats',
        charId: char.id,
        chatId: session.id,
        title: session.custom_title || `Chat with ${char.name}`,
        rawTimestamp: new Date(session.updated_at || session.created_at || 0).getTime(),
        formattedTime: formatExactTime(session.updated_at || session.created_at),
        shortId: String(session.id || '').substring(0, 7),
        size: sessionSize,
        avatar: char.avatar || '',
        selected: false,
        messagesCount: session.messages ? session.messages.length : 0,
        rawObj: session
      });
    }
  }

  // 3. Scan Group Chats
  try {
    const groups = await groupChatStore.loadGroups() || [];
    for (const group of groups) {
      if (!group || !group.id || seenGroupIds.has(group.id)) continue;
      seenGroupIds.add(group.id);

      const groupSessions = await groupChatStore.loadSessionsForGroup(group.id) || [];
      for (const gSession of groupSessions) {
        if (!gSession || !gSession.id || seenGroupSessionIds.has(gSession.id)) continue;
        seenGroupSessionIds.add(gSession.id);

        const gSize = new Blob([JSON.stringify(gSession)]).size;
        groupsSize += gSize;

        cleanupList.push({
          id: `group-${gSession.id}`,
          type: 'group',
          category: 'groups',
          groupId: group.id,
          sessionId: gSession.id,
          title: group.name || 'Group Chat',
          membersCount: group.character_ids ? group.character_ids.length : 0,
          messagesCount: gSession.messages ? gSession.messages.length : 0,
          rawTimestamp: new Date(gSession.updated_at || gSession.created_at || 0).getTime(),
          formattedTime: formatExactTime(gSession.updated_at || gSession.created_at),
          shortId: String(gSession.id || '').substring(0, 7),
          size: gSize,
          selected: false,
          rawObj: gSession
        });
      }
    }
  } catch(e) {
    console.warn('Failed to scan groups for storage', e);
  }

  // 4. Scan RPG Games
  try {
    const gState = await gameStore.load() || { games: [] };
    for (const game of (gState.games || [])) {
      if (!game || !game.id || seenGameIds.has(game.id)) continue;
      seenGameIds.add(game.id);

      const gameSize = new Blob([JSON.stringify(game)]).size;
      gamesSize += gameSize;

      cleanupList.push({
        id: `game-${game.id}`,
        type: 'game',
        category: 'games',
        gameId: game.id,
        title: game.title || 'RPG Game Session',
        scenesCount: (game.history ? game.history.length : 0) + (game.currentScene ? 1 : 0),
        rawTimestamp: new Date(game.updated_at || game.created_at || 0).getTime(),
        formattedTime: formatExactTime(game.updated_at || game.created_at),
        shortId: String(game.id || '').substring(0, 7),
        size: gameSize,
        selected: false,
        rawObj: game
      });
    }
  } catch(e) {
    console.warn('Failed to scan games for storage', e);
  }

  // 5. Scan GenAI Sessions & GenAI Images
  try {
    const genaiStr = localStorage.getItem('vibechat_genai_sessions') || '[]';
    const genaiSessions = JSON.parse(genaiStr);
    for (const session of genaiSessions) {
      if (!session || !session.id || seenGenAiSessionIds.has(session.id)) continue;
      seenGenAiSessionIds.add(session.id);

      const sessionSize = new Blob([JSON.stringify(session)]).size;
      let genaiImgBytes = 0;

      if (session.messages && Array.isArray(session.messages)) {
        for (const msg of session.messages) {
          const text = msg.content || '';
          let match;
          while ((match = imgRegex.exec(text)) !== null) {
            const url = match[2];
            const gImgKey = `gimg-${session.id}-${msg.id}-${url}`;
            if (seenImageKeys.has(gImgKey)) continue;
            seenImageKeys.add(gImgKey);

            let size = 0;
            if (url.startsWith('data:image/')) {
              const base64Str = url.split(',')[1] || '';
              size = Math.round(base64Str.length * 0.75);
              genaiImgBytes += size;
            } else {
              size = new Blob([match[0]]).size;
            }
            imagesSize += size;
            
            const msgTime = new Date(msg.timestamp || session.updated_at || 0).getTime();
            cleanupList.push({
              id: `gimg-${session.id}-${msg.id}-${encodeURIComponent(url.slice(0, 32))}`,
              type: 'image',
              category: 'images',
              isGenAi: true,
              sessionId: session.id,
              msgId: msg.id,
              url: url,
              title: `Illustration in GenAI "${session.title || 'Session'}"`,
              rawTimestamp: msgTime,
              formattedTime: formatExactTime(msgTime),
              shortId: String(msg.id || '').substring(0, 7),
              size: size,
              selected: false
            });
          }
        }
      }

      const netGenaiSize = Math.max(0, sessionSize - genaiImgBytes);
      genaiSize += netGenaiSize;

      cleanupList.push({
        id: `genai-${session.id}`,
        type: 'genai',
        category: 'genai',
        sessionId: session.id,
        title: session.title || 'GenAI Session',
        messagesCount: session.messages ? session.messages.length : 0,
        rawTimestamp: new Date(session.updated_at || 0).getTime(),
        formattedTime: formatExactTime(session.updated_at),
        shortId: String(session.id || '').substring(0, 7),
        size: sessionSize,
        selected: false,
        rawObj: session
      });
    }
  } catch(e) {
    console.warn('Failed to scan GenAI sessions', e);
  }

  // 6. Scan Lorebooks
  try {
    const lorebooks = await lorebookStore.load() || [];
    for (const lb of lorebooks) {
      if (!lb || !lb.id || seenLorebookIds.has(lb.id)) continue;
      seenLorebookIds.add(lb.id);

      const lbSize = new Blob([JSON.stringify(lb)]).size;
      lorebooksSize += lbSize;

      cleanupList.push({
        id: `lorebook-${lb.id}`,
        type: 'lorebook',
        category: 'lorebooks',
        lorebookId: lb.id,
        title: lb.name || 'World Lorebook',
        entriesCount: lb.entries ? lb.entries.length : 0,
        rawTimestamp: new Date(lb.created_at || 0).getTime(),
        formattedTime: formatExactTime(lb.created_at),
        shortId: String(lb.id || '').substring(0, 7),
        size: lbSize,
        selected: false,
        rawObj: lb
      });
    }
  } catch(e) {
    console.warn('Failed to scan Lorebooks', e);
  }

  // 7. Scan Albums
  try {
    await albumStore.load();
    const albums = albumStore.getAllAlbums() || [];
    for (const alb of albums) {
      if (!alb || !alb.id || seenAlbumIds.has(alb.id)) continue;
      seenAlbumIds.add(alb.id);

      const albSize = new Blob([JSON.stringify(alb)]).size;
      albumsSize += albSize;

      cleanupList.push({
        id: `album-${alb.id}`,
        type: 'album',
        category: 'albums',
        albumId: alb.id,
        title: alb.title || 'Image Album',
        nodesCount: alb.nodes ? alb.nodes.length : 0,
        rawTimestamp: new Date(alb.updatedAt || alb.createdAt || 0).getTime(),
        formattedTime: formatExactTime(alb.updatedAt || alb.createdAt),
        shortId: String(alb.id || '').substring(0, 7),
        size: albSize,
        selected: false,
        rawObj: alb
      });
    }
  } catch(e) {
    console.warn('Failed to scan Albums', e);
  }

  const totalSize = charsSize + chatsSize + groupsSize + gamesSize + genaiSize + lorebooksSize + albumsSize + imagesSize;
  
  // UI Stats Updates
  document.getElementById('storage-total-size').textContent = formatBytes(totalSize);
  document.getElementById('storage-val-chars').textContent = formatBytes(charsSize);
  document.getElementById('storage-val-chats').textContent = formatBytes(chatsSize);
  document.getElementById('storage-val-groups').textContent = formatBytes(groupsSize);
  document.getElementById('storage-val-games').textContent = formatBytes(gamesSize);
  document.getElementById('storage-val-genai').textContent = formatBytes(genaiSize);
  document.getElementById('storage-val-lorebooks').textContent = formatBytes(lorebooksSize);
  document.getElementById('storage-val-albums').textContent = formatBytes(albumsSize);
  document.getElementById('storage-val-images').textContent = formatBytes(imagesSize);

  // Fill Progress bar
  const safePct = (val) => totalSize > 0 ? (val / totalSize) * 100 : 0;
  document.getElementById('storage-bar-chars').style.width = `${safePct(charsSize)}%`;
  document.getElementById('storage-bar-chats').style.width = `${safePct(chatsSize)}%`;
  document.getElementById('storage-bar-groups').style.width = `${safePct(groupsSize)}%`;
  document.getElementById('storage-bar-games').style.width = `${safePct(gamesSize)}%`;
  document.getElementById('storage-bar-genai').style.width = `${safePct(genaiSize)}%`;
  document.getElementById('storage-bar-lorebooks').style.width = `${safePct(lorebooksSize)}%`;
  document.getElementById('storage-bar-albums').style.width = `${safePct(albumsSize)}%`;
  document.getElementById('storage-bar-images').style.width = `${safePct(imagesSize)}%`;

  // Update Category Count Badges
  const countOf = (cat) => cleanupList.filter(x => x.category === cat).length;
  document.getElementById('storage-count-all').textContent = cleanupList.length;
  document.getElementById('storage-count-chars').textContent = countOf('chars');
  document.getElementById('storage-count-chats').textContent = countOf('chats');
  document.getElementById('storage-count-groups').textContent = countOf('groups');
  document.getElementById('storage-count-games').textContent = countOf('games');
  document.getElementById('storage-count-genai').textContent = countOf('genai');
  document.getElementById('storage-count-lorebooks').textContent = countOf('lorebooks');
  document.getElementById('storage-count-albums').textContent = countOf('albums');
  document.getElementById('storage-count-images').textContent = countOf('images');

  renderCleanupList();
}

function getFilteredAndSortedList() {
  const now = Date.now();

  // 1. Category Filter
  let displayList = activeCategory === 'all' 
    ? [...cleanupList]
    : cleanupList.filter(item => item.category === activeCategory);

  // 2. Search Filter
  if (searchQuery) {
    displayList = displayList.filter(item => {
      const titleMatch = item.title && item.title.toLowerCase().includes(searchQuery);
      const descMatch = item.description && item.description.toLowerCase().includes(searchQuery);
      const idMatch = item.shortId && item.shortId.toLowerCase().includes(searchQuery);
      const urlMatch = item.url && item.url.toLowerCase().includes(searchQuery);
      return titleMatch || descMatch || idMatch || urlMatch;
    });
  }

  // 3. Quick Action Filter Pills
  if (quickFilter === 'empty') {
    displayList = displayList.filter(item => {
      if (item.type === 'chat' || item.type === 'genai' || item.type === 'group') return (item.messagesCount || 0) === 0;
      if (item.type === 'game') return (item.scenesCount || 0) === 0;
      if (item.type === 'lorebook') return (item.entriesCount || 0) === 0;
      if (item.type === 'album') return (item.nodesCount || 0) === 0;
      return false;
    });
  } else if (quickFilter === 'old') {
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    displayList = displayList.filter(item => item.rawTimestamp && item.rawTimestamp < thirtyDaysAgo);
  }

  // 4. Sorting
  const sortEl = document.getElementById('storage-sort-select');
  const sortMode = sortEl ? sortEl.value : 'size';

  if (sortMode === 'size') {
    displayList.sort((a, b) => b.size - a.size);
  } else if (sortMode === 'size-asc') {
    displayList.sort((a, b) => a.size - b.size);
  } else if (sortMode === 'date') {
    displayList.sort((a, b) => (b.rawTimestamp || 0) - (a.rawTimestamp || 0));
  } else if (sortMode === 'date-asc') {
    displayList.sort((a, b) => (a.rawTimestamp || 0) - (b.rawTimestamp || 0));
  } else if (sortMode === 'name') {
    displayList.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (sortMode === 'messages') {
    displayList.sort((a, b) => (b.messagesCount || b.entriesCount || b.nodesCount || 0) - (a.messagesCount || a.entriesCount || a.nodesCount || 0));
  }

  return displayList;
}

function updateSelectedStats() {
  const btnCleanup = document.getElementById('btn-storage-cleanup');
  const statsEl = document.getElementById('storage-selected-stats');

  let selectedCount = 0;
  let selectedSize = 0;

  cleanupList.forEach(item => {
    if (item.selected) {
      selectedCount++;
      selectedSize += item.size;
    }
  });

  if (statsEl) {
    statsEl.textContent = `${selectedCount} items selected (${formatBytes(selectedSize)})`;
  }
  
  if (btnCleanup) {
    btnCleanup.disabled = selectedCount === 0;
    if (selectedCount > 0) {
      btnCleanup.textContent = `Clean Selected (${formatBytes(selectedSize)})`;
      btnCleanup.style.background = 'var(--error)';
    } else {
      btnCleanup.textContent = 'Select items to delete';
      btnCleanup.style.background = 'var(--bg-primary)';
    }
  }
}

function renderCleanupList() {
  const listEl = document.getElementById('storage-cleanup-list');
  if (!listEl) return;

  listEl.innerHTML = '';

  const displayList = getFilteredAndSortedList();

  if (displayList.length === 0) {
    listEl.innerHTML = `<div style="font-size: 0.85rem; color: var(--text-tertiary); text-align: center; padding: 40px 0;">No matching storage items found.</div>`;
    updateSelectedStats();
    setTimeout(updateScrollOverlays, 10);
    return;
  }

  displayList.forEach((item) => {
    const itemEl = document.createElement('div');
    itemEl.className = `storage-item-card ${item.selected ? 'selected' : ''}`;

    // Thumbnail / Icon construction
    let thumbHtml = '';
    if (item.type === 'image') {
      thumbHtml = `
        <div class="storage-item-thumb">
          <img src="${item.url}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22><rect x=%223%22 y=%223%22 width=%2218%22 height=%2218%22 rx=%222%22/><circle cx=%228.5%22 cy=%228.5%22 r=%221.5%22/><polyline points=%2221 15 16 10 5 21%22/></svg>';" />
          <div class="image-zoom-overlay">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
        </div>
      `;
    } else if (item.type === 'character') {
      if (item.avatar) {
        thumbHtml = `<div class="storage-item-thumb"><img src="${item.avatar}" /></div>`;
      } else {
        thumbHtml = `<div class="storage-item-thumb"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>`;
      }
    } else if (item.type === 'chat') {
      if (item.avatar) {
        thumbHtml = `<div class="storage-item-thumb"><img src="${item.avatar}" /></div>`;
      } else {
        thumbHtml = `<div class="storage-item-thumb"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></div>`;
      }
    } else if (item.type === 'group') {
      thumbHtml = `<div class="storage-item-thumb" style="color: #00bcd4;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>`;
    } else if (item.type === 'game') {
      thumbHtml = `<div class="storage-item-thumb" style="color: #e91e63;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="6" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/><path d="M10 12h4"/><path d="M12 10v4"/></svg></div>`;
    } else if (item.type === 'lorebook') {
      thumbHtml = `<div class="storage-item-thumb" style="color: #3f51b5;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>`;
    } else if (item.type === 'album') {
      thumbHtml = `<div class="storage-item-thumb" style="color: #009688;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg></div>`;
    } else {
      // GenAI icon
      thumbHtml = `<div class="storage-item-thumb" style="color: var(--text-accent);"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>`;
    }

    // Badge logic
    const badgeLabel = item.type.toUpperCase();
    const badgeClass = item.category;

    // Subtitle creation (NO snippet of last message per explicit instruction)
    let metaDetails = '';
    if (item.type === 'chat' || item.type === 'genai') {
      metaDetails = `<span>${item.messagesCount || 0} msgs</span>`;
    } else if (item.type === 'group') {
      metaDetails = `<span>${item.membersCount || 0} members • ${item.messagesCount || 0} msgs</span>`;
    } else if (item.type === 'game') {
      metaDetails = `<span>${item.scenesCount || 0} scenes</span>`;
    } else if (item.type === 'lorebook') {
      metaDetails = `<span>${item.entriesCount || 0} entries</span>`;
    } else if (item.type === 'album') {
      metaDetails = `<span>${item.nodesCount || 0} items</span>`;
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
          <span class="storage-item-id">#${item.shortId}</span>
          ${metaDetails}
          <span class="storage-item-time">${item.formattedTime}</span>
          <span class="storage-item-size">${formatBytes(item.size)}</span>
        </div>
      </div>
      <div class="storage-item-actions">
        <button class="btn-storage-inspect" title="Inspect details">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
      </div>
    `;

    const cb = itemEl.querySelector('input[type="checkbox"]');
    const btnInspect = itemEl.querySelector('.btn-storage-inspect');

    btnInspect.addEventListener('click', (e) => {
      e.stopPropagation();
      openStorageItemInspector(item);
    });
    
    // Add Click listener to card
    itemEl.addEventListener('click', (e) => {
      if (e.target !== cb && !btnInspect.contains(e.target)) {
        cb.checked = !cb.checked;
      }
      item.selected = cb.checked;
      itemEl.classList.toggle('selected', item.selected);
      updateSelectedStats();
    });

    listEl.appendChild(itemEl);
  });

  updateSelectedStats();
  setTimeout(updateScrollOverlays, 10);
}

// Single item deletion from Inspection Modal
async function deleteSingleItem(item) {
  try {
    if (item.type === 'character') {
      await characterStore.delete(item.charId);
      renderCharacterList();
    } else if (item.type === 'chat') {
      await chatStore.deleteSession(item.charId, item.chatId);
    } else if (item.type === 'group') {
      if (item.sessionId) {
        await groupChatStore.deleteSession(item.groupId, item.sessionId);
      } else {
        await groupChatStore.deleteGroup(item.groupId);
      }
    } else if (item.type === 'game') {
      gameStore.deleteGame(item.gameId);
    } else if (item.type === 'lorebook') {
      await lorebookStore.delete(item.lorebookId);
    } else if (item.type === 'album') {
      await albumStore.deleteAlbum(item.albumId);
    } else if (item.type === 'genai') {
      const str = localStorage.getItem('vibechat_genai_sessions');
      if (str) {
        let sessions = JSON.parse(str);
        sessions = sessions.filter(x => x.id !== item.sessionId);
        localStorage.setItem('vibechat_genai_sessions', JSON.stringify(sessions));
      }
    } else if (item.type === 'image') {
      await deleteSingleImage(item);
    }

    showToast(`Deleted: ${item.title}`);
    await refreshStorageStats();
  } catch (err) {
    console.error('Failed to delete item:', err);
    showToast('Failed to delete item');
  }
}

async function deleteSingleImage(item) {
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const imgPattern = new RegExp(`!\\[.*?\\]\\(${escapeRegex(item.url)}\\)`, 'g');

  if (item.isGenAi) {
    const str = localStorage.getItem('vibechat_genai_sessions');
    if (str) {
      let sessions = JSON.parse(str);
      const s = sessions.find(x => x.id === item.sessionId);
      if (s && s.messages) {
        const m = s.messages.find(x => x.id === item.msgId);
        if (m) {
          m.content = (m.content || '').replace(imgPattern, '').trim();
          // Remove empty message if it only contained the image
          if (!m.content) {
            s.messages = s.messages.filter(x => x.id !== item.msgId);
          }
        }
        localStorage.setItem('vibechat_genai_sessions', JSON.stringify(sessions));
      }
    }
  } else {
    const sessions = await chatStore.loadForCharacter(item.charId) || [];
    const s = sessions.find(x => x.id === item.chatId);
    if (s && s.messages) {
      const m = s.messages.find(x => x.id === item.msgId);
      if (m) {
        if (m.original_text) m.original_text = m.original_text.replace(imgPattern, '').trim();
        if (m.content) m.content = m.content.replace(imgPattern, '').trim();
        
        // If message is now empty, remove it entirely to prevent ghost bubbles
        if (!m.content && !m.original_text && !m.thinking) {
          s.messages = s.messages.filter(x => x.id !== item.msgId);
        }
        await chatStore.saveSession(s);
      }
    }
  }
}

// Safe Batch Cleanup Engine
async function applySmartCleanup() {
  const toDelete = cleanupList.filter(item => item.selected);
  if (toDelete.length === 0) return;
  
  const selectedSize = toDelete.reduce((acc, x) => acc + x.size, 0);

  const confirmDel = await showConfirm(
    'Delete Selected Storage Items',
    `Permanently delete ${toDelete.length} selected items (${formatBytes(selectedSize)})? This action cannot be undone.`
  );
  if (!confirmDel) return;

  const btn = document.getElementById('btn-storage-cleanup');
  const oldText = btn ? btn.textContent : '';
  if (btn) {
    btn.textContent = 'Purging storage...';
    btn.disabled = true;
  }

  try {
    let charactersDeletedCount = 0;
    let chatsDeletedCount = 0;
    let groupsDeletedCount = 0;
    let gamesDeletedCount = 0;
    let genaiDeletedCount = 0;
    let lorebooksDeletedCount = 0;
    let albumsDeletedCount = 0;
    let imagesDeletedCount = 0;

    // Track deleted character IDs to avoid redundant chat deletions
    const deletedCharIds = new Set();
    const charactersToDelete = toDelete.filter(x => x.type === 'character');
    charactersToDelete.forEach(c => deletedCharIds.add(c.charId));

    // 1. Grouped Safe Cleanup for Images
    const imagesToDelete = toDelete.filter(x => x.type === 'image');
    if (imagesToDelete.length > 0) {
      // Group by chat session
      const chatImageMap = new Map();
      const genAiImages = [];

      imagesToDelete.forEach(img => {
        if (img.isGenAi) {
          genAiImages.push(img);
        } else if (!deletedCharIds.has(img.charId)) {
          const key = `${img.charId}:${img.chatId}`;
          if (!chatImageMap.has(key)) chatImageMap.set(key, []);
          chatImageMap.get(key).push(img);
        }
      });

      // Process regular chat images in batch per session
      for (const [key, imgs] of chatImageMap.entries()) {
        const [charId, chatId] = key.split(':');
        try {
          const sessions = await chatStore.loadForCharacter(charId) || [];
          const s = sessions.find(x => x.id === chatId);
          if (s && s.messages) {
            imgs.forEach(img => {
              const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const imgPattern = new RegExp(`!\\[.*?\\]\\(${escapeRegex(img.url)}\\)`, 'g');
              const m = s.messages.find(x => x.id === img.msgId);
              if (m) {
                if (m.original_text) m.original_text = m.original_text.replace(imgPattern, '').trim();
                if (m.content) m.content = m.content.replace(imgPattern, '').trim();
                imagesDeletedCount++;
              }
            });

            // Clean up empty ghost messages
            s.messages = s.messages.filter(m => {
              const hasContent = m.content && m.content.trim().length > 0;
              const hasOrig = m.original_text && m.original_text.trim().length > 0;
              const hasThinking = m.thinking && m.thinking.trim().length > 0;
              return hasContent || hasOrig || hasThinking;
            });

            await chatStore.saveSession(s);
          }
        } catch(e) {
          console.warn('Failed batch image cleanup for session', key, e);
        }
      }

      // Process GenAI images in batch
      if (genAiImages.length > 0) {
        try {
          const str = localStorage.getItem('vibechat_genai_sessions');
          if (str) {
            let genaiSessions = JSON.parse(str);
            genAiImages.forEach(img => {
              const s = genaiSessions.find(x => x.id === img.sessionId);
              if (s && s.messages) {
                const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const imgPattern = new RegExp(`!\\[.*?\\]\\(${escapeRegex(img.url)}\\)`, 'g');
                const m = s.messages.find(x => x.id === img.msgId);
                if (m) {
                  m.content = (m.content || '').replace(imgPattern, '').trim();
                  imagesDeletedCount++;
                }
              }
            });

            // Clean up empty messages in GenAI
            genaiSessions.forEach(s => {
              if (s.messages) {
                s.messages = s.messages.filter(m => m.content && m.content.trim().length > 0);
              }
            });

            localStorage.setItem('vibechat_genai_sessions', JSON.stringify(genaiSessions));
          }
        } catch(e) {
          console.warn('Failed batch image cleanup for GenAI', e);
        }
      }
    }

    // 2. Cleanup Chats (skip if parent character is also selected for deletion)
    const chatsToDelete = toDelete.filter(x => x.type === 'chat');
    for (const item of chatsToDelete) {
      if (!deletedCharIds.has(item.charId)) {
        try {
          await chatStore.deleteSession(item.charId, item.chatId);
          chatsDeletedCount++;
        } catch(e) {
          console.warn('Failed to delete chat session', item.chatId, e);
        }
      }
    }

    // 3. Cleanup Characters
    for (const item of charactersToDelete) {
      try {
        await characterStore.delete(item.charId);
        charactersDeletedCount++;

        // Clear associated chats
        try {
          const sessions = await chatStore.loadForCharacter(item.charId) || [];
          for (const s of sessions) {
            await chatStore.deleteSession(item.charId, s.id);
          }
        } catch(e) {}
      } catch(e) {
        console.warn('Failed to delete character', item.charId, e);
      }
    }

    // 4. Cleanup Group Chats
    const groupsToDelete = toDelete.filter(x => x.type === 'group');
    for (const item of groupsToDelete) {
      try {
        if (item.sessionId) {
          await groupChatStore.deleteSession(item.groupId, item.sessionId);
        } else {
          await groupChatStore.deleteGroup(item.groupId);
        }
        groupsDeletedCount++;
      } catch(e) {
        console.warn('Failed to delete group item', item.id, e);
      }
    }

    // 5. Cleanup RPG Games
    const gamesToDelete = toDelete.filter(x => x.type === 'game');
    for (const item of gamesToDelete) {
      try {
        gameStore.deleteGame(item.gameId);
        gamesDeletedCount++;
      } catch(e) {
        console.warn('Failed to delete game', item.gameId, e);
      }
    }

    // 6. Cleanup Lorebooks
    const lorebooksToDelete = toDelete.filter(x => x.type === 'lorebook');
    for (const item of lorebooksToDelete) {
      try {
        await lorebookStore.delete(item.lorebookId);
        lorebooksDeletedCount++;
      } catch(e) {
        console.warn('Failed to delete lorebook', item.lorebookId, e);
      }
    }

    // 7. Cleanup Albums
    const albumsToDelete = toDelete.filter(x => x.type === 'album');
    for (const item of albumsToDelete) {
      try {
        await albumStore.deleteAlbum(item.albumId);
        albumsDeletedCount++;
      } catch(e) {
        console.warn('Failed to delete album', item.albumId, e);
      }
    }

    // 8. Cleanup GenAI Sessions
    const genaiToDelete = toDelete.filter(x => x.type === 'genai');
    if (genaiToDelete.length > 0) {
      try {
        const str = localStorage.getItem('vibechat_genai_sessions');
        if (str) {
          let sessions = JSON.parse(str);
          const idsToDelete = new Set(genaiToDelete.map(x => x.sessionId));
          sessions = sessions.filter(x => !idsToDelete.has(x.id));
          localStorage.setItem('vibechat_genai_sessions', JSON.stringify(sessions));
          genaiDeletedCount = idsToDelete.size;
        }
      } catch(e) {
        console.warn('Failed to delete GenAI sessions', e);
      }
    }

    // Refresh UI components
    renderCharacterList();

    // Compose a helpful summary notification
    const parts = [];
    if (charactersDeletedCount > 0) parts.push(`${charactersDeletedCount} Chars`);
    if (chatsDeletedCount > 0) parts.push(`${chatsDeletedCount} Chats`);
    if (groupsDeletedCount > 0) parts.push(`${groupsDeletedCount} Groups`);
    if (gamesDeletedCount > 0) parts.push(`${gamesDeletedCount} RPG Games`);
    if (genaiDeletedCount > 0) parts.push(`${genaiDeletedCount} GenAI`);
    if (lorebooksDeletedCount > 0) parts.push(`${lorebooksDeletedCount} Lorebooks`);
    if (albumsDeletedCount > 0) parts.push(`${albumsDeletedCount} Albums`);
    if (imagesDeletedCount > 0) parts.push(`${imagesDeletedCount} Images`);
    
    const summaryMsg = parts.length > 0 
      ? `Storage Purged: ${parts.join(', ')} (${formatBytes(selectedSize)} freed)`
      : 'No items deleted';
      
    showToast(summaryMsg);

    await refreshStorageStats();
  } catch (err) {
    console.error('Failed to cleanup items:', err);
    showToast('An error occurred during cleanup.');
  } finally {
    if (btn) {
      btn.textContent = oldText;
      btn.disabled = false;
    }
  }
}
