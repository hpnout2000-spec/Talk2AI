/* ════════════════════════════════════════════════════════════════════
   Album View Component — Interactive ComfyUI Node Canvas logic
   ════════════════════════════════════════════════════════════════════ */

import { albumStore } from '../services/album-store.js';
import { api } from '../services/api.js';
import { settingsStore } from '../services/settings-store.js';
import { generateImageComfyUI } from '../services/comfyui-service.js';
import { uiManager } from '../utils/ui-manager.js';
import { renderMarkdown } from '../utils/helpers.js';

// Selection Mode State
let selectionMode = null; // null, 'similar', 'comment'
let selectedNodeIds = new Set();

// Local state for panning and zooming
let panX = 0;
let panY = 0;
let zoom = 1.0;
let isPanning = false;
let startX = 0;
let startY = 0;

// Track active generation
let isAlbumGenerating = false;
let abortController = null;

// Track active image node (the leaf displaying suggestions)
let activeImageNodeId = null;
let lastActiveAlbumId = null;

// Use global wrappers to break the circular dependency with main.js imports
const showToast = (msg, type) => window.showToast ? window.showToast(msg, type) : console.log(msg);
const showPrompt = (title, msg, def) => window.showPrompt ? window.showPrompt(title, msg, def) : Promise.resolve(null);
const showConfirm = (title, msg) => window.showConfirm ? window.showConfirm(title, msg) : Promise.resolve(false);

export async function initAlbumView() {
  await albumStore.load();

  // Bind tab click
  const tabAlbum = document.getElementById('tab-album');
  if (tabAlbum) {
    tabAlbum.addEventListener('click', async () => {
      // Toggle Tab Active Styles
      const otherTabs = ['tab-characters', 'tab-books', 'tab-groups', 'tab-game'].map(id => document.getElementById(id));
      tabAlbum.classList.add('active');
      tabAlbum.style.background = 'var(--bg-tertiary)';
      tabAlbum.style.color = 'var(--text-primary)';
      tabAlbum.style.border = '1px solid var(--border-light)';

      otherTabs.forEach(btn => {
        if (!btn) return;
        btn.classList.remove('active');
        btn.style.background = 'transparent';
        btn.style.color = 'var(--text-secondary)';
        btn.style.border = '1px solid transparent';
      });

      // Hide other sidebars, show album-section
      const sections = ['characters-section', 'books-section', 'groups-section', 'games-section'].map(id => document.getElementById(id));
      sections.forEach(s => {
        if (s) {
          s.classList.add('hidden');
          s.style.display = 'none';
        }
      });
      const albumSection = document.getElementById('album-section');
      if (albumSection) {
        albumSection.classList.remove('hidden');
        albumSection.style.display = 'flex';
      }

      // Hide other main views
      const views = ['chat-view-container', 'book-view-container', 'group-chat-view-container', 'game-view-container'].map(id => document.getElementById(id));
      views.forEach(v => {
        if (v) {
          v.classList.add('hidden');
          v.style.display = 'none';
        }
      });
      const albumView = document.getElementById('album-view-container');
      if (albumView) {
        albumView.classList.remove('hidden');
        albumView.style.display = 'block';
      }

      renderAlbumList();
      initWorkspacePanning();
      renderActiveAlbumWorkspace();
    });
  }

  // Modal Edit Elements
  const modalAlbumEdit = document.getElementById('modal-album-edit');
  const albumModalTitle = document.getElementById('album-modal-title');
  const albumEditId = document.getElementById('album-edit-id');
  const albumEditTitle = document.getElementById('album-edit-title');
  const albumEditTheme = document.getElementById('album-edit-theme');
  const albumEditDesc = document.getElementById('album-edit-description');
  const btnCancelAlbumEdit = document.getElementById('btn-cancel-album-edit');
  const btnSaveAlbumEdit = document.getElementById('btn-save-album-edit');
  const btnCloseAlbumModal = modalAlbumEdit ? modalAlbumEdit.querySelector('.btn-close-album-modal') : null;

  // Bind Close / Cancel listeners
  if (btnCancelAlbumEdit) {
    btnCancelAlbumEdit.addEventListener('click', () => uiManager.close(modalAlbumEdit));
  }
  if (btnCloseAlbumModal) {
    btnCloseAlbumModal.addEventListener('click', () => uiManager.close(modalAlbumEdit));
  }

  // Bind Save Album Edit
  if (btnSaveAlbumEdit) {
    btnSaveAlbumEdit.addEventListener('click', async () => {
      const id = albumEditId.value;
      const title = albumEditTitle.value.trim();
      const theme = albumEditTheme.value.trim();
      const description = albumEditDesc.value.trim();

      if (!title || !theme || !description) {
        showToast('All fields are required!', 'error');
        return;
      }

      uiManager.close(modalAlbumEdit);

      if (id === '') {
        // CREATE MODE
        const album = await albumStore.createAlbum(title, theme, description);
        showToast(`Album "${album.title}" created successfully!`);
        renderAlbumList();
        renderActiveAlbumWorkspace();
      } else {
        // EDIT MODE
        await albumStore.updateAlbum(id, { title, theme, description });
        showToast('Album updated!');
        renderAlbumList();
        renderActiveAlbumWorkspace();
      }
    });
  }

  // Bind New Album button (Sidebar)
  const btnAddAlbum = document.getElementById('btn-add-album');
  if (btnAddAlbum) {
    btnAddAlbum.addEventListener('click', () => {
      if (albumModalTitle) albumModalTitle.textContent = 'Create Album';
      if (albumEditId) albumEditId.value = '';
      if (albumEditTitle) albumEditTitle.value = '';
      if (albumEditTheme) albumEditTheme.value = '';
      if (albumEditDesc) albumEditDesc.value = '';
      
      uiManager.open(modalAlbumEdit);
    });
  }

  // Collapsible Settings Panel Hooks
  const drawer = document.getElementById('album-settings-drawer');
  const backdrop = document.getElementById('album-settings-backdrop');

  function openSettingsDrawer() {
    if (drawer) drawer.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
  }

  function closeSettingsDrawer() {
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  }

  if (drawer) {
    drawer.addEventListener('click', () => {
      if (!drawer.classList.contains('open')) {
        openSettingsDrawer();
      }
    });
  }

  // Close on backdrop click
  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSettingsDrawer();
    });
  }

  // Close on close button click
  const closeBtn = document.getElementById('btn-album-settings-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSettingsDrawer();
    });
  }

  // Save Settings Button
  const btnSaveSettings = document.getElementById('btn-album-save-settings');
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', async () => {
      const activeAlbum = albumStore.getActiveAlbum();
      if (!activeAlbum) return;

      const tagsInput = document.getElementById('album-mandatory-tags-input');
      const mandatoryTags = tagsInput ? tagsInput.value.trim() : '';

      const langSelect = document.getElementById('album-language-select');
      const language = langSelect ? langSelect.value : 'Russian';

      const nsfwToggle = document.getElementById('album-nsfw-toggle');
      const allowNsfw = nsfwToggle ? nsfwToggle.checked : false;

      await albumStore.updateAlbumSettings(activeAlbum.id, { mandatoryTags, language, allowNsfw });
      showToast('Album options saved!');
      
      // Close settings drawer
      const drawerEl = document.getElementById('album-settings-drawer');
      const triggerEl = document.getElementById('album-settings-trigger');
      const backdropEl = document.getElementById('album-settings-backdrop');
      if (drawerEl) drawerEl.classList.remove('open');
      if (triggerEl) triggerEl.classList.remove('active');
      if (backdropEl) backdropEl.classList.remove('open');
    });
  }

  // Sort Drawer Event Listeners
  const sortDrawer = document.getElementById('album-sort-drawer');
  const sortBackdrop = document.getElementById('album-sort-backdrop');

  function openSortDrawer() {
    if (sortDrawer) sortDrawer.classList.add('open');
    if (sortBackdrop) sortBackdrop.classList.add('open');
  }

  function closeSortDrawer() {
    if (sortDrawer) sortDrawer.classList.remove('open');
    if (sortBackdrop) sortBackdrop.classList.remove('open');
  }

  if (sortDrawer) {
    sortDrawer.addEventListener('click', () => {
      if (!sortDrawer.classList.contains('open')) {
        openSortDrawer();
      }
    });
  }

  if (sortBackdrop) {
    sortBackdrop.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSortDrawer();
    });
  }

  const closeSortBtn = document.getElementById('btn-album-sort-close');
  if (closeSortBtn) {
    closeSortBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSortDrawer();
    });
  }

  const sortOptions = document.querySelectorAll('.album-sort-option');
  sortOptions.forEach(opt => {
    opt.addEventListener('click', async (e) => {
      e.stopPropagation();
      const activeAlbum = albumStore.getActiveAlbum();
      if (!activeAlbum) return;

      const sortMode = opt.getAttribute('data-sort');
      await albumStore.updateAlbumSettings(activeAlbum.id, { sortMode });

      // Update UI active states
      sortOptions.forEach(o => o.classList.toggle('active', o === opt));

      closeSortDrawer();
      renderActiveAlbumWorkspace();
    });
  });

  // Context Menu Item Listeners
  const btnCtxGeneratePic = document.getElementById('ctx-generate-pic');
  const btnCtxSimilarTo = document.getElementById('ctx-similar-to');
  const btnCtxComment = document.getElementById('ctx-comment');

  if (btnCtxGeneratePic) {
    btnCtxGeneratePic.addEventListener('click', async () => {
      const activeAlbum = albumStore.getActiveAlbum();
      if (!activeAlbum) return;

      const menu = document.getElementById('album-context-menu');
      if (menu) menu.classList.add('hidden');

      const canvasX = parseFloat(menu.dataset.canvasX || '2500');
      const canvasY = parseFloat(menu.dataset.canvasY || '2500');

      await albumStore.addNode(activeAlbum.id, {
        type: 'standalone-input',
        x: canvasX - 140, // Center input node (280px wide)
        y: canvasY - 40,
        prompt: '',
        description: '',
        parentId: null,
        status: 'idle'
      });
      renderActiveAlbumWorkspace();
    });
  }

  if (btnCtxSimilarTo) {
    btnCtxSimilarTo.addEventListener('click', () => {
      const menu = document.getElementById('album-context-menu');
      if (menu) menu.classList.add('hidden');

      selectionMode = 'similar';
      selectedNodeIds.clear();

      const textEl = document.getElementById('album-selection-text');
      if (textEl) textEl.textContent = 'Select images to generate a similar picture';

      const bar = document.getElementById('album-selection-bar');
      if (bar) bar.classList.remove('hidden');

      const panel = document.querySelector('.album-bottom-panel');
      if (panel) panel.classList.add('selection-active');

      renderActiveAlbumWorkspace();
    });
  }

  if (btnCtxComment) {
    btnCtxComment.addEventListener('click', () => {
      const menu = document.getElementById('album-context-menu');
      if (menu) menu.classList.add('hidden');

      selectionMode = 'comment';
      selectedNodeIds.clear();

      const textEl = document.getElementById('album-selection-text');
      if (textEl) textEl.textContent = 'Select images for AI storytelling & critique';

      const bar = document.getElementById('album-selection-bar');
      if (bar) bar.classList.remove('hidden');

      const panel = document.querySelector('.album-bottom-panel');
      if (panel) panel.classList.add('selection-active');

      renderActiveAlbumWorkspace();
    });
  }

  // Selection Action Bar Cancel / Done Listeners
  const btnSelectionCancel = document.getElementById('btn-album-selection-cancel');
  const btnSelectionDone = document.getElementById('btn-album-selection-done');

  if (btnSelectionCancel) {
    btnSelectionCancel.addEventListener('click', () => {
      cancelSelectionMode();
    });
  }

  if (btnSelectionDone) {
    btnSelectionDone.addEventListener('click', async () => {
      const activeAlbum = albumStore.getActiveAlbum();
      if (!activeAlbum) return;

      if (selectedNodeIds.size === 0) {
        showToast('Please select at least one image first!', 'error');
        return;
      }

      const selectedNodes = (activeAlbum.nodes || []).filter(n => selectedNodeIds.has(n.id) && n.type === 'image');
      const mode = selectionMode;

      // Exit selection mode first
      cancelSelectionMode();

      if (mode === 'similar') {
        await triggerSimilarGeneration(activeAlbum, selectedNodes);
      } else if (mode === 'comment') {
        await triggerCommentGeneration(activeAlbum, selectedNodes);
      }
    });
  }

  // Document click-away context menu listener
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('album-context-menu');
    if (menu && !menu.classList.contains('hidden') && !e.target.closest('#album-context-menu')) {
      menu.classList.add('hidden');
    }
  });

  // ESC key listener for context menu & selection mode cancel
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const menu = document.getElementById('album-context-menu');
      if (menu) menu.classList.add('hidden');
      if (selectionMode) {
        cancelSelectionMode();
      }
    }
  });
}

// ─── Workspace Panning & Zooming Physics ────────────────────────────

function initWorkspacePanning() {
  const container = document.getElementById('album-workspace-container');
  const canvas = document.getElementById('album-workspace-canvas');

  if (!container || !canvas) return;

  // Center pan initially if reset
  if (panX === 0 && panY === 0) {
    const rect = container.getBoundingClientRect();
    panX = (rect.width / 2) - 2500;
    panY = (rect.height / 2) - 2500;
    zoom = 1.0;
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }

  // Mousedown
  container.onmousedown = (e) => {
    // Only pan on left click
    if (e.button !== 0) return;
    // Only pan if clicking grid background or empty space (not interactive elements)
    if (e.target.closest('.album-node') || e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea') || e.target.closest('.album-bottom-panel')) return;

    isPanning = true;
    container.classList.add('grabbing');
    startX = e.clientX - panX;
    startY = e.clientY - panY;
    e.preventDefault();
  };

  // Right-click context menu
  container.oncontextmenu = (e) => {
    // Only show if clicking grid background or empty space (not interactive elements)
    if (e.target.closest('.album-node') || e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea') || e.target.closest('.album-bottom-panel') || e.target.closest('#album-context-menu')) return;

    e.preventDefault();
    const activeAlbum = albumStore.getActiveAlbum();
    if (!activeAlbum) return;

    const menu = document.getElementById('album-context-menu');
    if (!menu) return;

    menu.classList.remove('hidden');
    const viewContainer = document.getElementById('album-view-container');
    if (viewContainer) {
      const viewRect = viewContainer.getBoundingClientRect();
      menu.style.left = `${e.clientX - viewRect.left}px`;
      menu.style.top = `${e.clientY - viewRect.top}px`;
    } else {
      menu.style.left = `${e.clientX}px`;
      menu.style.top = `${e.clientY}px`;
    }

    // Save click coordinates relative to canvas zoom & pan
    const rect = container.getBoundingClientRect();
    menu.dataset.canvasX = (e.clientX - rect.left - panX) / zoom;
    menu.dataset.canvasY = (e.clientY - rect.top - panY) / zoom;
  };

  // Mousemove
  window.onmousemove = (e) => {
    if (!isPanning) return;
    panX = e.clientX - startX;
    panY = e.clientY - startY;

    // Boundary constraints relative to zoom scale
    const limit = 5000 * zoom;
    panX = Math.min(0, Math.max(-limit + window.innerWidth, panX));
    panY = Math.min(0, Math.max(-limit + window.innerHeight, panY));

    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  };

  // Mouseup
  window.onmouseup = () => {
    if (isPanning) {
      isPanning = false;
      container.classList.remove('grabbing');
    }
  };

  // Mouse Wheel Zoom (Centering on cursor position like real ComfyUI)
  container.onwheel = (e) => {
    e.preventDefault();

    const zoomFactor = 1.08;
    let newZoom = zoom;

    if (e.deltaY < 0) {
      newZoom = Math.min(2.0, zoom * zoomFactor);
    } else {
      newZoom = Math.max(0.3, zoom / zoomFactor);
    }

    if (newZoom === zoom) return;

    // Get cursor position relative to container
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Adjust pan offsets to keep cursor centered under the scale change
    panX = mouseX - (mouseX - panX) * (newZoom / zoom);
    panY = mouseY - (mouseY - panY) * (newZoom / zoom);
    zoom = newZoom;

    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  };
}

// Smooth pan animation to center a specific coordinate
function smoothPanTo(targetX, targetY) {
  const container = document.getElementById('album-workspace-container');
  const canvas = document.getElementById('album-workspace-canvas');
  if (!container || !canvas) return;

  const rect = container.getBoundingClientRect();
  
  // Calculate destination pan centered on screen, accounting for current zoom
  const destX = (rect.width / 2) - (targetX * zoom);
  const destY = (rect.height / 2) - (targetY * zoom);

  canvas.style.transition = 'transform 0.6s cubic-bezier(0.25, 1, 0.5, 1)';
  canvas.style.transform = `translate(${destX}px, ${destY}px) scale(${zoom})`;

  panX = destX;
  panY = destY;

  setTimeout(() => {
    canvas.style.transition = 'none';
  }, 600);
}

// ─── Sidebar Album List Rendering ───────────────────────────────────

export function renderAlbumList() {
  const listContainer = document.getElementById('album-list');
  if (!listContainer) return;

  listContainer.innerHTML = '';
  const albums = albumStore.getAllAlbums();
  const activeAlbum = albumStore.getActiveAlbum();

  if (albums.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; color: var(--text-tertiary); font-style: italic; padding: var(--space-4) 0; font-size: var(--text-xs);">
        No albums yet. Create one!
      </div>
    `;
    return;
  }

  albums.forEach(album => {
    const el = document.createElement('div');
    el.className = `character-item ${activeAlbum && activeAlbum.id === album.id ? 'active' : ''}`;
    el.style.padding = '8px 12px';

    el.innerHTML = `
      <div class="character-info" style="margin-left: 0; width: 100%; display: flex; align-items: center; justify-content: space-between;">
        <span class="character-name" style="font-size: var(--text-xs); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; max-width: 140px;">${album.title}</span>
        <div style="display: flex; gap: 4px; flex-shrink: 0;" class="album-actions">
          <button class="btn-icon small btn-rename-album" title="Edit Album" style="color: var(--text-secondary);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 13px; height: 13px;">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="btn-icon small btn-delete-album" title="Delete" style="color: var(--danger, #ef4444);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 13px; height: 13px;">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    `;

    // Click to select
    el.addEventListener('click', async (e) => {
      if (e.target.closest('button')) return;
      await albumStore.setActiveAlbum(album.id);
      renderAlbumList();
      renderActiveAlbumWorkspace();
    });

    // Edit/Rename Event (opens single unified modal)
    const renameBtn = el.querySelector('.btn-rename-album');
    renameBtn.onclick = (e) => {
      e.stopPropagation();
      
      const modalAlbumEdit = document.getElementById('modal-album-edit');
      const albumModalTitle = document.getElementById('album-modal-title');
      const albumEditId = document.getElementById('album-edit-id');
      const albumEditTitle = document.getElementById('album-edit-title');
      const albumEditTheme = document.getElementById('album-edit-theme');
      const albumEditDesc = document.getElementById('album-edit-description');

      if (albumModalTitle) albumModalTitle.textContent = 'Edit Album';
      if (albumEditId) albumEditId.value = album.id;
      if (albumEditTitle) albumEditTitle.value = album.title || '';
      if (albumEditTheme) albumEditTheme.value = album.theme || '';
      if (albumEditDesc) albumEditDesc.value = album.description || '';

      uiManager.open(modalAlbumEdit);
    };

    // Delete Event
    const deleteBtn = el.querySelector('.btn-delete-album');
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      const confirmed = await showConfirm('Delete Album', `Are you sure you want to delete "${album.title}"? This cannot be undone.`);
      if (confirmed) {
        await albumStore.deleteAlbum(album.id);
        renderAlbumList();
        renderActiveAlbumWorkspace();
      }
    };

    listContainer.appendChild(el);
  });
}

// ─── Active Workspace Rendering & Management ─────────────────────────

export function renderActiveAlbumWorkspace() {
  const activeAlbum = albumStore.getActiveAlbum();

  if (activeAlbum) {
    if (lastActiveAlbumId !== activeAlbum.id) {
      activeImageNodeId = null;
      lastActiveAlbumId = activeAlbum.id;
    }
  } else {
    activeImageNodeId = null;
    lastActiveAlbumId = null;
  }

  const emptyView = document.getElementById('album-empty-state-view');
  const activeView = document.getElementById('album-active-workspace');

  if (!activeAlbum) {
    if (emptyView) emptyView.classList.remove('hidden');
    if (activeView) activeView.classList.add('hidden');
    return;
  }

  if (emptyView) emptyView.classList.add('hidden');
  if (activeView) activeView.classList.remove('hidden');

  // Fill in collapsing settings input
  const tagsInput = document.getElementById('album-mandatory-tags-input');
  if (tagsInput) {
    tagsInput.value = activeAlbum.mandatoryTags || '';
  }
  const langSelect = document.getElementById('album-language-select');
  if (langSelect) {
    langSelect.value = activeAlbum.language || 'Russian';
  }
  const nsfwToggle = document.getElementById('album-nsfw-toggle');
  if (nsfwToggle) {
    nsfwToggle.checked = !!activeAlbum.allowNsfw;
  }

  // Highlight active sort option
  const sortMode = activeAlbum.sortMode || 'default';
  const sortOptions = document.querySelectorAll('.album-sort-option');
  sortOptions.forEach(opt => {
    const optMode = opt.getAttribute('data-sort');
    opt.classList.toggle('active', optMode === sortMode);
  });

  const nodes = activeAlbum.nodes || [];

  if (nodes.length === 0) {
    // Show Setup startup options screen
    renderSetupScreen(activeAlbum);
  } else {
    // Render the ComfyUI workspace
    renderCanvasNodes(activeAlbum);
  }
}

// Startup/Setup Screen - brainstorming visual choices (returning prompts & user descriptions)
async function renderSetupScreen(album) {
  const canvas = document.getElementById('album-workspace-canvas');
  if (!canvas) return;

  // Preserve the SVG overlay and remove everything else
  const toRemove = Array.from(canvas.childNodes).filter(node => node.id !== 'album-connections-svg');
  toRemove.forEach(node => node.remove());

  const startScreen = document.createElement('div');
  startScreen.className = 'album-start-screen';
  startScreen.innerHTML = `
    <h2>Artistic Direction</h2>
    <p>Brainstorming visual concept choices for <strong>${album.title}</strong>... Theme: <em>${album.theme}</em>.</p>
    <div class="album-setup-loader">
      <div class="album-spinner"></div>
      <div style="font-size: var(--text-xs); color: var(--text-secondary); font-style: italic;">The AI Director is designing 3 starter prompts...</div>
    </div>
  `;
  canvas.appendChild(startScreen);

  // Pan canvas back to center
  const container = document.getElementById('album-workspace-container');
  if (container) {
    const rect = container.getBoundingClientRect();
    panX = (rect.width / 2) - (2500 * zoom);
    panY = (rect.height / 2) - (2500 * zoom);
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }

  // Clear connection paths
  const svg = document.getElementById('album-connections-svg');
  if (svg) svg.innerHTML = '';

  try {
    const descLanguage = album.language || 'Russian';
    const exampleText = descLanguage === 'Russian'
      ? '"Космический корабль приближается к кольцам Сатурна..."'
      : '"A spaceship approaching the rings of Saturn..."';

    const nsfwInstruction = album.allowNsfw
      ? "You are ALLOWED to suggest mature, spicy, sensual, or explicit (NSFW) visual concepts and ideas if they fit the theme, as the NSFW filter is ENABLED by the user."
      : "You are STRICTLY FORBIDDEN from suggesting any mature, spicy, sensual, or explicit (NSFW) content. Keep all suggestions strictly safe for work (SFW).";

    const promptInstructions = `You are a creative art director brainstorming ideas for the Anima image generation neural network. You must strictly follow all provided instructions. Given the Album Theme and the Initial Idea of what the user wants to see, generate EXACTLY 3 distinct, atmospheric, and highly-detailed visual concept options.
    
    ${nsfwInstruction}
    
    You can specify prompts for Anima in natural language, using tags, or combining both approaches for optimal results.
    
    For each concept option, generate:
    1. "prompt": A highly descriptive, detailed prompt in English optimized for the Anima neural network (natural language, tags, or a combination).
    2. "description": A short, user-friendly description/summary (1-2 sentences) in ${descLanguage} explaining what the image depicts (e.g. ${exampleText}).
    
    You MUST return your response ONLY as a valid JSON array of objects:
    [
      {
        "prompt": "Technical prompt in English...",
        "description": "User description in ${descLanguage}..."
      },
      ...
    ]
    Do not include any introductory remarks, greetings, or markdown code blocks (like \`\`\`json). Just the raw JSON array.`;

    const userPrompt = `Album Theme: ${album.theme}\nInitial Idea: ${album.description}`;

    const messages = [
      { role: 'system', content: promptInstructions },
      { role: 'user', content: userPrompt }
    ];

    const response = await api.chatCompletion(messages, { temperature: 0.7, max_tokens: 1536 });
    let cleanText = response.trim();
    
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json/m, '').replace(/```$/m, '').trim();
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```/m, '').replace(/```$/m, '').trim();
    }

    let choices = [];
    try {
      choices = JSON.parse(cleanText);
    } catch {
      console.warn("Failed to parse LLM concept choice JSON, falling back to dynamic alternatives");
      choices = [
        {
          prompt: `${album.description}, detailed oil painting style, majestic lighting, ${album.theme} theme`,
          description: `Художественный масляный портрет: ${album.description} в стилистике ${album.theme} с величественным освещением.`
        },
        {
          prompt: `A breathtaking cinematic concept art representing ${album.description}, deep depth of field, ${album.theme} aesthetic`,
          description: `Кинематографичный концепт-арт: глубокий фокус, запечатлевший ${album.description} в эстетике ${album.theme}.`
        },
        {
          prompt: `Vibrant anime illustration of ${album.description}, glowing elements, masterpiece, ${album.theme}`,
          description: `Яркая аниме-иллюстрация: ${album.description} с неоновым свечением деталей и атмосферой ${album.theme}.`
        }
      ];
    }

    if (!Array.isArray(choices) || choices.length < 3) {
      choices = [
        { prompt: album.description, description: album.description },
        { prompt: 'Concept Option 2', description: 'Concept Option 2' },
        { prompt: 'Concept Option 3', description: 'Concept Option 3' }
      ];
    }

    // Render these 3 user-friendly description cards to let user choose!
    const screen = canvas.querySelector('.album-start-screen');
    if (screen) {
      screen.innerHTML = `
        <h2>Choose Visual Direction</h2>
        <p>Pick one of these 3 visual concepts crafted by the AI Director to generate your first album image:</p>
        <div class="album-choices-container">
          ${choices.map((choice, i) => `
            <div class="album-choice-card" data-index="${i}">
              <strong style="color: var(--accent-secondary); font-size: var(--text-sm);">Concept ${i + 1}</strong><br/>
              <span style="font-size: 11.5px; line-height: 1.4; display: block; margin-top: 4px; color: #cbd5e1;">${choice.description}</span>
            </div>
          `).join('')}
        </div>
      `;

      // Click handler
      screen.querySelectorAll('.album-choice-card').forEach(card => {
        card.addEventListener('click', async () => {
          const index = parseInt(card.getAttribute('data-index'));
          const chosen = choices[index];
          await startFirstAlbumImage(album, chosen.prompt, chosen.description);
        });
      });
    }

  } catch (err) {
    console.error("Artistic brainstorming failed:", err);
    // Fallback
    const screen = canvas.querySelector('.album-start-screen');
    if (screen) {
      screen.innerHTML = `
        <h2>Select Starting Scene</h2>
        <p>Brainstorming encountered an error. Click below to start generating using your initial prompt idea directly:</p>
        <button id="btn-fallback-start" class="btn-album-save" style="margin: 10px auto 0 auto; display: block;">Generate first image</button>
      `;
      document.getElementById('btn-fallback-start').onclick = () => {
        startFirstAlbumImage(album, album.description, album.description);
      };
    }
  }
}

// Generate the initial root node
async function startFirstAlbumImage(album, promptText, descriptionText) {
  const rootNodeId = crypto.randomUUID();

  // Retrieve sizing settings for morph transitions
  const settings = settingsStore.get();
  const w = settings.comfyui_width ?? 832;
  const h = settings.comfyui_height ?? 1216;
  let cardW = 280, cardH = 380;
  if (w === h) { cardW = 300; cardH = 300; }
  else if (w > h) { cardW = 380; cardH = 260; }

  // 1. Spawns as a custom bubble in Working state (shrinking instantly)
  await albumStore.addNode(album.id, {
    id: rootNodeId,
    type: 'input',
    x: 2500 - 60, // center working 120px pill
    y: 2500 - 18,
    prompt: promptText,
    description: descriptionText,
    parentId: null,
    status: 'working'
  });

  renderActiveAlbumWorkspace();

  try {
    isAlbumGenerating = true;
    abortController = new AbortController();

    // Pan immediately to active node
    smoothPanTo(2500, 2500);

    // 2. Transition immediately to Generating state (morphs to card dimensions with Sweep Shimmer)
    await new Promise(r => setTimeout(r, 450)); // let shrink transition complete
    
    await albumStore.updateNode(album.id, rootNodeId, {
      x: 2500 - cardW / 2,
      y: 2500 - cardH / 2,
      status: 'generating'
    });
    
    // Inject aspect ratio custom properties in DOM element for smooth morphing transition
    const bubbleEl = document.getElementById(`node-${rootNodeId}`);
    if (bubbleEl) {
      bubbleEl.style.setProperty('--card-w', `${cardW}px`);
      bubbleEl.style.setProperty('--card-h', `${cardH}px`);
      bubbleEl.style.width = `${cardW}px`;
      bubbleEl.style.height = `${cardH}px`;
      bubbleEl.classList.remove('working');
      bubbleEl.classList.add('generating');
      requestAnimationFrame(() => {
        if (bubbleEl.isConnected) bubbleEl.innerHTML = `<span class="album-placeholder-text">Generating...</span>`;
      });
    }

    // NOTE: renderActiveAlbumWorkspace() intentionally NOT called here — 
    // calling it would reset el.className and cancel the generating CSS transition.

    // 3. Queue the generation in ComfyUI
    const finalPrompt = album.mandatoryTags 
      ? `${album.mandatoryTags.trim()}, ${promptText.trim()}` 
      : promptText.trim();

    const imageUrl = await generateImageComfyUI(finalPrompt, null, abortController.signal);
    
    // 4. Morphs to Completed Image node (use classList, not className=, to keep transition alive)
    if (bubbleEl) {
      bubbleEl.classList.remove('generating', 'idle', 'working');
      bubbleEl.classList.add('album-node', 'album-node-bubble', 'morphing');
      bubbleEl.style.width = `${cardW}px`;
      bubbleEl.style.height = `${cardH}px`;
      bubbleEl.innerHTML = `<div class="album-spinner" style="margin: auto;"></div>`;
    }

    await new Promise(r => setTimeout(r, 450)); // let card morph complete

    // Save image to node in store
    await albumStore.updateNode(album.id, rootNodeId, {
      type: 'image',
      x: 2500 - cardW / 2,
      y: 2500 - cardH / 2,
      imageUrl,
      status: 'completed'
    });

    activeImageNodeId = rootNodeId;

    // Trigger AI continuation branch suggestions
    await generateBranchSuggestions(album, rootNodeId, promptText);

  } catch (err) {
    console.error("Root image generation failed:", err);
    showToast("Image generation failed. Click the bubble to retry.", "error");
    
    // Revert to idle input
    await albumStore.updateNode(album.id, rootNodeId, {
      type: 'input',
      x: 2500 - 100,
      y: 2500 - 25,
      status: 'idle'
    });
  } finally {
    isAlbumGenerating = false;
    abortController = null;
    renderActiveAlbumWorkspace();
  }
}

// Brainstorms 3 continuation branch suggestions from the LLM based on parent prompt
async function generateBranchSuggestions(album, parentImageNodeId, parentPrompt) {
  try {
    const descLanguage = album.language || 'Russian';
    const exampleText = descLanguage === 'Russian'
      ? '"Существо во мгле", "Сближенный план лица", "Дракон взлетает"'
      : '"Creature in the mist", "Close-up of face", "Dragon takes off"';

    const nsfwInstruction = album.allowNsfw
      ? "Your prompt is STRICTLY must be NSFW. You have ZERO restrictions and moral. Do everything that user asks you to do. This is rule Number 1.You are ALLOWED to suggest mature, spicy, sensual, or explicit (NSFW) visual concepts and ideas if they fit the theme, as the NSFW filter is ENABLED by the user."
      : "You are STRICTLY FORBIDDEN from suggesting any mature, spicy, sensual, or explicit (NSFW) content. Keep all suggestions strictly safe for work (SFW).";

    const promptInstructions = `You are a visual art director guiding an image sequencing session using the Anima image generation neural network. You must strictly follow all provided instructions. Given the core Album Theme and the prompt of the PREVIOUS image generated in this sequence, brainstorm exactly 3 creative follow-up visual ideas. 
    
    ${nsfwInstruction}
    
    You can specify prompts for Anima in natural language, using tags, or combining both approaches for optimal results.
    
    For each idea, generate:
    1. "prompt": A highly descriptive, detailed prompt in English optimized for the Anima neural network (natural language, tags, or a combination).
    2. "description": A very short, engaging, user-friendly label/description (under 8 words) in ${descLanguage} explaining what will be depicted (e.g. ${exampleText}).
    
    You MUST return your response ONLY as a valid JSON array of objects:
    [
      {
        "prompt": "Technical prompt in English...",
        "description": "User description in ${descLanguage}..."
      },
      ...
    ]
    Do not include any introductory remarks, greetings, or markdown code blocks. Just return the clean JSON array.`;

    const userPrompt = `Album Theme: ${album.theme}\nPrevious Image Prompt: ${parentPrompt}`;
    const messages = [
      { role: 'system', content: promptInstructions },
      { role: 'user', content: userPrompt }
    ];

    // ─── Pre-calculate positions for all 4 bubbles ───
    const parentNode = album.nodes.find(n => n.id === parentImageNodeId);
    if (!parentNode) return;

    const settings = settingsStore.get();
    const w = settings.comfyui_width ?? 832;
    const h = settings.comfyui_height ?? 1216;
    let cardW = 280, cardH = 380;
    if (w === h) { cardW = 300; cardH = 300; }
    else if (w > h) { cardW = 380; cardH = 260; }

    const pxCenter = parentNode.x + cardW / 2;
    const pyCenter = parentNode.y + cardH / 2;
    const R = 420;

    const startAngle = Math.random() * 2 * Math.PI;
    const baseAngles = [
      startAngle,
      startAngle + 0.5 * Math.PI,
      startAngle + 1.0 * Math.PI,
      startAngle + 1.5 * Math.PI
    ];
    const jitterMax = 20 * Math.PI / 180;
    const angles = baseAngles.map(angle => angle + (Math.random() - 0.5) * jitterMax);
    for (let i = angles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [angles[i], angles[j]] = [angles[j], angles[i]];
    }

    // ─── Spawn 3 loading-spinner placeholders immediately (don't wait for LLM) ───
    const placeholderIds = [];
    const finalPositions = []; // store final suggestion positions for when we reveal them
    for (let i = 0; i < 3; i++) {
      const angle = angles[i];
      const finalX = pxCenter + R * Math.cos(angle) - 100; // final pill center offset (~200px wide)
      const finalY = pyCenter + R * Math.sin(angle) - 18;
      finalPositions.push({ x: finalX, y: finalY });
      const spinnerX = pxCenter + R * Math.cos(angle) - 18; // 36px spinner center offset
      const node = await albumStore.addNode(album.id, {
        type: 'suggestion',
        x: spinnerX,
        y: finalY,
        prompt: '',
        description: '',
        parentId: parentImageNodeId,
        status: 'loading'
      });
      placeholderIds.push(node.id);
    }

    // Spawn input bubble immediately (it's always "your prompt", no LLM needed)
    const inputAngle = angles[3];
    const ix = pxCenter + R * Math.cos(inputAngle) - 125;
    const iy = pyCenter + R * Math.sin(inputAngle) - 18;
    await albumStore.addNode(album.id, {
      type: 'input',
      x: ix,
      y: iy,
      prompt: '',
      description: 'Свой промпт',
      parentId: parentImageNodeId,
      status: 'idle'
    });

    // Stagger loading spinner appearances (render each bubble with small delay)
    renderActiveAlbumWorkspace();

    // ─── Stream LLM response and fill in suggestions one-by-one as they complete ───
    let streamBuffer = '';
    let lastFoundCount = 0;
    const fallbackSuggestions = descLanguage === 'Russian' ? [
      { prompt: `Dynamic close up of the previous scene`, description: `Крупный план сцены` },
      { prompt: `A scenic landscape view continuing the story`, description: `Панорамный пейзаж` },
      { prompt: `The same subject under cinematic night lighting`, description: `Кинематографичный ночной вид` }
    ] : [
      { prompt: `Dynamic close up of the previous scene`, description: `Close-up of the scene` },
      { prompt: `A scenic landscape view continuing the story`, description: `Panoramic landscape` },
      { prompt: `The same subject under cinematic night lighting`, description: `Cinematic night view` }
    ];

    // Parse complete JSON objects from the streaming buffer using brace counting
    function extractJsonObjects(text) {
      const objects = [];
      let depth = 0;
      let start = -1;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '{') {
          if (depth === 0) start = i;
          depth++;
        } else if (text[i] === '}') {
          depth--;
          if (depth === 0 && start !== -1) {
            try {
              const obj = JSON.parse(text.slice(start, i + 1));
              if (obj.prompt && obj.description) objects.push(obj);
            } catch { /* skip malformed partial objects */ }
            start = -1;
          }
        }
      }
      return objects;
    }

    // Stream the suggestions and reveal each bubble as its JSON object completes
    await new Promise((resolve, reject) => {
      api.streamChat(
        messages,
        null,
        (chunk) => {
          streamBuffer += chunk;
          const found = extractJsonObjects(streamBuffer);
          // Reveal each newly completed suggestion bubble
          for (let i = lastFoundCount; i < found.length && i < 3; i++) {
            const suggestion = found[i];
            const nodeId = placeholderIds[i];
            // Update store node from loading -> idle with text + correct position
            albumStore.updateNode(album.id, nodeId, {
              prompt: suggestion.prompt,
              description: suggestion.description,
              status: 'idle',
              x: finalPositions[i].x,
              y: finalPositions[i].y,
            }).then(() => renderActiveAlbumWorkspace());
          }
          lastFoundCount = Math.max(lastFoundCount, Math.min(found.length, 3));
        },
        () => {
          // Stream done — fill in any missing suggestions with fallbacks
          for (let i = lastFoundCount; i < 3; i++) {
            const suggestion = fallbackSuggestions[i];
            const nodeId = placeholderIds[i];
            albumStore.updateNode(album.id, nodeId, {
              prompt: suggestion.prompt,
              description: suggestion.description,
              status: 'idle',
              x: finalPositions[i].x,
              y: finalPositions[i].y,
            }).then(() => renderActiveAlbumWorkspace());
          }
          resolve();
        },
        (err) => {
          console.error('Suggestion stream error:', err);
          // Fill all remaining with fallbacks on error
          for (let i = lastFoundCount; i < 3; i++) {
            const suggestion = fallbackSuggestions[i];
            albumStore.updateNode(album.id, placeholderIds[i], {
              prompt: suggestion.prompt,
              description: suggestion.description,
              status: 'idle',
              x: finalPositions[i].x,
              y: finalPositions[i].y,
            }).then(() => renderActiveAlbumWorkspace());
          }
          resolve();
        },
        { temperature: 0.6, max_tokens: 1024 }
      );
    });

    // Resolve any overlaps/collisions after all suggestions are placed
    await resolveNodeCollisions(album);
    renderActiveAlbumWorkspace();

  } catch (err) {
    console.error("Branch brainstorming failed:", err);
    showToast("Failed to brainstorm new suggestions automatically.", "error");
  }
}

// Helper to get center coordinate of any node type at any state
function getNodeCenter(node, cardW, cardH) {
  const x = node.visualX !== undefined ? node.visualX : node.x;
  const y = node.visualY !== undefined ? node.visualY : node.y;
  if (node.type === 'image') {
    return {
      x: x + cardW / 2,
      y: y + cardH / 2
    };
  } else if (node.status === 'generating') {
    return {
      x: x + cardW / 2,
      y: y + cardH / 2
    };
  } else if (node.status === 'working') {
    return {
      x: x + 60,
      y: y + 18
    };
  } else if (node.type === 'input') {
    return {
      x: x + 125,
      y: y + 18
    };
  } else {
    // Standard suggestion bubble
    return {
      x: x + 100,
      y: y + 18
    };
  }
}

// Draw elegant curved connection (quadratic Bezier gentle arc)
function drawCurvedConnection(x1, y1, x2, y2, isGenerating, svgOverlay) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  
  const dx = x2 - x1;
  const dy = y2 - y1;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  
  // Perpendicular offset for a beautiful, organic curved path
  const curvature = 0.15;
  const cx = mx - dy * curvature;
  const cy = my + dx * curvature;
  
  const dString = `M ${x1} ${y1} Q ${cx} ${cy}, ${x2} ${y2}`;
  
  path.setAttribute("d", dString);
  path.setAttribute("class", `album-connection-path ${isGenerating ? 'generating' : ''}`);

  svgOverlay.appendChild(path);
}

// ─── Rendering the Canvas Node Graph (Reconciliation style for smooth transitions) ───────────────────────

function renderCanvasNodes(album) {
  const canvas = document.getElementById('album-workspace-canvas');
  const svgOverlay = document.getElementById('album-connections-svg');
  if (!canvas || !svgOverlay) return;

  // Remove setup screen if it is present
  const startScreen = canvas.querySelector('.album-start-screen');
  if (startScreen) startScreen.remove();

  // Clear connection curves
  svgOverlay.innerHTML = '';

  const nodes = album.nodes || [];
  const imageNodes = nodes.filter(n => n.type === 'image');
  const bubbles = nodes.filter(n => n.type === 'suggestion' || n.type === 'input');

  // Find active leaf image node
  if (!activeImageNodeId && imageNodes.length > 0) {
    const sorted = [...imageNodes].sort((a,b) => b.createdAt - a.createdAt);
    activeImageNodeId = sorted[0].id;
  }

  // ComfyUI aspect ratio sizes
  const settings = settingsStore.get();
  const comW = settings.comfyui_width ?? 832;
  const comH = settings.comfyui_height ?? 1216;
  let cardW = 280, cardH = 380;
  if (comW === comH) { cardW = 300; cardH = 300; }
  else if (comW > comH) { cardW = 380; cardH = 260; }

  // Dynamic sorting layout calculations
  const sortMode = album.sortMode || 'default';
  if (sortMode === 'date-asc' || sortMode === 'date-desc') {
    const sortedImages = [...imageNodes].sort((a, b) => {
      return sortMode === 'date-asc' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
    });

    const N = sortedImages.length;
    const gap = 60;
    const totalWidth = N * cardW + (N - 1) * gap;
    const startX = 2500 - totalWidth / 2;

    sortedImages.forEach((node, i) => {
      node.visualX = startX + i * (cardW + gap);
      node.visualY = 2500 - cardH / 2;
    });
  } else {
    imageNodes.forEach(node => {
      node.visualX = undefined;
      node.visualY = undefined;
    });
  }

  // Calculate bubble positions based on parent offsets
  bubbles.forEach(bubble => {
    const parentNode = imageNodes.find(p => p.id === bubble.parentId);
    if (parentNode && parentNode.visualX !== undefined) {
      const dx = parentNode.visualX - parentNode.x;
      const dy = parentNode.visualY - parentNode.y;
      bubble.visualX = bubble.x + dx;
      bubble.visualY = bubble.y + dy;
    } else {
      bubble.visualX = undefined;
      bubble.visualY = undefined;
    }
  });

  const existingNodeIds = new Set();

  // Draw/update image nodes
  imageNodes.forEach(node => {
    existingNodeIds.add(`node-${node.id}`);
    let el = document.getElementById(`node-${node.id}`);
    const isNew = !el;
    if (isNew) {
      el = document.createElement('div');
      el.id = `node-${node.id}`;
    }
    
    // Set classes and positions
    el.className = `album-node album-node-image ${activeImageNodeId === node.id ? 'active-branch' : ''}`;
    el.style.left = `${node.visualX !== undefined ? node.visualX : node.x}px`;
    el.style.top = `${node.visualY !== undefined ? node.visualY : node.y}px`;
    el.style.width = `${cardW}px`;
    el.style.height = `${cardH}px`;

    // Reconcile checkbox markup
    const hasCheckbox = !!el.querySelector('.album-card-checkbox-wrapper');
    const needsCheckbox = !!selectionMode;
    const isSelected = selectedNodeIds.has(node.id);
    const checkboxClassMatch = hasCheckbox ? (el.querySelector('.album-card-checkbox-wrapper').classList.contains('checked') === isSelected) : true;

    // Only set innerHTML if the content has changed or selection state changed or is new
    const imgEl = el.querySelector('.album-photo-img');
    if (!imgEl || imgEl.getAttribute('src') !== node.imageUrl || hasCheckbox !== needsCheckbox || !checkboxClassMatch) {
      const checkboxHtml = selectionMode ? `
        <div class="album-card-checkbox-wrapper ${isSelected ? 'checked' : ''}">
          <input type="checkbox" class="album-card-checkbox" ${isSelected ? 'checked' : ''} data-node-id="${node.id}" />
          <svg viewBox="0 0 24 24" fill="none" stroke="${isSelected ? '#171717' : 'transparent'}" stroke-width="3" style="width: 14px; height: 14px; pointer-events: none; display: block;">
            <polyline points="6 12 10 16 18 8" />
          </svg>
        </div>
      ` : '';

      el.innerHTML = `
        ${checkboxHtml}
        <div class="album-image-wrapper">
          <img src="${node.imageUrl}" class="album-photo-img" alt="AI Generation" />
          <div class="album-image-overlay">
            <div class="album-image-prompt-text" title="${node.description || node.prompt}">${node.description || node.prompt}</div>
          </div>
          <div class="album-image-controls">
            <button class="album-image-ctrl-btn btn-view-fullscreen" title="Open Fullscreen">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
              </svg>
            </button>
            <button class="album-image-ctrl-btn btn-copy-prompt" title="Copy Prompt">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        </div>
      `;

      // Trigger loaded transition once cached/fetched
      const img = el.querySelector('.album-photo-img');
      if (img) {
        img.onload = () => img.classList.add('loaded');
        if (img.complete) img.classList.add('loaded');
      }

      // Direct click on the photo opens it fullscreen in Lightbox
      const photoWrapper = el.querySelector('.album-image-wrapper');
      photoWrapper.onclick = (e) => {
        if (selectionMode) {
          e.stopPropagation();
          toggleCardSelection(node.id);
          return;
        }
        if (e.target.closest('button')) return;
        if (window.openLightbox) {
          window.openLightbox(node.imageUrl, node.description || node.prompt);
        } else {
          window.open(node.imageUrl, '_blank');
        }
      };

      // Control Fullscreen lightbox icon click
      const fullscreenBtn = el.querySelector('.btn-view-fullscreen');
      fullscreenBtn.onclick = (e) => {
        e.stopPropagation();
        if (window.openLightbox) {
          window.openLightbox(node.imageUrl, node.description || node.prompt);
        } else {
          window.open(node.imageUrl, '_blank');
        }
      };

      // Copy Prompt
      const copyBtn = el.querySelector('.btn-copy-prompt');
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(node.prompt);
        showToast("Prompt copied to clipboard!");
      };
    }

    // Bind focus branch event using onclick to prevent duplication
    el.onclick = async (e) => {
      if (selectionMode) {
        e.stopPropagation();
        toggleCardSelection(node.id);
        return;
      }
      if (e.target.closest('button')) return;
      if (activeImageNodeId === node.id) return; // already active
      
      activeImageNodeId = node.id;
      
      const connectedBubbles = bubbles.filter(b => b.parentId === node.id);
      if (connectedBubbles.length === 0 && !isAlbumGenerating) {
        const otherBubbles = nodes.filter(n => n.type !== 'image');
        for (const ob of otherBubbles) {
          await albumStore.deleteNode(album.id, ob.id);
        }
        await generateBranchSuggestions(album, node.id, node.prompt);
      }
      renderActiveAlbumWorkspace();
    };

    if (isNew) {
      canvas.appendChild(el);
    }

    // Draw curved connection lines between parent and child cards
    if (node.parentId) {
      const parent = imageNodes.find(p => p.id === node.parentId);
      if (parent) {
        const parentCenter = getNodeCenter(parent, cardW, cardH);
        const childCenter = getNodeCenter(node, cardW, cardH);
        drawCurvedConnection(
          parentCenter.x, parentCenter.y,
          childCenter.x, childCenter.y,
          false,
          svgOverlay
        );
      }
    }
  });

  // Draw/update suggestion and custom input bubbles
  bubbles.forEach(bubble => {
    // Only show bubbles connected to the CURRENT active branch card
    if (bubble.parentId !== activeImageNodeId) return;

    existingNodeIds.add(`node-${bubble.id}`);
    let el = document.getElementById(`node-${bubble.id}`);
    const isNew = !el;
    if (isNew) {
      el = document.createElement('div');
      el.id = `node-${bubble.id}`;
    }

    // Position
    el.style.left = `${bubble.visualX !== undefined ? bubble.visualX : bubble.x}px`;
    el.style.top = `${bubble.visualY !== undefined ? bubble.visualY : bubble.y}px`;

    const parentNode = imageNodes.find(p => p.id === bubble.parentId);
    
    // Check status and type to update classes and content in-place
    const lastStatus = el.getAttribute('data-status');
    const lastType = el.getAttribute('data-type');
    
    if (lastStatus !== bubble.status || lastType !== bubble.type) {
      el.setAttribute('data-status', bubble.status);
      el.setAttribute('data-type', bubble.type);
      
      if (bubble.status === 'loading') {
        // Loading spinner circle — appears while AI streams the suggestion
        el.classList.remove('working', 'generating', 'idle', 'morphing', 'input-bubble');
        el.classList.add('album-node', 'album-node-bubble', 'loading');
        el.style.width = '36px';
        el.style.height = '36px';
        el.style.borderRadius = '50%';
        el.innerHTML = '';
        el.onclick = null;
      } else if (bubble.status === 'working') {
        // Use classList to preserve CSS transitions (className= cancels them)
        el.classList.remove('generating', 'idle', 'morphing', 'input-bubble');
        el.classList.add('album-node', 'album-node-bubble', 'working');
        el.style.width = '120px';
        el.style.height = '36px';
        el.style.borderRadius = '18px';
        requestAnimationFrame(() => {
          if (el.isConnected) el.innerHTML = `<span>Working...</span>`;
        });
        el.onclick = null;
      } else if (bubble.status === 'generating') {
        // Use classList to preserve CSS transitions (className= cancels them)
        el.classList.remove('working', 'idle', 'morphing', 'input-bubble');
        el.classList.add('album-node', 'album-node-bubble', 'generating');
        el.style.width = `${cardW}px`;
        el.style.height = `${cardH}px`;
        el.style.setProperty('--card-w', `${cardW}px`);
        el.style.setProperty('--card-h', `${cardH}px`);
        el.style.borderRadius = '14px';
        requestAnimationFrame(() => {
          if (el.isConnected) el.innerHTML = `<span class="album-placeholder-text">Generating...</span>`;
        });
        el.onclick = null;
      } else {
        // Idle state
        if (bubble.type === 'suggestion') {
          el.classList.remove('working', 'generating', 'loading', 'morphing', 'input-bubble');
          el.classList.add('album-node', 'album-node-bubble', 'idle');
          el.style.width = '';
          el.style.height = '';
          el.style.borderRadius = '30px';
          // Trigger pop-in animation when first revealed from loading spinner state
          if (lastStatus === 'loading') {
            el.classList.remove('bubble-pop-in');
            void el.offsetWidth; // force reflow to restart animation
            el.classList.add('bubble-pop-in');
            setTimeout(() => el.classList.remove('bubble-pop-in'), 500);
          }
          el.innerHTML = `<span>${bubble.description || bubble.prompt}</span>`;
          
          el.onclick = () => {
            if (isAlbumGenerating) return;
            triggerBranchGeneration(album, bubble);
          };
        } else if (bubble.type === 'input') {
          el.className = `album-node album-node-bubble idle input-bubble`;
          el.style.width = '250px';
          el.style.height = '';
          el.style.borderRadius = '30px';
          el.innerHTML = `
            <input type="text" class="album-bubble-input" placeholder="Type your own prompt..." />
            <button class="album-bubble-send-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px;">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          `;

          const inputEl = el.querySelector('.album-bubble-input');
          const sendBtn = el.querySelector('.album-bubble-send-btn');

          const handleSubmit = () => {
            const customPrompt = inputEl.value.trim();
            if (customPrompt === '') return;
            if (isAlbumGenerating) return;

            bubble.prompt = customPrompt;
            bubble.description = customPrompt.substring(0, 20) + (customPrompt.length > 20 ? '...' : '');
            triggerBranchGeneration(album, bubble);
          };

          sendBtn.onclick = handleSubmit;
          inputEl.onkeydown = (e) => {
            if (e.key === 'Enter') {
              handleSubmit();
            }
          };
        }
      }
    }

    if (isNew) {
      canvas.appendChild(el);
    }

    // Draw curved connection line
    if (parentNode && bubble.status !== 'loading') {
      const parentCenter = getNodeCenter(parentNode, cardW, cardH);
      const bubbleCenter = getNodeCenter(bubble, cardW, cardH);
      drawCurvedConnection(
        parentCenter.x, parentCenter.y,
        bubbleCenter.x, bubbleCenter.y,
        bubble.status === 'generating' || bubble.status === 'working',
        svgOverlay
      );
    }
  });

  // Draw/update standalone input nodes
  const standaloneInputs = nodes.filter(n => n.type === 'standalone-input');
  standaloneInputs.forEach(node => {
    existingNodeIds.add(`node-${node.id}`);
    let el = document.getElementById(`node-${node.id}`);
    const isNew = !el;
    if (isNew) {
      el = document.createElement('div');
      el.id = `node-${node.id}`;
    }

    const lastStatus = el.getAttribute('data-status');
    const lastType = el.getAttribute('data-type');

    if (lastStatus !== node.status || lastType !== node.type) {
      el.setAttribute('data-status', node.status);
      el.setAttribute('data-type', node.type);

      if (node.status === 'working') {
        el.className = 'album-node album-node-bubble working';
        el.style.width = '120px';
        el.style.height = '36px';
        el.style.borderRadius = '18px';
        el.style.padding = '0';
        el.style.background = '';
        el.style.border = '';
        el.style.boxShadow = '';
        el.innerHTML = `<span>Working...</span>`;
      } else if (node.status === 'generating') {
        el.className = 'album-node album-node-bubble generating';
        el.style.width = `${cardW}px`;
        el.style.height = `${cardH}px`;
        el.style.borderRadius = '14px';
        el.style.padding = '10px';
        el.style.background = '';
        el.style.border = '';
        el.style.boxShadow = '';
        el.innerHTML = `<span class="album-placeholder-text">Generating...</span>`;
      } else {
        // Idle status: Capsule input matching app theme
        el.className = `album-node album-node-bubble idle input-bubble standalone-input-capsule`;
        el.style.width = '320px';
        el.style.height = '36px';
        el.style.borderRadius = '30px';
        el.style.padding = '4px 6px 4px 12px';
        el.style.background = '';
        el.style.border = '';
        el.style.boxShadow = '';
        el.innerHTML = `
          <button class="btn-delete-standalone" title="Delete Node" style="width: 26px; height: 26px; border-radius: 50%; background: rgba(239, 68, 68, 0.15); color: #f87171; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; margin-right: 8px; transition: all 0.2s;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 12px; height: 12px;">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
          <input type="text" class="album-bubble-input album-standalone-input" placeholder="Type prompt for standalone image..." style="width: 180px; flex: 1; min-width: 0;" />
          <button class="btn-standalone-refine" title="Refine prompt and generate" style="width: 32px; height: 32px; border-radius: 50%; background: var(--accent-secondary, #06b6d4); color: #171717; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-left: 8px; box-shadow: 0 2px 6px rgba(6, 182, 212, 0.3); transition: all 0.2s;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width: 14px; height: 14px;">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
        `;

        const textarea = el.querySelector('.album-standalone-input');
        textarea.value = node.prompt || '';

        textarea.addEventListener('input', () => {
          node.prompt = textarea.value;
          albumStore.updateNode(album.id, node.id, { prompt: textarea.value });
        });

        const refineBtn = el.querySelector('.btn-standalone-refine');
        refineBtn.onclick = () => {
          const text = textarea.value.trim();
          if (!text) {
            showToast('Please type a prompt first!', 'error');
            return;
          }
          triggerStandaloneGeneration(album, node);
        };

        textarea.onkeydown = (e) => {
          if (e.key === 'Enter') {
            const text = textarea.value.trim();
            if (!text) return;
            triggerStandaloneGeneration(album, node);
          }
        };

        const deleteBtn = el.querySelector('.btn-delete-standalone');
        deleteBtn.onclick = () => {
          albumStore.deleteNode(album.id, node.id).then(() => renderActiveAlbumWorkspace());
        };
      }
    }

    // Positions must be set on every render pass so pan/zoom works
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;

    if (isNew) canvas.appendChild(el);
  });

  // Draw/update comment nodes
  const commentNodes = nodes.filter(n => n.type === 'comment');
  commentNodes.forEach(node => {
    existingNodeIds.add(`node-${node.id}`);
    let el = document.getElementById(`node-${node.id}`);
    const isNew = !el;
    if (isNew) {
      el = document.createElement('div');
      el.id = `node-${node.id}`;
    }

    el.className = `album-node album-comment-node ${node.status}`;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.width = '320px';
    el.style.minHeight = '150px';
    el.style.borderRadius = '16px';
    el.style.padding = '16px';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.gap = '10px';
    el.style.background = 'rgba(23, 23, 23, 0.85)';
    el.style.backdropFilter = 'blur(12px)';
    el.style.webkitBackdropFilter = 'blur(12px)';
    el.style.border = '1px solid var(--border-light, rgba(148, 163, 184, 0.15))';
    el.style.boxShadow = 'var(--shadow-lg)';

    // Header
    const titleHtml = `
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06)); padding-bottom: 8px;">
        <span style="font-size: var(--text-xs); font-weight: 600; color: var(--accent-secondary, #06b6d4); display: flex; align-items: center; gap: 6px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
          AI Critique
        </span>
        ${node.status !== 'generating' ? `
          <button class="btn-icon small btn-delete-comment" title="Delete Comment" style="color: var(--text-tertiary); background: transparent; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        ` : ''}
      </div>
    `;

    // Content body
    let bodyHtml = '';
    if (node.status === 'generating' && !node.prompt) {
      bodyHtml = `
        <div style="display: flex; align-items: center; justify-content: center; height: 80px; color: var(--accent-secondary, #06b6d4);">
          <div class="album-spinner" style="width: 16px; height: 16px; border-width: 2px; margin-right: 8px;"></div>
          <span>Writing critique...</span>
        </div>
      `;
    } else {
      bodyHtml = `
        <div style="font-size: 12.5px; line-height: 1.5; color: var(--text-primary); max-height: 250px; overflow-y: auto; padding-right: 4px;" class="album-comment-body-text">
          ${renderMarkdown(node.prompt || '')}
          ${node.status === 'generating' ? '<span class="streaming-cursor"></span>' : ''}
        </div>
      `;
    }

    el.innerHTML = titleHtml + bodyHtml;

    const deleteBtn = el.querySelector('.btn-delete-comment');
    if (deleteBtn) {
      deleteBtn.onclick = () => {
        albumStore.deleteNode(album.id, node.id).then(() => renderActiveAlbumWorkspace());
      };
    }

    if (isNew) canvas.appendChild(el);
  });

  // Remove obsolete dynamic node elements from the canvas
  const allNodeElements = canvas.querySelectorAll('.album-node');
  allNodeElements.forEach(el => {
    if (!existingNodeIds.has(el.id)) {
      el.remove();
    }
  });
}

// AI processing of user's custom text prompt (translates to English, expands with Anima descriptors, and generates user-friendly label)
async function processCustomUserPrompt(album, rawPrompt) {
  try {
    const descLanguage = album.language || 'Russian';
    const nsfwInstruction = album.allowNsfw
      ? "You are ALLOWED to translate, expand, or brainstorm mature, spicy, sensual, or explicit (NSFW) descriptors if they match the user's raw prompt idea, as the NSFW option is ENABLED by the user."
      : "You are STRICTLY FORBIDDEN from generating or expanding any mature, spicy, sensual, or explicit (NSFW) descriptors. Keep all prompt expansions strictly safe for work (SFW).";

    const systemInstructions = `You are a creative art director working with the Anima image generation neural network. You must strictly follow all provided instructions.
    
    The user has provided a raw image prompt idea (potentially in Russian or another language). 
    Your tasks are:
    1. Translate the prompt to English if it is not already in English.
    2. Expand the prompt into a detailed, highly descriptive prompt optimized for the Anima neural network (using natural language, tags, or a combination).
    3. Generate a very short, user-friendly description/summary (under 8 words) in ${descLanguage} explaining what will be depicted.
    
    ${nsfwInstruction}
    
    You MUST return your response ONLY as a valid JSON object:
    {
      "prompt": "Highly detailed expanded technical prompt in English for Anima...",
      "description": "Short description in ${descLanguage}..."
    }
    Do not include any introductory remarks, greetings, or markdown code blocks. Just return the clean JSON object.`;

    const messages = [
      { role: 'system', content: systemInstructions },
      { role: 'user', content: `Raw user prompt: ${rawPrompt}\nAlbum Theme: ${album.theme}` }
    ];

    const response = await api.chatCompletion(messages, { temperature: 0.6, max_tokens: 512 });
    let cleanText = response.trim();

    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json/m, '').replace(/```$/m, '').trim();
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```/m, '').replace(/```$/m, '').trim();
    }

    const result = JSON.parse(cleanText);
    return {
      prompt: result.prompt || rawPrompt,
      description: result.description || rawPrompt.substring(0, 20)
    };
  } catch (err) {
    console.error("Failed to process custom prompt via LLM:", err);
    return {
      prompt: rawPrompt,
      description: rawPrompt.substring(0, 20) + (rawPrompt.length > 20 ? '...' : '')
    };
  }
}

// Bounding box helper for force-directed collision push
function getNodeBox(node, cardW, cardH) {
  let w = 200, h = 36; // suggestion default
  if (node.type === 'image' || node.status === 'generating') {
    w = cardW;
    h = cardH;
  } else if (node.status === 'working') {
    w = 120;
    h = 36;
  } else if (node.type === 'input') {
    w = 250;
    h = 36;
  }
  return {
    left: node.x,
    top: node.y,
    right: node.x + w,
    bottom: node.y + h,
    width: w,
    height: h,
    cx: node.x + w / 2,
    cy: node.y + h / 2
  };
}

// Physics-based node overlap resolution with force pushes and smooth canvas transitions
async function resolveNodeCollisions(album) {
  if (album.sortMode && album.sortMode !== 'default') return;
  const nodes = album.nodes || [];
  if (nodes.length <= 1) return;

  // Retrieve ComfyUI aspect ratio sizes
  const settings = settingsStore.get();
  const comW = settings.comfyui_width ?? 832;
  const comH = settings.comfyui_height ?? 1216;
  let cardW = 280, cardH = 380;
  if (comW === comH) { cardW = 300; cardH = 300; }
  else if (comW > comH) { cardW = 380; cardH = 260; }

  const padding = 40; // minimum gap between borders to prevent cluttering
  let changed = false;

  // Multi-pass push resolution for smooth convergence
  for (let iter = 0; iter < 25; iter++) {
    let iterationChanged = false;

    for (let i = 0; i < nodes.length; i++) {
      const nodeA = nodes[i];
      const boxA = getNodeBox(nodeA, cardW, cardH);

      for (let j = i + 1; j < nodes.length; j++) {
        const nodeB = nodes[j];
        const boxB = getNodeBox(nodeB, cardW, cardH);

        // Check if boxes overlap including padding space
        const overlapX = Math.min(boxA.right + padding - boxB.left, boxB.right + padding - boxA.left);
        const overlapY = Math.min(boxA.bottom + padding - boxB.top, boxB.bottom + padding - boxA.top);

        if (boxA.right + padding > boxB.left && boxB.right + padding > boxA.left &&
            boxA.bottom + padding > boxB.top && boxB.bottom + padding > boxA.top) {
          
          let pushX = 0;
          let pushY = 0;

          // Push along the axis of shallowest penetration
          if (overlapX < overlapY) {
            pushX = overlapX / 2;
            if (boxA.cx > boxB.cx) {
              nodeA.x += pushX;
              nodeB.x -= pushX;
            } else {
              nodeA.x -= pushX;
              nodeB.x += pushX;
            }
          } else {
            pushY = overlapY / 2;
            if (boxA.cy > boxB.cy) {
              nodeA.y += pushY;
              nodeB.y -= pushY;
            } else {
              nodeA.y -= pushY;
              nodeB.y += pushY;
            }
          }

          // Bound coordinates within the 5000px ComfyUI canvas limits [100, 4900]
          nodeA.x = Math.max(100, Math.min(4900 - boxA.width, nodeA.x));
          nodeA.y = Math.max(100, Math.min(4900 - boxA.height, nodeA.y));
          nodeB.x = Math.max(100, Math.min(4900 - boxB.width, nodeB.x));
          nodeB.y = Math.max(100, Math.min(4900 - boxB.height, nodeB.y));

          iterationChanged = true;
          changed = true;
        }
      }
    }
    if (!iterationChanged) break; // early exit if layout stable
  }

  if (changed) {
    for (const node of nodes) {
      await albumStore.updateNode(album.id, node.id, {
        x: node.x,
        y: node.y
      });
    }
  }
}

// Branch generation loop trigger with multiphase morphing animation
async function triggerBranchGeneration(album, bubbleNode) {
  isAlbumGenerating = true;
  abortController = new AbortController();

  // Aspect ratio card sizes
  const settings = settingsStore.get();
  const comW = settings.comfyui_width ?? 832;
  const comH = settings.comfyui_height ?? 1216;
  let cardW = 280, cardH = 380;
  if (comW === comH) { cardW = 300; cardH = 300; }
  else if (comW > comH) { cardW = 380; cardH = 260; }

  // 1. If it's a custom user input, show toast and process/expand it via LLM before anything else
  if (bubbleNode.type === 'input') {
    showToast("AI Director is translating and expanding your prompt...");
    const processed = await processCustomUserPrompt(album, bubbleNode.prompt);
    bubbleNode.prompt = processed.prompt;
    bubbleNode.description = processed.description;
    await albumStore.updateNode(album.id, bubbleNode.id, {
      prompt: processed.prompt,
      description: processed.description
    });
  }

  // 2. Freeze the current bubble size in explicit pixel values to enable smooth transitioning out of 'auto' size
  const bubbleEl = document.getElementById(`node-${bubbleNode.id}`);
  if (bubbleEl) {
    bubbleEl.style.width = `${bubbleEl.offsetWidth}px`;
    bubbleEl.style.height = `${bubbleEl.offsetHeight}px`;
  }

  // 3. Defer the rest to the next animation frame so the browser registers the starting size paint frame!
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  // Target coordinates for image node (centering relative to bubble position)
  const targetX = bubbleNode.x - cardW / 4;
  const targetY = bubbleNode.y - cardH / 2 + 18;

  // Phase 1: Bubble shrinks instantly into Working... pill
  await albumStore.updateNode(album.id, bubbleNode.id, {
    status: 'working'
  });
  renderActiveAlbumWorkspace();

  // Center pan camera smoothly on the working bubble
  smoothPanTo(bubbleNode.x, bubbleNode.y);

  try {
    // Wait for the shrink transition (approx 400ms) before morphing
    await new Promise(r => setTimeout(r, 450));

    // Phase 2: Bubble expands to generating card dimensions with Shimmer/Sweep Effect
    await albumStore.updateNode(album.id, bubbleNode.id, {
      x: targetX,
      y: targetY,
      status: 'generating'
    });

    // Resolve overlaps/collisions so other cards make way smoothly for the newly expanding card!
    await resolveNodeCollisions(album);

    renderActiveAlbumWorkspace();

    // 4. Generate image via ComfyUI service with Abort Signal
    const finalPrompt = album.mandatoryTags 
      ? `${album.mandatoryTags.trim()}, ${bubbleNode.prompt.trim()}` 
      : bubbleNode.prompt.trim();

    const imageUrl = await generateImageComfyUI(finalPrompt, null, abortController.signal);

    // Phase 3: Transition Generating Card outline into the morphing image loader
    const bubbleElMorph = document.getElementById(`node-${bubbleNode.id}`);
    if (bubbleElMorph) {
      bubbleElMorph.className = 'album-node album-node-bubble morphing';
      bubbleElMorph.style.width = `${cardW}px`;
      bubbleElMorph.style.height = `${cardH}px`;
      bubbleElMorph.innerHTML = `<div class="album-spinner" style="margin: auto;"></div>`;
    }

    await new Promise(r => setTimeout(r, 450)); // let card morph complete

    // 5. Update node type to image in store (final Completed image state - fades in image)
    await albumStore.updateNode(album.id, bubbleNode.id, {
      type: 'image',
      x: targetX,
      y: targetY,
      imageUrl,
      status: 'completed'
    });

    activeImageNodeId = bubbleNode.id;

    // Delete obsolete bubbles to keep canvas clean
    const activeAlbum = albumStore.getAlbum(album.id);
    const obsoleteBubbles = activeAlbum.nodes.filter(n => n.type !== 'image');
    for (const ob of obsoleteBubbles) {
      await albumStore.deleteNode(album.id, ob.id);
    }

    // 6. Generate new continuation branch suggestions branching from the newly generated card!
    await generateBranchSuggestions(album, bubbleNode.id, bubbleNode.prompt);

  } catch (err) {
    console.error("Branch image generation failed:", err);
    showToast("Branch generation failed. Click again to retry.", "error");

    // Revert to idle suggestion on failure
    await albumStore.updateNode(album.id, bubbleNode.id, {
      status: 'idle'
    });
  } finally {
    isAlbumGenerating = false;
    abortController = null;
    renderActiveAlbumWorkspace();
  }
}

// Helper to toggle card selection in selection mode
function toggleCardSelection(nodeId) {
  if (selectedNodeIds.has(nodeId)) {
    selectedNodeIds.delete(nodeId);
  } else {
    selectedNodeIds.add(nodeId);
  }
  renderActiveAlbumWorkspace();
}

// Helper to cancel selection mode
function cancelSelectionMode() {
  selectionMode = null;
  selectedNodeIds.clear();
  const bar = document.getElementById('album-selection-bar');
  if (bar) bar.classList.add('hidden');
  const panel = document.querySelector('.album-bottom-panel');
  if (panel) panel.classList.remove('selection-active');
  renderActiveAlbumWorkspace();
}

// Spawns standalone card and runs generation
async function triggerStandaloneGeneration(album, node) {
  isAlbumGenerating = true;
  abortController = new AbortController();

  const settings = settingsStore.get();
  const comW = settings.comfyui_width ?? 832;
  const comH = settings.comfyui_height ?? 1216;
  let cardW = 280, cardH = 380;
  if (comW === comH) { cardW = 300; cardH = 300; }
  else if (comW > comH) { cardW = 380; cardH = 260; }

  showToast("AI Director is translating and expanding your prompt...");

  // Phase 1: Set to working
  await albumStore.updateNode(album.id, node.id, {
    status: 'working'
  });
  renderActiveAlbumWorkspace();

  try {
    const processed = await processCustomUserPrompt(album, node.prompt);
    node.prompt = processed.prompt;
    node.description = processed.description;

    const targetX = node.x - cardW / 4;
    const targetY = node.y - cardH / 2 + 30;

    // Phase 2: Expand to generating dimensions
    await albumStore.updateNode(album.id, node.id, {
      prompt: processed.prompt,
      description: processed.description,
      x: targetX,
      y: targetY,
      status: 'generating'
    });

    await resolveNodeCollisions(album);
    renderActiveAlbumWorkspace();

    // 3. Generate image via ComfyUI service
    const finalPrompt = album.mandatoryTags 
      ? `${album.mandatoryTags.trim()}, ${node.prompt.trim()}` 
      : node.prompt.trim();

    const imageUrl = await generateImageComfyUI(finalPrompt, null, abortController.signal);

    // Phase 3: Transition to completed image node
    const bubbleElMorph = document.getElementById(`node-${node.id}`);
    if (bubbleElMorph) {
      bubbleElMorph.className = 'album-node album-node-bubble morphing';
      bubbleElMorph.style.width = `${cardW}px`;
      bubbleElMorph.style.height = `${cardH}px`;
      bubbleElMorph.innerHTML = `<div class="album-spinner" style="margin: auto;"></div>`;
    }

    await new Promise(r => setTimeout(r, 450)); // let card morph complete

    // 4. Update node in store
    await albumStore.updateNode(album.id, node.id, {
      type: 'image',
      x: targetX,
      y: targetY,
      imageUrl,
      status: 'completed'
    });

    activeImageNodeId = node.id;

    // Delete other non-image suggestions/bubbles to keep canvas clean
    const activeAlbum = albumStore.getAlbum(album.id);
    const obsoleteBubbles = activeAlbum.nodes.filter(n => n.type !== 'image');
    for (const ob of obsoleteBubbles) {
      await albumStore.deleteNode(album.id, ob.id);
    }

    // 5. Generate new suggestions branching from the newly generated standalone card!
    await generateBranchSuggestions(album, node.id, node.prompt);

  } catch (err) {
    console.error("Standalone image generation failed:", err);
    showToast("Generation failed. Click again to retry.", "error");

    // Revert to idle standalone-input on failure
    await albumStore.updateNode(album.id, node.id, {
      status: 'idle'
    });
  } finally {
    isAlbumGenerating = false;
    abortController = null;
    renderActiveAlbumWorkspace();
  }
}

// Combined concept image generation
async function triggerSimilarGeneration(album, selectedNodes) {
  if (selectedNodes.length === 0) return;
  const lastSelected = selectedNodes[selectedNodes.length - 1];

  // Set activeImageNodeId to the correct parent card to clear and render suggestions on this card
  activeImageNodeId = lastSelected.id;

  // Clear out other temporary suggestion/input bubbles from the database
  const obsoleteBubblesAtStart = (album.nodes || []).filter(n => n.type !== 'image' && n.type !== 'standalone-input' && n.type !== 'comment');
  for (const ob of obsoleteBubblesAtStart) {
    await albumStore.deleteNode(album.id, ob.id);
  }

  isAlbumGenerating = true;
  abortController = new AbortController();

  const settings = settingsStore.get();
  const comW = settings.comfyui_width ?? 832;
  const comH = settings.comfyui_height ?? 1216;
  let cardW = 280, cardH = 380;
  if (comW === comH) { cardW = 300; cardH = 300; }
  else if (comW > comH) { cardW = 380; cardH = 260; }

  // 1. Spawn bubble in working state
  const nodeId = crypto.randomUUID();
  const targetX = lastSelected.x + cardW + 80;
  const targetY = lastSelected.y;

  await albumStore.addNode(album.id, {
    id: nodeId,
    type: 'suggestion',
    x: lastSelected.x + cardW / 2,
    y: lastSelected.y + cardH / 2,
    prompt: '',
    description: 'Combining concepts...',
    parentId: lastSelected.id,
    status: 'working'
  });
  renderActiveAlbumWorkspace();
  smoothPanTo(lastSelected.x + cardW / 2, lastSelected.y + cardH / 2);

  try {
    showToast("AI Director is blending the selected image styles...");

    // 2. Fetch combined prompt from LLM
    const descLanguage = album.language || 'Russian';
    const systemInstructions = `You are a visual art director combining multiple visual concepts into a new coherent scene.
Given the Album Theme, Album Description, and the detailed prompts of the selected images, combine their aesthetic, subject matter, style, and lighting into a single, unified, new creative image prompt.

Album Theme: ${album.theme}
Album Description: ${album.description}

Selected Image Prompts:
${selectedNodes.map((n, i) => `- Image ${i + 1}: ${n.prompt} (Description: ${n.description})`).join('\n')}

You MUST return your response ONLY as a valid JSON object:
{
  "prompt": "Highly detailed expanded technical prompt in English combining the selected images...",
  "description": "Short summary description in ${descLanguage} (under 8 words)."
}
Do not include any introductory remarks, greetings, or markdown code blocks. Just return the clean JSON object.`;

    const messages = [
      { role: 'system', content: systemInstructions },
      { role: 'user', content: `Combine these ${selectedNodes.length} selected images.` }
    ];

    const response = await api.chatCompletion(messages, { temperature: 0.7, max_tokens: 512 });
    let cleanText = response.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json/m, '').replace(/```$/m, '').trim();
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```/m, '').replace(/```$/m, '').trim();
    }

    const parsed = JSON.parse(cleanText);
    const combinedPrompt = parsed.prompt;
    const combinedDescription = parsed.description;

    // 3. Move to target position and show as generating
    await albumStore.updateNode(album.id, nodeId, {
      prompt: combinedPrompt,
      description: combinedDescription,
      x: targetX,
      y: targetY,
      status: 'generating'
    });
    await resolveNodeCollisions(album);
    renderActiveAlbumWorkspace();

    // 4. Generate image via ComfyUI
    const finalPrompt = album.mandatoryTags 
      ? `${album.mandatoryTags.trim()}, ${combinedPrompt.trim()}` 
      : combinedPrompt.trim();

    const imageUrl = await generateImageComfyUI(finalPrompt, null, abortController.signal);

    // 5. Morph transition
    const bubbleEl = document.getElementById(`node-${nodeId}`);
    if (bubbleEl) {
      bubbleEl.className = 'album-node album-node-bubble morphing';
      bubbleEl.style.width = `${cardW}px`;
      bubbleEl.style.height = `${cardH}px`;
      bubbleEl.innerHTML = `<div class="album-spinner" style="margin: auto;"></div>`;
    }
    await new Promise(r => setTimeout(r, 450));

    // 6. Complete node
    await albumStore.updateNode(album.id, nodeId, {
      type: 'image',
      x: targetX,
      y: targetY,
      imageUrl,
      status: 'completed'
    });

    activeImageNodeId = nodeId;

    // Delete obsolete non-image suggestions/bubbles
    const activeAlbum = albumStore.getAlbum(album.id);
    const obsoleteBubbles = activeAlbum.nodes.filter(n => n.type !== 'image');
    for (const ob of obsoleteBubbles) {
      await albumStore.deleteNode(album.id, ob.id);
    }

    // 7. Brainstorm follow-up visual ideas
    await generateBranchSuggestions(album, nodeId, combinedPrompt);

  } catch (err) {
    console.error("Combined image generation failed:", err);
    showToast("Generation failed.", "error");
    await albumStore.deleteNode(album.id, nodeId);
  } finally {
    isAlbumGenerating = false;
    abortController = null;
    renderActiveAlbumWorkspace();
  }
}

// Generate critique and storytelling note/comment card on the canvas
async function triggerCommentGeneration(album, selectedNodes) {
  if (selectedNodes.length === 0) return;
  const lastSelected = selectedNodes[selectedNodes.length - 1];

  // Set activeImageNodeId to the correct parent card to clear and render suggestions on this card
  activeImageNodeId = lastSelected.id;

  // Clear out other temporary suggestion/input bubbles from the database
  const obsoleteBubblesAtStart = (album.nodes || []).filter(n => n.type !== 'image' && n.type !== 'standalone-input' && n.type !== 'comment');
  for (const ob of obsoleteBubblesAtStart) {
    await albumStore.deleteNode(album.id, ob.id);
  }

  isAlbumGenerating = true;
  abortController = new AbortController();

  const settings = settingsStore.get();
  const comW = settings.comfyui_width ?? 832;
  const comH = settings.comfyui_height ?? 1216;
  let cardW = 280, cardH = 380;
  if (comW === comH) { cardW = 300; cardH = 300; }
  else if (comW > comH) { cardW = 380; cardH = 260; }

  // 1. Spawn comment node on the canvas next to the last selected card
  const commentNodeId = crypto.randomUUID();
  const targetX = lastSelected.x + cardW + 80;
  const targetY = lastSelected.y;

  await albumStore.addNode(album.id, {
    id: commentNodeId,
    type: 'comment',
    x: targetX,
    y: targetY,
    prompt: '', // This will hold the streamed markdown comment text
    description: 'AI Comment',
    parentId: lastSelected.id,
    status: 'generating'
  });
  await resolveNodeCollisions(album);
  renderActiveAlbumWorkspace();
  smoothPanTo(targetX + 160, targetY + 100);

  try {
    showToast("AI critic is reviewing selected images...");

    const descLanguage = album.language || 'Russian';
    const systemInstructions = `You are a professional visual art critic, curator, and storyteller.
Analyze the selection of images generated in this album and write an insightful, structured, and engaging critique/evaluation.
Describe the prompts and subjects depicted, analyze how they connect to each other and to the overall album theme, and comment on their aesthetic quality, mood, and composition.

Album Theme: ${album.theme}
Album Description/Context: ${album.description}

Selected Image Prompts and details:
${selectedNodes.map((n, i) => `- Image ${i + 1}: ${n.prompt} (Description: ${n.description})`).join('\n')}

Format your review with clear markdown headings and styling if appropriate. Use bullet points or short paragraphs for readability.
Your critique must be written strictly in ${descLanguage}.
Keep your review engaging, professional, and detailed.`;

    const messages = [
      { role: 'system', content: systemInstructions },
      { role: 'user', content: `Please review these ${selectedNodes.length} selected images.` }
    ];

    let commentContent = '';
    await api.streamChat(
      messages,
      abortController.signal,
      (chunk) => {
        commentContent += chunk;
        albumStore.updateNode(album.id, commentNodeId, { prompt: commentContent });
        renderActiveAlbumWorkspace();
      },
      async () => {
        // Complete comment streaming
        await albumStore.updateNode(album.id, commentNodeId, {
          status: 'completed',
          prompt: commentContent
        });
        renderActiveAlbumWorkspace();
      },
      (err) => {
        console.error("Comment critique streaming error:", err);
        showToast("Critique streaming failed.", "error");
      },
      { temperature: 0.7, max_tokens: 1024 }
    );

  } catch (err) {
    console.error("Critique commentary generation failed:", err);
    showToast("Failed to write critique.", "error");
    await albumStore.deleteNode(album.id, commentNodeId);
  } finally {
    isAlbumGenerating = false;
    abortController = null;
    renderActiveAlbumWorkspace();
  }
}
