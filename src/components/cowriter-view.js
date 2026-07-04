/* ════════════════════════════════════════════════════════════════════
   CoWriter View Component — Unified text editor and completions
   ════════════════════════════════════════════════════════════════════ */

import { cowriterStore } from '../services/cowriter-store.js';
import { api } from '../services/api.js';
import { settingsStore } from '../services/settings-store.js';
import { showConfirm, showToast, openWindow, closeWindow } from '../main.js';

let bookHeaderTitle;
let bookEmptyState;
let editorEl;
let editorContainerEl;
let tooltipEl;
let btnTooltipAuto;
let btnTooltipManual;

let bookInputArea;
let lengthDropdownBtn;
let lengthLabel;
let lengthMenu;
let customLengthContainer;
let customSentencesInput;
let nextInstructionInput;
let btnGenerate;
let btnStop;
let btnDeleteStory;
let btnSettings;
let btnReasoning;
let reasoningMenu;

// Modals
let settingsModal;
let btnSettingsClose;
let btnSettingsCancel;
let btnSettingsSave;
let promptAutoTextarea;
let promptManualTextarea;
let promptInstructionTextarea;

let currentAbortController = null;
let isGenerating = false;
let isManualCompleteActive = false;
let currentSelectionBlock = null;
let tooltipTimeout = null;
let saveTimeout = null;

export function initBookView() {
  // Map elements using legacy and new IDs
  bookHeaderTitle = document.getElementById('book-header-title');
  bookEmptyState = document.getElementById('book-empty-state');
  editorEl = document.getElementById('cowriter-editor');
  editorContainerEl = document.getElementById('cowriter-editor-container');
  tooltipEl = document.getElementById('cowriter-tooltip');
  btnTooltipAuto = document.getElementById('btn-tooltip-auto');
  btnTooltipManual = document.getElementById('btn-tooltip-manual');

  bookInputArea = document.getElementById('book-input-area');
  lengthDropdownBtn = document.getElementById('btn-cowriter-length-dropdown');
  lengthLabel = document.getElementById('cowriter-length-label');
  lengthMenu = document.getElementById('cowriter-length-menu');
  customLengthContainer = document.getElementById('cowriter-custom-container');
  customSentencesInput = document.getElementById('cowriter-custom-sentences');
  nextInstructionInput = document.getElementById('book-next-prompt');
  btnGenerate = document.getElementById('btn-generate-chapter');
  btnStop = document.getElementById('btn-stop-chapter');
  btnDeleteStory = document.getElementById('btn-delete-story');
  btnSettings = document.getElementById('btn-cowriter-settings');
  btnReasoning = document.getElementById('btn-cowriter-reasoning');
  reasoningMenu = document.getElementById('cowriter-reasoning-menu');

  // Set default length value
  if (lengthDropdownBtn) {
    lengthDropdownBtn.dataset.value = 'medium';
  }

  // Modals
  settingsModal = document.getElementById('cowriter-settings-modal');
  btnSettingsClose = document.getElementById('btn-close-cowriter-settings');
  btnSettingsCancel = document.getElementById('btn-cancel-cowriter-settings');
  btnSettingsSave = document.getElementById('btn-save-cowriter-settings');
  
  promptAutoTextarea = document.getElementById('cowriter-prompt-auto');
  promptManualTextarea = document.getElementById('cowriter-prompt-manual');
  promptInstructionTextarea = document.getElementById('cowriter-prompt-instruction');

  // Listen to story selection
  window.addEventListener('story-selected', (e) => {
    loadStory(e.detail.id);
  });

  // Custom Length Dropdown toggle
  lengthDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = lengthMenu.style.display === 'block';
    lengthMenu.style.display = isVisible ? 'none' : 'block';
  });

  // Close length menu on click outside
  document.addEventListener('click', () => {
    if (lengthMenu) lengthMenu.style.display = 'none';
  });

  // Clicking an option in length menu
  lengthMenu.querySelectorAll('.dropdown-option').forEach(option => {
    option.addEventListener('click', () => {
      const val = option.dataset.value;
      lengthDropdownBtn.dataset.value = val;
      lengthLabel.textContent = option.textContent;
      
      lengthMenu.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('active'));
      option.classList.add('active');
      
      if (val === 'custom') {
        customLengthContainer.style.display = 'inline-flex';
      } else {
        customLengthContainer.style.display = 'none';
      }
    });
  });

  // Reasoning Effort Event Listeners
  updateReasoningUI();

  btnReasoning.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleReasoningEffort();
  });

  // Clicking option in reasoning menu
  reasoningMenu.querySelectorAll('.reasoning-option').forEach(option => {
    option.addEventListener('click', async (e) => {
      e.stopPropagation();
      const val = option.dataset.value;
      
      const updateData = { reasoning_effort: val };
      if (val !== 'none') {
        updateData.previous_reasoning_effort = val;
      }
      
      await settingsStore.save(updateData);
      updateReasoningUI();
      reasoningMenu.style.display = 'none';
      showToast(`Reasoning effort set to ${val}`, 'success');
    });
  });

  // Bottom buttons
  btnGenerate.addEventListener('click', generateFromInstruction);
  btnStop.addEventListener('click', stopGeneration);
  btnDeleteStory.addEventListener('click', deleteActiveStory);
  
  // Settings buttons
  btnSettings.addEventListener('click', openSettings);
  btnSettingsClose.addEventListener('click', () => closeWindow(settingsModal));
  btnSettingsCancel.addEventListener('click', () => closeWindow(settingsModal));
  btnSettingsSave.addEventListener('click', saveSettings);

  // Tooltip clicks
  btnTooltipAuto.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startAutoComplete();
  });
  
  btnTooltipManual.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startManualComplete();
  });

  // Editor typing/key listeners
  editorEl.addEventListener('input', () => {
    hideTooltip();
    showTooltipDebounced();
    autoSaveStory();
  });

  editorEl.addEventListener('keydown', handleEditorKeyDown);
  
  // Close tooltip when clicking outside the editor
  document.addEventListener('click', (e) => {
    if (editorEl && !editorEl.contains(e.target) && tooltipEl && !tooltipEl.contains(e.target)) {
      hideTooltip();
    }
  });
}

// ─── Story Loader & Auto-Save ────────────────────────────────────────

function loadStory(storyId) {
  const story = cowriterStore.getStory(storyId);
  if (!story) return;

  bookHeaderTitle.textContent = story.title;
  
  // Hide empty state, show editor and input area
  bookEmptyState.style.display = 'none';
  editorEl.classList.remove('hidden');
  bookInputArea.classList.remove('hidden');
  
  // Load content
  editorEl.innerText = story.content || '';
  
  // Cancel any manual complete blocks
  cancelManualComplete();
  hideTooltip();
}

function autoSaveStory() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    const id = cowriterStore.activeStoryId;
    if (id && editorEl) {
      // Use innerText to preserve linebreaks correctly
      await cowriterStore.updateStoryContent(id, editorEl.innerText);
      // Update words preview in sidebar
      import('./cowriter-panel.js').then(m => m.renderStoryList());
    }
  }, 1000); // 1s debounce
}

async function deleteActiveStory() {
  const id = cowriterStore.activeStoryId;
  const story = cowriterStore.getStory(id);
  if (!story) return;

  const confirmed = await showConfirm(
    'Delete Story',
    `Are you sure you want to delete "${story.title}"?`
  );

  if (confirmed) {
    await cowriterStore.deleteStory(id);
    // Refresh UI
    bookHeaderTitle.textContent = 'Select a story';
    bookEmptyState.style.display = 'flex';
    editorEl.classList.add('hidden');
    bookInputArea.classList.add('hidden');
    
    import('./cowriter-panel.js').then(m => m.renderStoryList());
  }
}

// ─── Caret Helpers ───────────────────────────────────────────────────

function getCaretCoordinates() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  
  if (range.getClientRects().length > 0) {
    const rect = range.getBoundingClientRect();
    return { top: rect.top, left: rect.left, height: rect.height };
  }
  
  // Fallback: insert dummy element to find caret coordinates
  const span = document.createElement('span');
  span.appendChild(document.createTextNode('\u200b')); // Zero-width space
  range.insertNode(span);
  const rect = span.getBoundingClientRect();
  const parent = span.parentNode;
  parent.removeChild(span);
  parent.normalize(); // merge text nodes back
  return { top: rect.top, left: rect.left, height: rect.height };
}

function getStoryTextBeforeCaret() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return editorEl.innerText;
  
  const range = selection.getRangeAt(0);
  
  // Make sure the selection is actually inside the editor
  if (!editorEl.contains(range.startContainer)) {
    return editorEl.innerText;
  }
  
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(editorEl);
  preCaretRange.setEnd(range.startContainer, range.startOffset);
  
  return preCaretRange.toString();
}

// ─── Tooltip Manager ─────────────────────────────────────────────────

function showTooltipDebounced() {
  hideTooltip();
  if (isGenerating || isManualCompleteActive) return;
  
  tooltipTimeout = setTimeout(() => {
    if (document.activeElement === editorEl && editorEl.innerText.trim().length > 0) {
      showTooltip();
    }
  }, 1000); // 1s debounce
}

function showTooltip() {
  const coords = getCaretCoordinates();
  if (!coords) return;
  
  const containerRect = editorContainerEl.getBoundingClientRect();
  
  // Position tooltip relative to editor container scroll position
  let top = coords.top - containerRect.top + editorContainerEl.scrollTop + coords.height + 8;
  let left = coords.left - containerRect.left;
  
  // Boundary constraints
  top = Math.max(0, top);
  left = Math.max(10, Math.min(containerRect.width - 260, left));
  
  tooltipEl.style.top = `${top}px`;
  tooltipEl.style.left = `${left}px`;
  tooltipEl.classList.remove('hidden');
}

function hideTooltip() {
  if (tooltipTimeout) {
    clearTimeout(tooltipTimeout);
    tooltipTimeout = null;
  }
  if (tooltipEl) {
    tooltipEl.classList.add('hidden');
  }
}

// ─── Keyboard Interceptions ──────────────────────────────────────────

function handleEditorKeyDown(e) {
  // If Manual Complete block is active, intercept arrow keys, enter, escape, backspace
  if (isManualCompleteActive && currentSelectionBlock) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const currentHeight = currentSelectionBlock.offsetHeight;
      const newHeight = Math.min(480, currentHeight + 32);
      currentSelectionBlock.style.height = `${newHeight}px`;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const currentHeight = currentSelectionBlock.offsetHeight;
      const newHeight = Math.max(32, currentHeight - 32);
      currentSelectionBlock.style.height = `${newHeight}px`;
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const words = parseInt(currentSelectionBlock.dataset.words, 10) || 12;
      triggerManualGeneration(words);
      return;
    }
    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      cancelManualComplete();
      return;
    }
    
    // Any other key cancels manual complete mode and resumes editing
    cancelManualComplete();
    return;
  }

  // Handle Tab key to trigger manual completion mode
  if (e.key === 'Tab') {
    e.preventDefault();
    startManualComplete();
    return;
  }

  // Handle Enter key inside the editor:
  // If the tooltip is visible, Enter starts Auto complete!
  if (e.key === 'Enter' && !e.shiftKey) {
    if (tooltipEl && !tooltipEl.classList.contains('hidden')) {
      e.preventDefault();
      startAutoComplete();
      return;
    }
  }

  // Hide tooltip immediately on typing
  hideTooltip();
}

// ─── Manual Complete Mode Actions ────────────────────────────────────

function startManualComplete() {
  hideTooltip();
  if (isGenerating || isManualCompleteActive) return;

  isManualCompleteActive = true;
  
  // Create selection block
  const block = document.createElement('div');
  block.className = 'completion-selection-block';
  block.contentEditable = 'false';
  block.style.height = '32px'; // Default 1 line
  block.dataset.words = '12';
  
  const badge = document.createElement('div');
  badge.className = 'completion-badge';
  badge.textContent = 'approx. 12 words (Press Enter)';
  block.appendChild(badge);
  
  // Insert at cursor
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(block);
  
  // Collapse selection after the block
  range.setStartAfter(block);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  
  currentSelectionBlock = block;
  
  // Resize observer to update words count
  const observer = new ResizeObserver(entries => {
    for (let entry of entries) {
      const height = entry.target.offsetHeight;
      const lines = Math.max(1, Math.round(height / 32));
      const words = lines * 12;
      const badgeEl = entry.target.querySelector('.completion-badge');
      if (badgeEl) {
        badgeEl.textContent = `approx. ${words} words (Press Enter)`;
      }
      entry.target.dataset.words = words;
    }
  });
  observer.observe(block);
  block._observer = observer;
  
  editorEl.focus();
}

function cancelManualComplete() {
  if (!isManualCompleteActive || !currentSelectionBlock) return;
  
  if (currentSelectionBlock._observer) {
    currentSelectionBlock._observer.disconnect();
  }
  
  if (currentSelectionBlock.parentNode) {
    currentSelectionBlock.parentNode.removeChild(currentSelectionBlock);
  }
  
  currentSelectionBlock = null;
  isManualCompleteActive = false;
  editorEl.focus();
}

// ─── LLM Completion Core ─────────────────────────────────────────────

async function executeStreamedGeneration(messages) {
  if (isGenerating) return;
  isGenerating = true;
  currentAbortController = new AbortController();

  // Show/Hide buttons
  btnGenerate.classList.add('hidden');
  btnStop.classList.remove('hidden');
  hideTooltip();

  // Create streaming span at caret
  const selection = window.getSelection();
  let range;
  
  if (selection.rangeCount > 0 && editorEl.contains(selection.getRangeAt(0).startContainer)) {
    range = selection.getRangeAt(0);
  } else {
    range = document.createRange();
    range.selectNodeContents(editorEl);
    range.collapse(false); // Collapse to the end of editor
  }
  
  // If manual selection block was active, replace it
  if (isManualCompleteActive && currentSelectionBlock) {
    if (currentSelectionBlock._observer) {
      currentSelectionBlock._observer.disconnect();
    }
    const parent = currentSelectionBlock.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(''), currentSelectionBlock);
    }
    currentSelectionBlock = null;
    isManualCompleteActive = false;
  }
  
  range.deleteContents();
  const streamSpan = document.createElement('span');
  streamSpan.className = 'cowriter-streaming';
  range.insertNode(streamSpan);
  
  // Collapse selection after streaming span
  const nextRange = document.createRange();
  nextRange.setStartAfter(streamSpan);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  
  let fullText = '';
  
  try {
    const settings = settingsStore.get();
    const options = {
      max_tokens: settings.max_tokens || 2048,
      temperature: settings.temperature || 0.7
    };

    await api.streamChat(
      messages,
      currentAbortController.signal,
      (chunk) => {
        fullText += chunk;
        streamSpan.textContent = fullText;
        streamSpan.scrollIntoView({ block: 'nearest' });
      },
      async () => {
        // Done: unwrap span into plain text
        const textNode = document.createTextNode(fullText);
        const parent = streamSpan.parentNode;
        if (parent) {
          parent.replaceChild(textNode, streamSpan);
        }
        
        // Put cursor at the end of the generated text
        const doneRange = document.createRange();
        doneRange.setStartAfter(textNode);
        doneRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(doneRange);
        
        isGenerating = false;
        btnGenerate.classList.remove('hidden');
        btnStop.classList.add('hidden');
        currentAbortController = null;
        
        autoSaveStory();
        editorEl.focus();
      },
      (err) => {
        console.error('CoWriter streaming error:', err);
        // Clean up span
        if (streamSpan.parentNode) {
          streamSpan.parentNode.removeChild(streamSpan);
        }
        isGenerating = false;
        btnGenerate.classList.remove('hidden');
        btnStop.classList.add('hidden');
        currentAbortController = null;
        editorEl.focus();
      },
      options
    );
  } catch (err) {
    console.error('CoWriter request error:', err);
    if (streamSpan.parentNode) {
      streamSpan.parentNode.removeChild(streamSpan);
    }
    isGenerating = false;
    btnGenerate.classList.remove('hidden');
    btnStop.classList.add('hidden');
    currentAbortController = null;
    editorEl.focus();
  }
}

function stopGeneration() {
  if (currentAbortController) {
    currentAbortController.abort();
  }
}

// ─── Action Triggers ─────────────────────────────────────────────────

async function startAutoComplete() {
  if (isGenerating) return;
  const storyTextBeforeCaret = getStoryTextBeforeCaret();
  
  const settings = settingsStore.get();
  const systemPrompt = settings.cowriter_prompt_auto || "You're a professional writer. Analyze, match the tone and adapt to previous writing then write a continuetion of the story.";
  
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Here is the story so far:\n\n${storyTextBeforeCaret}\n\nPlease continue the story naturally.` }
  ];

  await executeStreamedGeneration(messages);
}

async function triggerManualGeneration(wordCount) {
  if (isGenerating) return;
  const storyTextBeforeCaret = getStoryTextBeforeCaret();
  
  const settings = settingsStore.get();
  const basePrompt = settings.cowriter_prompt_manual || "You're a professional writer. Analyze, match the tone and adapt to previous writing then write a continuetion of the story. IMPORTANT: Write exactly {wordCount} words.";
  const systemPrompt = basePrompt.replace('{wordCount}', wordCount);

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Here is the story so far:\n\n${storyTextBeforeCaret}\n\nPlease continue the story.` }
  ];

  await executeStreamedGeneration(messages);
}

async function generateFromInstruction() {
  if (isGenerating) return;
  
  const instruction = nextInstructionInput.value.trim();
  if (!instruction) {
    // If instruction input is empty, fallback to Auto complete
    startAutoComplete();
    return;
  }

  const storyTextBeforeCaret = getStoryTextBeforeCaret();
  const settings = settingsStore.get();
  const lengthVal = lengthDropdownBtn.dataset.value || 'medium';
  
  let lengthConstraint = "3-4 sentences";
  if (lengthVal === 'short') lengthConstraint = "1-2 sentences";
  else if (lengthVal === 'long') lengthConstraint = "5-8 sentences";
  else if (lengthVal === 'custom') {
    const sents = parseInt(customSentencesInput.value, 10) || 3;
    lengthConstraint = `${sents} sentences`;
  }

  const basePrompt = settings.cowriter_prompt_instruction || "You're a professional writer. Analyze, match the tone and adapt to previous writing then write a continuation of the story. Incorporate the direction: \"{instruction}\". Write a continuation of length: {lengthConstraint}.";
  const systemPrompt = basePrompt
    .replace('{instruction}', instruction)
    .replace('{lengthConstraint}', lengthConstraint);

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Here is the story so far:\n\n${storyTextBeforeCaret}\n\nPlease continue the story.` }
  ];

  // Clear instruction input
  nextInstructionInput.value = '';

  await executeStreamedGeneration(messages);
}

// ─── Settings Modal Logic ────────────────────────────────────────────

function openSettings() {
  const settings = settingsStore.get();
  
  promptAutoTextarea.value = settings.cowriter_prompt_auto || "You're a professional writer. Analyze, match the tone and adapt to previous writing then write a continuetion of the story.";
  promptManualTextarea.value = settings.cowriter_prompt_manual || "You're a professional writer. Analyze, match the tone and adapt to previous writing then write a continuetion of the story. IMPORTANT: Write exactly {wordCount} words.";
  promptInstructionTextarea.value = settings.cowriter_prompt_instruction || "You're a professional writer. Analyze, match the tone and adapt to previous writing then write a continuation of the story. Incorporate the direction: \"{instruction}\". Write a continuation of length: {lengthConstraint}.";
  
  openWindow(settingsModal);
}

async function saveSettings() {
  const newSettings = {
    cowriter_prompt_auto: promptAutoTextarea.value.trim(),
    cowriter_prompt_manual: promptManualTextarea.value.trim(),
    cowriter_prompt_instruction: promptInstructionTextarea.value.trim()
  };
  
  await settingsStore.save(newSettings);
  closeWindow(settingsModal);
  showToast('CoWriter settings saved successfully', 'success');
}

// ─── Reasoning Effort Helpers ────────────────────────────────────────

function updateReasoningUI() {
  if (!btnReasoning) return;
  const settings = settingsStore.get();
  const activeEffort = settings.reasoning_effort || 'none';
  
  if (activeEffort === 'none') {
    btnReasoning.style.color = 'var(--text-secondary)';
    btnReasoning.title = 'Reasoning: Off';
  } else {
    btnReasoning.style.color = 'var(--text-accent)';
    btnReasoning.title = `Reasoning: ${activeEffort}`;
  }
  
  if (reasoningMenu) {
    reasoningMenu.querySelectorAll('.reasoning-option').forEach(option => {
      if (option.dataset.value === activeEffort) {
        option.classList.add('active');
      } else {
        option.classList.remove('active');
      }
    });
  }
}

async function toggleReasoningEffort() {
  const settings = settingsStore.get();
  const current = settings.reasoning_effort || 'none';
  
  if (current !== 'none') {
    await settingsStore.save({
      reasoning_effort: 'none',
      previous_reasoning_effort: current
    });
    showToast('Reasoning effort turned OFF', 'info');
  } else {
    const prev = settings.previous_reasoning_effort || 'medium';
    await settingsStore.save({
      reasoning_effort: prev
    });
    showToast(`Reasoning effort turned ON (${prev})`, 'info');
  }
  updateReasoningUI();
}

