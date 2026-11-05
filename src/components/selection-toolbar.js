/* ════════════════════════════════════════════════════════════════════
   Selection Floating Toolbar & Morphing Translation Card
   Handles text selection in Character Chat (#chat-messages) and GenAI (#genai-messages).
   Translates instantaneously on CPU via local MarianMT (Transformers.js).
   ════════════════════════════════════════════════════════════════════ */

import { translationService } from '../services/translation-service.js';
import { setGenAIReplyQuote } from './genai-panel.js';
import { escapeHtml } from '../utils/helpers.js';

let toolbarEl = null;
let actionsRowEl = null;
let btnReplyEl = null;
let btnTranslateEl = null;
let translateTextEl = null;
let loadingDotsEl = null;
let resultCardEl = null;
let resultBadgeEl = null;
let resultContentEl = null;
let btnCopyEl = null;
let btnCloseEl = null;

let currentSelectedText = '';
let currentTargetContainer = null; // 'chat' or 'genai'
let isTranslating = false;
let isResultShown = false;
let lastTranslatedText = '';

export function initSelectionToolbar() {
  toolbarEl = document.getElementById('floating-selection-toolbar');
  if (!toolbarEl) return;

  actionsRowEl = toolbarEl.querySelector('.toolbar-actions-row');
  btnReplyEl = document.getElementById('btn-selection-reply');
  btnTranslateEl = document.getElementById('btn-selection-translate');
  translateTextEl = btnTranslateEl?.querySelector('.btn-translate-text');
  loadingDotsEl = btnTranslateEl?.querySelector('.morph-loading-dots');

  resultCardEl = document.getElementById('selection-translation-result');
  resultBadgeEl = document.getElementById('translation-card-badge');
  resultContentEl = document.getElementById('translation-card-content');
  btnCopyEl = document.getElementById('btn-copy-translation');
  btnCloseEl = document.getElementById('btn-close-translation');

  const chatContainer = document.getElementById('chat-messages');
  const genaiContainer = document.getElementById('genai-messages');

  function hideToolbar() {
    if (!toolbarEl || toolbarEl.classList.contains('hidden')) return;
    toolbarEl.classList.add('hidden');
    resetToolbarState();
  }

  function resetToolbarState() {
    isTranslating = false;
    isResultShown = false;
    currentSelectedText = '';
    currentTargetContainer = null;

    toolbarEl.classList.remove('is-expanded-result');
    if (actionsRowEl) actionsRowEl.classList.remove('hidden');
    if (resultCardEl) resultCardEl.classList.add('hidden');

    if (btnReplyEl) {
      btnReplyEl.classList.remove('fade-out-collapse');
      btnReplyEl.classList.remove('hidden');
    }

    if (translateTextEl) translateTextEl.classList.remove('hidden');
    if (loadingDotsEl) loadingDotsEl.classList.add('hidden');
    if (btnTranslateEl) btnTranslateEl.disabled = false;
  }

  function handleSelection() {
    // If user is currently looking at translated result or translating, do not close or reposition on selection changes inside result
    if (isTranslating || isResultShown) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      hideToolbar();
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      hideToolbar();
      return;
    }

    // Ignore selections inside inputs, textareas, or buttons
    const anchor = selection.anchorNode;
    if (anchor && anchor.nodeType === Node.ELEMENT_NODE) {
      if (anchor.closest('input, textarea, button, select, [contenteditable="true"]')) {
        hideToolbar();
        return;
      }
    } else if (anchor && anchor.parentElement) {
      if (anchor.parentElement.closest('input, textarea, button, select, [contenteditable="true"]')) {
        hideToolbar();
        return;
      }
    }

    // Check if selection is within #chat-messages or #genai-messages
    let target = null;
    const range = selection.getRangeAt(0);
    const containerNode = range.commonAncestorContainer;

    if (chatContainer && chatContainer.contains(containerNode)) {
      target = 'chat';
    } else if (genaiContainer && genaiContainer.contains(containerNode)) {
      target = 'genai';
    }

    if (!target) {
      hideToolbar();
      return;
    }

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      hideToolbar();
      return;
    }

    currentSelectedText = text;
    currentTargetContainer = target;

    // Reset button states
    resetToolbarState();
    currentSelectedText = text;
    currentTargetContainer = target;

    // In GenAI: show Reply button. In Character Chat: hide Reply button (translate only)
    if (btnReplyEl) {
      if (target === 'genai') {
        btnReplyEl.classList.remove('hidden');
      } else {
        btnReplyEl.classList.add('hidden');
      }
    }

    // Position toolbar above the selection
    let top = rect.top - 44;
    let left = rect.left + (rect.width / 2);

    if (top < 12) {
      top = rect.bottom + 10;
    }

    // Keep left coordinate within screen margins
    left = Math.max(80, Math.min(window.innerWidth - 80, left));

    toolbarEl.style.top = `${top}px`;
    toolbarEl.style.left = `${left}px`;
    toolbarEl.classList.remove('hidden');
  }

  // Reply Button Click
  if (btnReplyEl) {
    btnReplyEl.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (currentSelectedText && typeof setGenAIReplyQuote === 'function') {
        setGenAIReplyQuote(currentSelectedText);
        window.getSelection().removeAllRanges();
      }
      hideToolbar();
    });
  }

  // Translate Button Click (Morphing Animation)
  if (btnTranslateEl) {
    btnTranslateEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (isTranslating || !currentSelectedText) return;

      isTranslating = true;
      btnTranslateEl.disabled = true;

      // 1. Smoothly fade out and collapse sibling buttons (e.g. Reply button in GenAI)
      if (btnReplyEl && !btnReplyEl.classList.contains('hidden')) {
        btnReplyEl.classList.add('fade-out-collapse');
      }

      // 2. Morph the Translate button into 3-dots pulsing loader
      if (translateTextEl) translateTextEl.classList.add('hidden');
      if (loadingDotsEl) loadingDotsEl.classList.remove('hidden');

      const startTime = Date.now();
      const isLoaded = translationService.isModelLoaded('en-ru');
      if (!isLoaded && window.showToast) {
        window.showToast('Loading translation model (~15-30s on first use)...', 'info');
      }

      try {
        const translationPromise = translationService.translate(currentSelectedText);
        const timeoutMs = isLoaded ? 20000 : 75000;
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(isLoaded ? 'Translation timed out.' : 'Model initialization timed out. Please check Settings > Language.')), timeoutMs);
        });

        const result = await Promise.race([translationPromise, timeoutPromise]);

        // Ensure smooth visual perception of the morph (min 220ms)
        const elapsed = Date.now() - startTime;
        if (elapsed < 220) {
          await new Promise(r => setTimeout(r, 220 - elapsed));
        }

        renderTranslationResult(result.translation, result.direction);
      } catch (err) {
        console.error('[Translation Toolbar Error]', err);
        renderTranslationResult(err.message || 'Translation failed', 'error');
      } finally {
        isTranslating = false;
      }
    });
  }

  function renderTranslationResult(translationText, direction) {
    isResultShown = true;
    lastTranslatedText = translationText;

    // Switch view from action buttons to result card
    if (actionsRowEl) actionsRowEl.classList.add('hidden');
    if (resultCardEl) resultCardEl.classList.remove('hidden');

    if (resultBadgeEl) {
      if (direction === 'ru-en') {
        resultBadgeEl.textContent = 'RU → EN';
      } else if (direction === 'error') {
        resultBadgeEl.textContent = 'ERROR';
      } else {
        resultBadgeEl.textContent = 'EN → RU';
      }
    }

    if (resultContentEl) {
      resultContentEl.textContent = translationText;
    }

    // Apply morph expansion class
    toolbarEl.classList.add('is-expanded-result');

    // Check if expanded card bottom overflows window, adjust top if needed
    requestAnimationFrame(() => {
      const cardRect = toolbarEl.getBoundingClientRect();
      if (cardRect.bottom > window.innerHeight - 16) {
        const overflow = cardRect.bottom - (window.innerHeight - 16);
        const newTop = Math.max(12, cardRect.top - overflow);
        toolbarEl.style.top = `${newTop}px`;
      }
    });
  }

  // Copy Translation Button
  if (btnCopyEl) {
    btnCopyEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!lastTranslatedText) return;
      try {
        await navigator.clipboard.writeText(lastTranslatedText);
        if (window.showToast) {
          window.showToast('Translation copied to clipboard!', 'success');
        }
      } catch (err) {
        console.error('Failed to copy translation:', err);
      }
    });
  }

  // Close Translation Button
  if (btnCloseEl) {
    btnCloseEl.addEventListener('click', (e) => {
      e.stopPropagation();
      hideToolbar();
      window.getSelection()?.removeAllRanges();
    });
  }

  // Listen for selection changes on document
  document.addEventListener('selectionchange', () => {
    requestAnimationFrame(handleSelection);
  });

  // Hide on container scroll (unless user is scrolling inside the translation result)
  if (chatContainer) {
    chatContainer.addEventListener('scroll', () => {
      if (!isResultShown) hideToolbar();
    }, { passive: true });
  }

  if (genaiContainer) {
    genaiContainer.addEventListener('scroll', () => {
      if (!isResultShown) hideToolbar();
    }, { passive: true });
  }

  // Hide on pointer click outside toolbar
  document.addEventListener('pointerdown', (e) => {
    if (!toolbarEl || toolbarEl.classList.contains('hidden')) return;
    if (toolbarEl.contains(e.target)) return;
    hideToolbar();
  });

  // Hide on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toolbarEl && !toolbarEl.classList.contains('hidden')) {
      hideToolbar();
    }
  });
}
