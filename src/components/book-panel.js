/* ════════════════════════════════════════════════════════════════════
   Book Panel Component — Sidebar and Modal logic
   ════════════════════════════════════════════════════════════════════ */

import { bookStore } from '../services/book-store.js';
import { appState } from '../state.js';
import { closeModal, showToast, openWindow, closeWindow } from '../main.js';

let tabCharacters;
let tabBooks;
let charactersSection;
let booksSection;
let chatViewContainer;
let bookViewContainer;

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

export function initBookPanel() {
  tabCharacters = document.getElementById('tab-characters');
  tabBooks = document.getElementById('tab-books');
  charactersSection = document.getElementById('characters-section');
  booksSection = document.getElementById('books-section');
  chatViewContainer = document.getElementById('chat-view-container');
  bookViewContainer = document.getElementById('book-view-container');

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

  // Tabs logic
  tabCharacters.addEventListener('click', () => {
    tabCharacters.classList.add('active');
    tabCharacters.style.background = 'var(--bg-tertiary)';
    tabCharacters.style.color = 'var(--text-primary)';
    tabCharacters.style.border = '1px solid var(--border-light)';
    
    tabBooks.classList.remove('active');
    tabBooks.style.background = 'transparent';
    tabBooks.style.color = 'var(--text-secondary)';
    tabBooks.style.border = '1px solid transparent';

    charactersSection.classList.remove('hidden');
    booksSection.classList.add('hidden');

    chatViewContainer.classList.remove('hidden');
    chatViewContainer.style.display = 'flex';
    bookViewContainer.classList.add('hidden');
    bookViewContainer.style.display = 'none';
  });

  tabBooks.addEventListener('click', () => {
    tabBooks.classList.add('active');
    tabBooks.style.background = 'var(--bg-tertiary)';
    tabBooks.style.color = 'var(--text-primary)';
    tabBooks.style.border = '1px solid var(--border-light)';
    
    tabCharacters.classList.remove('active');
    tabCharacters.style.background = 'transparent';
    tabCharacters.style.color = 'var(--text-secondary)';
    tabCharacters.style.border = '1px solid transparent';

    booksSection.classList.remove('hidden');
    charactersSection.classList.add('hidden');

    chatViewContainer.classList.add('hidden');
    chatViewContainer.style.display = 'none';
    bookViewContainer.classList.remove('hidden');
    bookViewContainer.style.display = 'flex';

    renderBookList();
  });

  // Modal logic
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
