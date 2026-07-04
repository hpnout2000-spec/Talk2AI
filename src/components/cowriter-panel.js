/* ════════════════════════════════════════════════════════════════════
   CoWriter Panel Component — Sidebar and Modal logic
   ════════════════════════════════════════════════════════════════════ */

import { cowriterStore } from '../services/cowriter-store.js';
import { appState } from '../state.js';
import { closeModal, showToast, openWindow, closeWindow } from '../main.js';

let tabCharacters;
let tabBooks;
let tabGroups;
let charactersSection;
let booksSection;
let groupsSection;
let chatViewContainer;
let bookViewContainer;
let groupViewContainer;
let gameViewContainer;
let gamesSection;

let btnAddBook;
let bookModal;
let btnCloseBookModal;
let btnCancelBook;
let btnSaveBook;
let bookListContainer;

let titleInput;
let initialPromptInput;

// Helper: set active tab style
function setTabActive(activeBtn, otherBtns) {
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.style.background = 'var(--bg-tertiary)';
    activeBtn.style.color = 'var(--text-primary)';
    activeBtn.style.border = '1px solid var(--border-light)';
  }
  otherBtns.forEach(btn => {
    if (!btn) return;
    btn.classList.remove('active');
    btn.style.background = 'transparent';
    btn.style.color = 'var(--text-secondary)';
    btn.style.border = '1px solid transparent';
  });
}

export function initBookPanel() {
  tabCharacters = document.getElementById('tab-characters');
  tabBooks = document.getElementById('tab-books');
  tabGroups = document.getElementById('tab-groups');
  const tabGame = document.getElementById('tab-game');
  charactersSection = document.getElementById('characters-section');
  booksSection = document.getElementById('books-section');
  groupsSection = document.getElementById('groups-section');
  chatViewContainer = document.getElementById('chat-view-container');
  bookViewContainer = document.getElementById('book-view-container');
  groupViewContainer = document.getElementById('group-chat-view-container');
  gameViewContainer = document.getElementById('game-view-container');
  gamesSection = document.getElementById('games-section');

  btnAddBook = document.getElementById('btn-add-book');
  bookModal = document.getElementById('book-modal');
  btnCloseBookModal = document.getElementById('btn-close-book-modal');
  btnCancelBook = document.getElementById('btn-cancel-book');
  btnSaveBook = document.getElementById('btn-save-book');
  bookListContainer = document.getElementById('book-list');

  titleInput = document.getElementById('book-title');
  initialPromptInput = document.getElementById('book-initial-prompt');

  tabCharacters.addEventListener('click', () => {
    const isAlreadyActive = tabCharacters.classList.contains('active');

    setTabActive(tabCharacters, [tabBooks, tabGroups, document.getElementById('tab-game'), document.getElementById('tab-album')]);
    charactersSection.classList.remove('hidden'); charactersSection.style.display = 'flex';
    booksSection.classList.add('hidden'); booksSection.style.display = 'none';
    if (groupsSection) { groupsSection.classList.add('hidden'); groupsSection.style.display = 'none'; }
    if (gamesSection) { gamesSection.classList.add('hidden'); gamesSection.style.display = 'none'; }
    
    // Hide Album section and view
    const albumSec = document.getElementById('album-section');
    if (albumSec) { albumSec.classList.add('hidden'); albumSec.style.display = 'none'; }
    const albumView = document.getElementById('album-view-container');
    if (albumView) { albumView.classList.add('hidden'); albumView.style.display = 'none'; }
    
    if (groupViewContainer) { groupViewContainer.classList.add('hidden'); groupViewContainer.style.display = 'none'; }
    if (gameViewContainer) { gameViewContainer.classList.add('hidden'); gameViewContainer.style.display = 'none'; }
    chatViewContainer.classList.remove('hidden');
    chatViewContainer.style.display = 'flex';
    bookViewContainer.classList.add('hidden');
    bookViewContainer.style.display = 'none';

    if (isAlreadyActive) {
      import('./genai-panel.js').then(m => {
        m.openGenAIPanel();
        document.body.classList.add('genai-fullscreen');
        const fullscreenBtn = document.getElementById('btn-genai-fullscreen');
        if (fullscreenBtn) fullscreenBtn.title = 'Collapse from fullscreen';
      });

      import('./chat.js').then(m => {
        m.selectCharacter(null);
      });
    }
  });

  // ─── Tab: Books / CoWriter ───────────────────────────────────────────
  tabBooks.addEventListener('click', () => {
    setTabActive(tabBooks, [tabCharacters, tabGroups, document.getElementById('tab-game'), document.getElementById('tab-album')]);
    booksSection.classList.remove('hidden'); booksSection.style.display = 'flex';
    charactersSection.classList.add('hidden'); charactersSection.style.display = 'none';
    if (groupsSection) { groupsSection.classList.add('hidden'); groupsSection.style.display = 'none'; }
    if (gamesSection) { gamesSection.classList.add('hidden'); gamesSection.style.display = 'none'; }
    
    // Hide Album section and view
    const albumSec = document.getElementById('album-section');
    if (albumSec) { albumSec.classList.add('hidden'); albumSec.style.display = 'none'; }
    const albumView = document.getElementById('album-view-container');
    if (albumView) { albumView.classList.add('hidden'); albumView.style.display = 'none'; }
    
    if (groupViewContainer) { groupViewContainer.classList.add('hidden'); groupViewContainer.style.display = 'none'; }
    if (gameViewContainer) { gameViewContainer.classList.add('hidden'); gameViewContainer.style.display = 'none'; }
    chatViewContainer.classList.add('hidden');
    chatViewContainer.style.display = 'none';
    bookViewContainer.classList.remove('hidden');
    bookViewContainer.style.display = 'flex';
    renderStoryList();
  });

  // ─── Tab: Groups ──────────────────────────────────────────────
  if (tabGroups) {
    tabGroups.addEventListener('click', () => {
      setTabActive(tabGroups, [tabCharacters, tabBooks, document.getElementById('tab-game'), document.getElementById('tab-album')]);
      if (groupsSection) { groupsSection.classList.remove('hidden'); groupsSection.style.display = 'flex'; }
      charactersSection.classList.add('hidden'); charactersSection.style.display = 'none';
      booksSection.classList.add('hidden'); booksSection.style.display = 'none';
      if (gamesSection) { gamesSection.classList.add('hidden'); gamesSection.style.display = 'none'; }
      
      // Hide Album section and view
      const albumSec = document.getElementById('album-section');
      if (albumSec) { albumSec.classList.add('hidden'); albumSec.style.display = 'none'; }
      const albumView = document.getElementById('album-view-container');
      if (albumView) { albumView.classList.add('hidden'); albumView.style.display = 'none'; }
      
      chatViewContainer.classList.add('hidden');
      chatViewContainer.style.display = 'none';
      bookViewContainer.classList.add('hidden');
      bookViewContainer.style.display = 'none';
      if (gameViewContainer) { gameViewContainer.classList.add('hidden'); gameViewContainer.style.display = 'none'; }
    });
  }

  btnAddBook.addEventListener('click', () => {
    titleInput.value = '';
    initialPromptInput.value = '';
    openWindow(bookModal);
  });

  btnCloseBookModal.addEventListener('click', () => closeWindow(bookModal));
  btnCancelBook.addEventListener('click', () => closeWindow(bookModal));

  btnSaveBook.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const initialText = initialPromptInput.value.trim();

    if (!title) {
      showToast('Story Title is required', 'error');
      return;
    }

    const story = await cowriterStore.createStory(title, initialText);
    closeWindow(bookModal);
    renderStoryList();
    selectStory(story.id);
  });

  window.addEventListener('stories-updated', renderStoryList);
  
  // Initial render
  renderStoryList();
}

export function renderStoryList() {
  if (!bookListContainer) return;
  bookListContainer.innerHTML = '';
  
  const stories = cowriterStore.getAllStories();
  if (stories.length === 0) {
    bookListContainer.innerHTML = '<div class="empty-state small"><p>No stories yet</p></div>';
    return;
  }

  stories.forEach(story => {
    const el = document.createElement('div');
    el.className = `character-item ${cowriterStore.activeStoryId === story.id ? 'active' : ''}`;
    
    // Estimate word count for preview
    const wordCount = story.content ? story.content.trim().split(/\s+/).filter(Boolean).length : 0;
    
    el.innerHTML = `
      <div class="character-info" style="margin-left: 0;">
        <div class="character-name">${story.title}</div>
        <div class="character-preview">${wordCount} words</div>
      </div>
    `;
    el.addEventListener('click', () => selectStory(story.id));
    bookListContainer.appendChild(el);
  });
}

function selectStory(id) {
  cowriterStore.activeStoryId = id;
  renderStoryList();
  
  // Dispatch event so cowriter-view can update
  window.dispatchEvent(new CustomEvent('story-selected', { detail: { id } }));
}
