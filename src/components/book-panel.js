/* ════════════════════════════════════════════════════════════════════
   Book Panel Component — Sidebar and Modal logic
   ════════════════════════════════════════════════════════════════════ */

import { bookStore } from '../services/book-store.js';
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
let charCountInput;
let allowNewCharsInput;
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
  charCountInput = document.getElementById('book-char-count');
  allowNewCharsInput = document.getElementById('book-allow-new-chars');
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
      // Expand GenAI to fullscreen and open it if closed
      import('./genai-panel.js').then(m => {
        m.openGenAIPanel();
        document.body.classList.add('genai-fullscreen');
        const fullscreenBtn = document.getElementById('btn-genai-fullscreen');
        if (fullscreenBtn) fullscreenBtn.title = 'Collapse from fullscreen';
      });

      // Pass nothing instead of character (deselect)
      import('./chat.js').then(m => {
        m.selectCharacter(null);
      });
    }
  });

  // ─── Tab: Books ───────────────────────────────────────────────
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
    renderBookList();
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
      // Group view visibility is typically managed by selectGroup() in group-chat-view.js
      // but we ensure it's at least visible if there's an active group
    });
  }

  // Allow other modules to programmatically switch to Groups tab
  window.switchToGroupsTab = () => { if (tabGroups) tabGroups.click(); };


  btnAddBook.addEventListener('click', () => {
    titleInput.value = '';
    charCountInput.value = '2';
    allowNewCharsInput.checked = true;
    initialPromptInput.value = '';
    openWindow(bookModal);
  });

  btnCloseBookModal.addEventListener('click', () => closeWindow(bookModal));
  btnCancelBook.addEventListener('click', () => closeWindow(bookModal));

  btnSaveBook.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const charCount = charCountInput.value;
    const allowNewChars = allowNewCharsInput.checked;
    const initialPrompt = initialPromptInput.value.trim();

    if (!title || !initialPrompt) {
      showToast('Title and Initial Scenario are required', 'error');
      return;
    }

    const book = await bookStore.createBook(title, charCount, allowNewChars, initialPrompt);
    closeWindow(bookModal);
    renderBookList();
    selectBook(book.id);
  });

  window.addEventListener('books-updated', renderBookList);
  
  // Initial render
  renderBookList();
}

function renderBookList() {
  if (!bookListContainer) return;
  bookListContainer.innerHTML = '';
  
  const books = bookStore.getAllBooks();
  if (books.length === 0) {
    bookListContainer.innerHTML = '<div class="empty-state small"><p>No books yet</p></div>';
    return;
  }

  books.forEach(book => {
    const el = document.createElement('div');
    el.className = `character-item ${bookStore.activeBookId === book.id ? 'active' : ''}`;
    el.innerHTML = `
      <div class="character-info" style="margin-left: 0;">
        <div class="character-name">${book.title}</div>
        <div class="character-preview">${book.chapters.length} chapters</div>
      </div>
    `;
    el.addEventListener('click', () => selectBook(book.id));
    bookListContainer.appendChild(el);
  });
}

function selectBook(id) {
  bookStore.activeBookId = id;
  renderBookList();
  
  // Dispatch event so book-view can update
  window.dispatchEvent(new CustomEvent('book-selected', { detail: { id } }));
}
