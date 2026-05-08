/* ════════════════════════════════════════════════════════════════════
   Book View Component — Chapter generation and UI
   ════════════════════════════════════════════════════════════════════ */

import { bookStore } from '../services/book-store.js';
import { api } from '../services/api.js';
import { settingsStore } from '../services/settings-store.js';
import { renderMarkdown, escapeHtml } from '../utils/helpers.js';
import { showConfirm } from '../main.js';
import morphdom from '../vendor/morphdom.js';

let bookHeaderTitle;
let bookChaptersContainer;
let bookEmptyState;
let bookInputArea;
let nextPromptInput;
let btnGenerateChapter;
let btnRegenerateChapter;
let btnStopChapter;

let currentAbortController = null;
let isGenerating = false;

export function initBookView() {
  bookHeaderTitle = document.getElementById('book-header-title');
  bookChaptersContainer = document.getElementById('book-chapters');
  bookEmptyState = document.getElementById('book-empty-state');
  bookInputArea = document.getElementById('book-input-area');
  nextPromptInput = document.getElementById('book-next-prompt');
  btnGenerateChapter = document.getElementById('btn-generate-chapter');
  btnRegenerateChapter = document.getElementById('btn-regenerate-chapter');
  btnStopChapter = document.getElementById('btn-stop-chapter');

  window.addEventListener('book-selected', (e) => {
    loadBook(e.detail.id);
  });

  btnGenerateChapter.addEventListener('click', () => generateChapter());
  
  btnRegenerateChapter.addEventListener('click', regenerateLastChapter);
  
  nextPromptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      generateChapter();
    }
  });

  btnStopChapter.addEventListener('click', () => {
    if (currentAbortController) {
      currentAbortController.abort();
    }
  });
}

function loadBook(bookId) {
  const book = bookStore.getBook(bookId);
  if (!book) return;

  bookHeaderTitle.textContent = book.title;
  bookChaptersContainer.innerHTML = '';
  
  if (book.chapters.length === 0) {
    // Show empty state and prompt for first chapter
    bookInputArea.classList.remove('hidden');
    nextPromptInput.value = book.initialPrompt; // pre-fill with initial prompt
    bookChaptersContainer.appendChild(bookEmptyState);
    bookEmptyState.style.display = 'flex';
  } else {
    bookEmptyState.style.display = 'none';
    book.chapters.forEach(chapter => {
      appendChapterToUI(chapter);
    });
    bookInputArea.classList.remove('hidden');
    nextPromptInput.value = '';
    
    // Show/hide regenerate button
    if (book.chapters.length > 0) {
      btnRegenerateChapter.classList.remove('hidden');
    } else {
      btnRegenerateChapter.classList.add('hidden');
    }
    
    scrollToBottom();
  }
}

async function regenerateLastChapter() {
  const bookId = bookStore.activeBookId;
  const book = bookStore.getBook(bookId);
  if (!book || isGenerating || book.chapters.length === 0) return;

  const confirmed = await showConfirm(
    'Regenerate Chapter',
    'Are you sure you want to delete the current chapter and generate it again?'
  );

  if (confirmed) {
    const lastChapter = book.chapters[book.chapters.length - 1];
    const lastPrompt = lastChapter.prompt;

    // Delete last chapter
    await bookStore.deleteLastChapter(bookId);

    // Refresh UI
    loadBook(bookId);

    // Set prompt and generate
    nextPromptInput.value = lastPrompt;
    generateChapter();
  }
}

function scrollToBottom() {
  bookChaptersContainer.scrollTop = bookChaptersContainer.scrollHeight;
}

function appendChapterToUI(chapter) {
  const el = document.createElement('div');
  el.className = 'message assistant message-enter';
  el.dataset.chapterId = chapter.id;
  el.style.maxWidth = '800px';
  el.style.margin = '0 auto 24px auto';
  el.style.width = '100%';

  const summaryIconHtml = chapter.summary ? `
    <div class="chapter-summary-icon" title="${escapeHtml(chapter.summary)}" style="cursor: help; color: var(--text-accent); margin-left: 8px; display: inline-flex; align-items: center;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px;">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
    </div>
  ` : '';

  const headerHtml = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid var(--border-light); padding-bottom: 8px;">
      <h3 style="margin: 0; color: var(--text-secondary); font-size: 1.1em;">Chapter</h3>
      ${summaryIconHtml}
    </div>
  `;

  el.innerHTML = `
    <div class="message-body" style="width: 100%; border: 1px solid var(--border-subtle); background: var(--bg-secondary); padding: 24px; border-radius: var(--radius-lg);">
      ${headerHtml}
      <div class="message-content" style="font-size: 1.05em; line-height: 1.7;">
        <div class="message-text">${renderMarkdown(chapter.content)}</div>
      </div>
    </div>
  `;

  bookChaptersContainer.appendChild(el);
}

function buildApiMessages(book, currentPrompt) {
  const messages = [];
  const currentChapterNum = book.chapters.length + 1;

  // System Prompt
  let systemPrompt = `You are an expert, professional author writing an interactive book titled "${book.title}".
Your task is to write Chapter ${currentChapterNum} based on the user's prompt.
RULES:
1. Write extremely long, detailed, and expansive paragraphs.
2. Provide a full, comprehensive chapter with deep narrative, sensory details, and character development.
3. Do not rush the plot. Build the atmosphere and dialogue organically.
4. The story revolves around ${book.charCount} main character(s).
${book.allowNewChars ? "5. You are ALLOWED to introduce new supporting characters to the plot." : "5. DO NOT introduce any new characters without the user's explicit request."}
6. Write in prose format suitable for a high-quality novel. Format with distinct paragraphs using newlines.`;

  messages.push({ role: 'system', content: systemPrompt });

  // Add previous chapters as context
  for (const chapter of book.chapters) {
    messages.push({ role: 'user', content: chapter.prompt });
    messages.push({ role: 'assistant', content: chapter.content });
  }

  // Current prompt
  messages.push({ role: 'user', content: currentPrompt });

  return messages;
}

async function generateChapter() {
  const bookId = bookStore.activeBookId;
  const book = bookStore.getBook(bookId);
  if (!book || isGenerating) return;

  const prompt = nextPromptInput.value.trim();
  if (!prompt) return;

  isGenerating = true;
  currentAbortController = new AbortController();

  // Update UI
  nextPromptInput.value = '';
  btnGenerateChapter.classList.add('hidden');
  btnRegenerateChapter.classList.add('hidden');
  btnStopChapter.classList.remove('hidden');
  bookEmptyState.style.display = 'none';

  // Create chapter container in UI
  const el = document.createElement('div');
  el.className = 'message assistant message-enter';
  el.style.maxWidth = '800px';
  el.style.margin = '0 auto 24px auto';
  el.style.width = '100%';

  const headerHtml = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid var(--border-light); padding-bottom: 8px;">
      <h3 style="margin: 0; color: var(--text-secondary); font-size: 1.1em;">Chapter</h3>
      <div class="summary-container"></div>
    </div>
  `;

  el.innerHTML = `
    <div class="message-body" style="width: 100%; border: 1px solid var(--border-subtle); background: var(--bg-secondary); padding: 24px; border-radius: var(--radius-lg);">
      ${headerHtml}
      <div class="message-content" style="font-size: 1.05em; line-height: 1.7;">
        <div class="message-text"><span class="streaming-cursor"></span></div>
      </div>
    </div>
  `;
  bookChaptersContainer.appendChild(el);
  scrollToBottom();

  const contentEl = el.querySelector('.message-text');
  const messages = buildApiMessages(book, prompt);

  let fullResponse = '';
  let paragraphBuffer = '';
  let renderedContent = '';

  const options = {
    max_tokens: 4096, // Long chapters
    temperature: 0.8
  };

  try {
    await api.streamChat(
      messages,
      currentAbortController.signal,
      (chunk) => {
        fullResponse += chunk;
        const wasEmpty = paragraphBuffer.length === 0;
        paragraphBuffer += chunk;

        // Check if paragraph is complete (newline or end tag)
        if (paragraphBuffer.includes('\\n') || paragraphBuffer.includes('</p>')) {
          // split by newline in case there are multiple, but just flushing the whole buffer is fine
          // because we want to push the completed paragraph to renderedContent
          renderedContent += paragraphBuffer;
          paragraphBuffer = '';
          
          requestAnimationFrame(() => {
            const html = renderMarkdown(renderedContent) + '<span class="streaming-cursor"></span>';
            const temp = document.createElement('div');
            temp.className = contentEl.className;
            temp.innerHTML = html;
            morphdom(contentEl, temp, { childrenOnly: true });
            scrollToBottom();
          });
        } else if (wasEmpty && paragraphBuffer.length > 0) {
          requestAnimationFrame(() => {
            const html = renderMarkdown(renderedContent) + '<p><span class="writing-placeholder">Writing is in progress...</span></p>';
            const temp = document.createElement('div');
            temp.className = contentEl.className;
            temp.innerHTML = html;
            morphdom(contentEl, temp, { childrenOnly: true });
            scrollToBottom();
          });
        }
      },
      async () => {
        // Done
        if (paragraphBuffer) {
          renderedContent += paragraphBuffer;
        }

        const finalHtml = renderMarkdown(renderedContent);
        contentEl.innerHTML = finalHtml;

        // Save chapter
        const chapter = await bookStore.addChapter(bookId, prompt, renderedContent);
        
        isGenerating = false;
        btnGenerateChapter.classList.remove('hidden');
        btnRegenerateChapter.classList.remove('hidden');
        btnStopChapter.classList.add('hidden');
        currentAbortController = null;
        scrollToBottom();

        // Background Summarization
        if (chapter) {
          const summaryContainer = el.querySelector('.summary-container');
          summaryContainer.innerHTML = '<span style="font-size: 0.8em; color: var(--text-muted);">Summarizing...</span>';
          
          const summary = await summarizeChapter(renderedContent);
          await bookStore.updateChapterSummary(bookId, chapter.id, summary);
          
          summaryContainer.innerHTML = `
            <div class="chapter-summary-icon" title="${escapeHtml(summary)}" style="cursor: help; color: var(--text-accent); display: inline-flex; align-items: center;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px;">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
            </div>
          `;
        }
      },
      (err) => {
        console.error('Chapter generation error:', err);
        isGenerating = false;
        btnGenerateChapter.classList.remove('hidden');
        if (bookStore.getBook(bookId)?.chapters.length > 0) {
          btnRegenerateChapter.classList.remove('hidden');
        }
        btnStopChapter.classList.add('hidden');
        currentAbortController = null;
      },
      options
    );
  } catch (err) {
    console.error('Book stream error:', err);
  }
}

async function summarizeChapter(text) {
  const messages = [
    {
      role: 'system',
      content: 'You are an expert editor. Provide a brief 1-2 sentence summary of the following chapter text. Focus on main events. Output ONLY the summary text.'
    },
    { role: 'user', content: text }
  ];
  try {
    return await api.chatCompletion(messages, { temperature: 0.3, max_tokens: 150 });
  } catch (err) {
    return 'Summary unavailable.';
  }
}
