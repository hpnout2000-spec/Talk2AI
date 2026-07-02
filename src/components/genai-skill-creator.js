/* ════════════════════════════════════════════════════════════════════
   GenAI Skill Creator — Split-panel skill editor with AI assistance
   ════════════════════════════════════════════════════════════════════ */

import { skillsStore } from '../services/skills-store.js';
import { showToast, showConfirm } from '../main.js';

// ─── State ─────────────────────────────────────────────────────────
export let isSkillCreatorMode = false;
let skillCreatorPanelClosedByUser = false;

let skillCreatorState = {
  name: '',
  filename: null,
  lines: []  // array of strings
};

// ─── Text Splitting ─────────────────────────────────────────────────

/**
 * Split raw text content into an array of lines for the editor.
 * Large paragraphs (no newline) are split at sentence boundaries.
 */
export function splitIntoLines(text) {
  if (!text || !text.trim()) return [''];

  // First split by actual newlines
  const rawLines = text.split(/\r?\n/);
  const result = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trimEnd();
    // If line is short enough — keep as is
    if (trimmed.length <= 140) {
      result.push(trimmed);
      continue;
    }
    // Long line — try to split at sentence endings
    const sentences = trimmed.split(/(?<=[.!?])\s+/);
    if (sentences.length > 1) {
      let current = '';
      for (const sentence of sentences) {
        if (current.length === 0) {
          current = sentence;
        } else if ((current + ' ' + sentence).length <= 140) {
          current += ' ' + sentence;
        } else {
          result.push(current);
          current = sentence;
        }
      }
      if (current.length > 0) result.push(current);
    } else {
      result.push(trimmed);
    }
  }

  // Remove trailing empty lines, but keep at least one
  while (result.length > 1 && result[result.length - 1].trim() === '') {
    result.pop();
  }

  return result.length > 0 ? result : [''];
}

/**
 * Join lines back into text content (newline separated).
 */
function joinLines(lines) {
  return lines.join('\n');
}

// ─── Open / Close ───────────────────────────────────────────────────

/**
 * Open the Skill Creator panel.
 * @param {string|null} content - Existing skill content (to load for editing)
 * @param {string|null} filename - Existing skill filename (for update)
 */
export function openSkillCreator(content = null, filename = null) {
  isSkillCreatorMode = true;
  skillCreatorPanelClosedByUser = false;

  if (content !== null) {
    // Load existing skill
    skillCreatorState.lines = splitIntoLines(content);
    skillCreatorState.name = filename
      ? filename.replace(/\.(txt|json)$/i, '')
      : '';
    skillCreatorState.filename = filename || null;
  } else {
    // New skill
    skillCreatorState.name = '';
    skillCreatorState.filename = null;
    skillCreatorState.lines = [''];
  }

  syncSkillCreatorUI();
  renderSkillEditor();

  // Set name input
  const nameInput = document.getElementById('skill-creator-name-input');
  if (nameInput) nameInput.value = skillCreatorState.name;

  // Notify genai-panel that mode changed
  window.dispatchEvent(new CustomEvent('skill-creator-mode-changed', { detail: { active: true } }));
}

export function exitSkillCreatorMode() {
  isSkillCreatorMode = false;
  skillCreatorPanelClosedByUser = false;
  syncSkillCreatorUI();
  window.dispatchEvent(new CustomEvent('skill-creator-mode-changed', { detail: { active: false } }));
}

// ─── UI Sync ────────────────────────────────────────────────────────

export function syncSkillCreatorUI() {
  const isFullscreen = document.body.classList.contains('genai-fullscreen');
  const panel = document.getElementById('genai-skill-creator-panel');
  const expandBtn = document.getElementById('btn-genai-expand-skill-creation');
  const inputRow = document.querySelector('.genai-input-row');

  if (isSkillCreatorMode) {
    if (isFullscreen) {
      if (skillCreatorPanelClosedByUser) {
        document.body.classList.remove('genai-skill-creator-active');
        if (panel) panel.classList.add('hidden');
        if (inputRow) inputRow.style.setProperty('display', 'flex', 'important');
        if (expandBtn) expandBtn.classList.remove('hidden');
      } else {
        document.body.classList.add('genai-skill-creator-active');
        if (panel) panel.classList.remove('hidden');
        if (inputRow) inputRow.style.setProperty('display', 'flex', 'important');
        if (expandBtn) expandBtn.classList.add('hidden');
      }
    } else {
      // Active but collapsed (non-fullscreen)
      document.body.classList.remove('genai-skill-creator-active');
      if (panel) panel.classList.add('hidden');
      if (inputRow) inputRow.style.setProperty('display', 'none', 'important');
      if (expandBtn) expandBtn.classList.remove('hidden');
    }
  } else {
    document.body.classList.remove('genai-skill-creator-active');
    if (panel) panel.classList.add('hidden');
    if (inputRow) inputRow.style.removeProperty('display');
    if (expandBtn) expandBtn.classList.add('hidden');
  }
}

// ─── Render Lines ───────────────────────────────────────────────────

export function renderSkillEditor() {
  const container = document.getElementById('skill-creator-lines-container');
  if (!container) return;

  container.innerHTML = '';

  skillCreatorState.lines.forEach((lineText, idx) => {
    const row = createLineRow(idx, lineText);
    container.appendChild(row);
  });

  // Add line button at the bottom
  const addBtn = document.createElement('button');
  addBtn.className = 'skill-creator-add-line-btn';
  addBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    Add line
  `;
  addBtn.addEventListener('click', () => {
    addLineAfter(skillCreatorState.lines.length - 1);
  });
  container.appendChild(addBtn);

  // Resize all textareas after they are in the DOM
  requestAnimationFrame(() => {
    container.querySelectorAll('.skill-line-input').forEach(ta => autoResizeTextarea(ta));
  });
}

function createLineRow(idx, text) {
  const row = document.createElement('div');
  row.className = 'skill-line-row';
  row.dataset.idx = idx;

  const num = document.createElement('span');
  num.className = 'skill-line-number';
  num.textContent = idx + 1;

  const textarea = document.createElement('textarea');
  textarea.className = 'skill-line-input';
  textarea.value = text;
  textarea.rows = 1;
  textarea.placeholder = idx === 0 && !text ? 'Start typing your skill content...' : '';

  // Auto-resize
  autoResizeTextarea(textarea);
  textarea.addEventListener('input', () => {
    skillCreatorState.lines[idx] = textarea.value;
    autoResizeTextarea(textarea);
  });

  // Enter key = create new line below
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addLineAfter(idx);
    }
    // Backspace on empty line = remove it and focus previous
    if (e.key === 'Backspace' && textarea.value === '' && skillCreatorState.lines.length > 1) {
      e.preventDefault();
      removeLineAt(idx);
    }
  });

  // Delete row button
  const delBtn = document.createElement('button');
  delBtn.className = 'skill-line-delete-btn';
  delBtn.title = 'Remove line';
  delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  delBtn.addEventListener('click', () => {
    if (skillCreatorState.lines.length > 1) {
      removeLineAt(idx);
    } else {
      skillCreatorState.lines[0] = '';
      renderSkillEditor();
    }
  });

  row.appendChild(num);
  row.appendChild(textarea);
  row.appendChild(delBtn);
  return row;
}

function autoResizeTextarea(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(36, ta.scrollHeight) + 'px';
}

function addLineAfter(idx) {
  skillCreatorState.lines.splice(idx + 1, 0, '');
  renderSkillEditor();
  // Focus the new line
  setTimeout(() => {
    const container = document.getElementById('skill-creator-lines-container');
    if (!container) return;
    const rows = container.querySelectorAll('.skill-line-row');
    const nextRow = rows[idx + 1];
    if (nextRow) {
      const ta = nextRow.querySelector('.skill-line-input');
      if (ta) ta.focus();
    }
  }, 30);
}

function removeLineAt(idx) {
  skillCreatorState.lines.splice(idx, 1);
  renderSkillEditor();
  // Focus previous line
  setTimeout(() => {
    const container = document.getElementById('skill-creator-lines-container');
    if (!container) return;
    const prevIdx = Math.max(0, idx - 1);
    const rows = container.querySelectorAll('.skill-line-row');
    const prevRow = rows[prevIdx];
    if (prevRow) {
      const ta = prevRow.querySelector('.skill-line-input');
      if (ta) {
        ta.focus();
        ta.selectionStart = ta.value.length;
        ta.selectionEnd = ta.value.length;
      }
    }
  }, 30);
}

// ─── AI Actions (called by genai-panel parser) ────────────────────────

/**
 * AI edits an existing line (1-indexed as shown to user).
 */
export function aiEditSkillLine(lineNumber, newText) {
  const idx = lineNumber - 1;
  if (idx < 0 || idx >= skillCreatorState.lines.length) {
    showToast(`Line ${lineNumber} doesn't exist`, 'error');
    return;
  }
  skillCreatorState.lines[idx] = newText;
  renderSkillEditor();
  highlightLine(idx);
}

/**
 * AI adds new lines after a given line number (1-indexed).
 * Pass 0 to add at the start.
 */
export function aiAddSkillLines(afterLineNumber, newLines) {
  const insertAt = afterLineNumber;
  if (!Array.isArray(newLines)) newLines = [newLines];
  skillCreatorState.lines.splice(insertAt, 0, ...newLines);
  renderSkillEditor();
  if (insertAt < skillCreatorState.lines.length) {
    highlightLine(insertAt);
  }
}

/**
 * AI sets the skill name.
 */
export function aiSetSkillName(name) {
  skillCreatorState.name = name;
  const nameInput = document.getElementById('skill-creator-name-input');
  if (nameInput) {
    nameInput.value = name;
    nameInput.style.transition = 'box-shadow 0.3s ease';
    nameInput.style.boxShadow = '0 0 0 2px var(--accent-primary)';
    setTimeout(() => { nameInput.style.boxShadow = ''; }, 1200);
  }
}

function highlightLine(idx) {
  setTimeout(() => {
    const container = document.getElementById('skill-creator-lines-container');
    if (!container) return;
    const rows = container.querySelectorAll('.skill-line-row');
    const row = rows[idx];
    if (row) {
      row.classList.add('skill-line-highlight');
      setTimeout(() => row.classList.remove('skill-line-highlight'), 1500);
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 60);
}

// ─── Context for AI ─────────────────────────────────────────────────

export function getSkillCreatorContext() {
  const lines = skillCreatorState.lines.map((line, i) => `${i + 1}. ${line}`).join('\n');
  return `Current Skill: "${skillCreatorState.name || 'Untitled'}"\n\nLines:\n${lines}`;
}

export function getSkillCreatorName() { return skillCreatorState.name; }
export function getSkillCreatorLines() { return skillCreatorState.lines; }

// ─── Save / Discard ──────────────────────────────────────────────────

async function handleSave() {
  const nameInput = document.getElementById('skill-creator-name-input');
  const name = (nameInput ? nameInput.value.trim() : skillCreatorState.name.trim());

  if (!name) {
    showToast('Please enter a skill name', 'error');
    if (nameInput) nameInput.focus();
    return;
  }

  skillCreatorState.name = name;
  const content = joinLines(skillCreatorState.lines.filter(l => l.trim().length > 0));

  if (!content.trim()) {
    showToast('Skill content is empty', 'error');
    return;
  }

  const filename = name.endsWith('.txt') || name.endsWith('.json')
    ? name
    : name + '.txt';

  try {
    await skillsStore.saveSkill(filename, content);
    showToast(`Skill "${name}" saved successfully`);
    skillCreatorState.filename = filename;
    if (window.renderSkills) window.renderSkills();
    exitSkillCreatorMode();
  } catch (err) {
    showToast(`Failed to save skill: ${err.message}`, 'error');
  }
}

async function handleDiscard() {
  const hasContent = skillCreatorState.lines.some(l => l.trim().length > 0);
  if (hasContent || skillCreatorState.name) {
    const confirmed = await showConfirm(
      'Discard Skill',
      'Are you sure you want to discard all changes?'
    );
    if (!confirmed) return;
  }
  exitSkillCreatorMode();
}

// ─── Init ─────────────────────────────────────────────────────────────

export function initGenAISkillCreator() {
  const nameInput = document.getElementById('skill-creator-name-input');
  const btnDiscard = document.getElementById('btn-skill-creator-discard');
  const btnSave = document.getElementById('btn-skill-creator-save');
  const btnClose = document.getElementById('btn-close-skill-creator');
  const expandBtn = document.getElementById('btn-genai-expand-skill-creation');

  if (nameInput) {
    nameInput.addEventListener('input', () => {
      skillCreatorState.name = nameInput.value;
    });
  }

  if (btnDiscard) btnDiscard.addEventListener('click', handleDiscard);
  if (btnSave) btnSave.addEventListener('click', handleSave);

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      skillCreatorPanelClosedByUser = true;
      syncSkillCreatorUI();
    });
  }

  if (expandBtn) {
    expandBtn.addEventListener('click', () => {
      document.body.classList.add('genai-fullscreen');
      const fullscreenBtn = document.getElementById('btn-genai-fullscreen');
      if (fullscreenBtn) fullscreenBtn.title = 'Collapse from fullscreen';
      skillCreatorPanelClosedByUser = false;
      syncSkillCreatorUI();
    });
  }

  // Re-sync UI when fullscreen state changes
  window.addEventListener('genai-fullscreen-changed', () => {
    if (isSkillCreatorMode) syncSkillCreatorUI();
  });
}

// ─── Global Expose ────────────────────────────────────────────────────
window.openSkillCreator = openSkillCreator;
window.aiEditSkillLine = aiEditSkillLine;
window.aiAddSkillLines = aiAddSkillLines;
window.aiSetSkillName = aiSetSkillName;
window.getSkillCreatorContext = getSkillCreatorContext;
window.isSkillCreatorModeActive = () => isSkillCreatorMode;
window.exitSkillCreatorMode = exitSkillCreatorMode;
window.syncSkillCreatorUI = syncSkillCreatorUI;

export function getSkillCreatorState() {
  return skillCreatorState;
}

export function setSkillCreatorState(state) {
  if (state) {
    skillCreatorState = {
      name: state.name || '',
      filename: state.filename || null,
      lines: Array.isArray(state.lines) ? [...state.lines] : ['']
    };
  }
}

window.getSkillCreatorState = getSkillCreatorState;
window.setSkillCreatorState = setSkillCreatorState;
