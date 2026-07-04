/* ════════════════════════════════════════════════════════════════════
   Game View Component
   ════════════════════════════════════════════════════════════════════ */

import { gameStore } from '../services/game-store.js';
import { characterStore } from '../services/character-store.js';
import { api } from '../services/api.js';
import { showPrompt } from '../main.js';
import { uiManager } from '../utils/ui-manager.js';

let isGenerating = false;

// Word-by-word streaming renderer state
let renderedText = "";
let streamingChoices = [];
let streamingExtraActions = [];
let streamingTextStates = [];

function resetStreamingRenderer() {
  renderedText = "";
  streamingChoices = [];
  streamingExtraActions = [];
  streamingTextStates = [];
  const textContainer = document.getElementById('game-scene-text');
  if (textContainer) textContainer.innerHTML = '';
  removeGameCursor();
}

function cleanCharacterName(name) {
  if (!name) return '';
  // Support both {{char:Name}} and {{char:Name|Alias}}
  let clean = name;
  const match = clean.match(/\{\{char:([^|}]+)(?:\|([^}]+))?\}\}/);
  if (match) {
    clean = match[1];
  }
  return clean.replace(/\{\{char:/g, '').replace(/\}\}/g, '').replace(/char:/g, '').trim();
}

function stripCharTagsForUI(text) {
  if (!text) return '';
  return text.replace(/\{\{char:([^|}]+)(?:\|([^}]+))?\}\}/g, (match, name, alias) => {
    return alias ? alias.trim() : name.trim();
  });
}

function stripJsonBlocks(text, isStreaming = false) {
  if (!text) return '';
  
  let cleaned = text;

  // 1. Remove complete markdown JSON blocks
  cleaned = cleaned.replace(/```json[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/```[\s\S]*?```/g, (match) => {
    const inner = match.slice(3, -3).trim();
    if ((inner.startsWith('{') && inner.endsWith('}')) || (inner.startsWith('[') && inner.endsWith(']'))) {
      return '';
    }
    return match;
  });

  // 2. If streaming, remove any incomplete markdown code blocks starting with ```json or ```{
  if (isStreaming) {
    const index = cleaned.indexOf('```json');
    if (index !== -1) {
      cleaned = cleaned.substring(0, index);
    }
    const indexPlain = cleaned.indexOf('```');
    if (indexPlain !== -1) {
      const rest = cleaned.substring(indexPlain + 3).trim();
      if (rest.startsWith('{') || rest.startsWith('[')) {
        cleaned = cleaned.substring(0, indexPlain);
      }
    }
    // Hide partial char mentions so they don't leak as raw text during streaming
    cleaned = cleaned.replace(/\{\{[^}]*$/, '');
  }

  // 3. Remove raw trailing JSON objects or arrays
  const lastCurly = cleaned.lastIndexOf('{');
  if (lastCurly !== -1) {
    const candidate = cleaned.substring(lastCurly).trim();
    if (candidate.startsWith('{') && (candidate.includes('":') || candidate.endsWith('}'))) {
      cleaned = cleaned.substring(0, lastCurly);
    }
  }
  const lastSquare = cleaned.lastIndexOf('[');
  if (lastSquare !== -1) {
    const candidate = cleaned.substring(lastSquare).trim();
    if (candidate.startsWith('[') && (candidate.includes('{') || candidate.endsWith(']')) && !candidate.toLowerCase().includes('loader:')) {
      cleaned = cleaned.substring(0, lastSquare);
    }
  }

  return cleaned.trim();
}

function tokenizeText(text) {
  return text.match(/(\{\{char:[^}]*\}\}|\n|[ ]+|[^\s\n]+)/g) || [];
}

function parsePartialSceneText(partialJson) {
  try {
    const parsed = JSON.parse(partialJson);
    if (parsed && typeof parsed.scene_text === 'string') {
      return parsed.scene_text;
    }
  } catch (e) {}

  const matchClosed = partialJson.match(/"scene_text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
  if (matchClosed) {
    try {
      return JSON.parse('"' + matchClosed[1] + '"');
    } catch {
      return matchClosed[1];
    }
  }
  
  const matchPartial = partialJson.match(/"scene_text"\s*:\s*"(.*)/);
  if (matchPartial) {
    let clean = matchPartial[1];
    clean = clean.replace(/\\$/, '');
    try {
      return JSON.parse('"' + clean.replace(/"/g, '\\"') + '"');
    } catch {
      return clean;
    }
  }
  return '';
}

function parsePartialTextStates(partialJson) {
  const match = partialJson.match(/"text_states"\s*:\s*\[(.*?)\]/s);
  let content = '';
  if (match) {
    content = match[1];
  } else {
    const matchPartial = partialJson.match(/"text_states"\s*:\s*\[(.*)/s);
    if (matchPartial) content = matchPartial[1];
  }
  if (!content) return null;
  
  const states = [];
  const objRegex = /\{[^{}]*\}/g;
  let m;
  while ((m = objRegex.exec(content)) !== null) {
    try {
      const obj = JSON.parse(m[0]);
      if (obj.text) states.push(obj);
    } catch {}
  }
  return states;
}

function parsePartialExtraActions(partialJson) {
  const match = partialJson.match(/"extra_actions"\s*:\s*\[(.*?)\]/s);
  let content = '';
  if (match) {
    content = match[1];
  } else {
    const matchPartial = partialJson.match(/"extra_actions"\s*:\s*\[(.*)/s);
    if (matchPartial) content = matchPartial[1];
  }
  if (!content) return null;
  const strings = [];
  const stringRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
  let m;
  while ((m = stringRegex.exec(content)) !== null) {
    strings.push(m[1]);
  }
  return strings;
}

function parsePartialChoices(partialJson) {
  const match = partialJson.match(/"choices"\s*:\s*\[(.*?)\]/s);
  let content = '';
  if (match) {
    content = match[1];
  } else {
    const matchPartial = partialJson.match(/"choices"\s*:\s*\[(.*)/s);
    if (matchPartial) content = matchPartial[1];
  }
  if (!content) return null;
  
  const choices = [];
  const objRegex = /\{[^{}]*\}/g;
  let m;
  while ((m = objRegex.exec(content)) !== null) {
    try {
      const obj = JSON.parse(m[0]);
      if (obj.text) choices.push(obj);
    } catch {}
  }
  return choices;
}

function renderStreamingTextStates(states) {
  const container = document.getElementById('game-text-states');
  if (!container) return;
  if (streamingTextStates.length === 0 && states.length > 0) {
    container.innerHTML = '';
  }
  for (let i = streamingTextStates.length; i < states.length; i++) {
    const state = states[i];
    const el = document.createElement('span');
    const color = ['green', 'red', 'white'].includes(state.color) ? state.color : 'white';
    el.className = `game-text-state color-${color}`;
    el.textContent = state.text;
    el.style.animationDelay = `0s`;
    container.appendChild(el);
  }
  streamingTextStates = states;
}

function renderStreamingExtraActions(actions) {
  const container = document.getElementById('game-extra-actions');
  if (!container) return;
  if (streamingExtraActions.length === 0 && actions.length > 0) {
    container.innerHTML = '';
  }
  for (let i = streamingExtraActions.length; i < actions.length; i++) {
    const action = actions[i];
    const btn = document.createElement('button');
    btn.className = 'btn-extra-action';
    btn.textContent = action;
    btn.style.animationDelay = `0s`;
    btn.disabled = true;
    btn.onclick = () => handleExtraAction(action);
    container.appendChild(btn);
  }
  streamingExtraActions = actions;
}

function renderStreamingChoices(choices) {
  const container = document.getElementById('game-choices');
  if (!container) return;
  for (let i = streamingChoices.length; i < choices.length; i++) {
    const choice = choices[i];
    const btn = document.createElement('button');
    btn.className = 'btn-choice';
    btn.textContent = choice.text;
    btn.style.animationDelay = `0s`;
    btn.disabled = true;
    btn.onclick = () => handleChoice(choice);
    container.appendChild(btn);
  }
  streamingChoices = choices;
}

// Persistent floating cursor element for smooth glide animation
let _gameCursor = null;
let _cursorRafId = null;

function getOrCreateGameCursor(container) {
  if (!_gameCursor || !_gameCursor.isConnected) {
    _gameCursor = document.createElement('span');
    _gameCursor.className = 'streaming-cursor streaming-cursor--float';
    // Place it relative to the game-main scroll container
    const anchor = container.closest('.game-main') || container.parentElement;
    anchor.style.position = 'relative';
    anchor.appendChild(_gameCursor);
  }
  return _gameCursor;
}

function repositionGameCursor(container) {
  if (_cursorRafId) cancelAnimationFrame(_cursorRafId);
  _cursorRafId = requestAnimationFrame(() => {
    const cursor = _gameCursor;
    if (!cursor || !cursor.isConnected) return;

    // Find the last text / inline node in the container
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        if (node.tagName === 'BR') return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      }
    });
    let lastNode = null;
    while (walker.nextNode()) lastNode = walker.currentNode;

    const anchorEl = cursor.parentElement;
    const anchorRect = anchorEl.getBoundingClientRect();

    let x = 0, y = 0;
    if (lastNode) {
      const range = document.createRange();
      if (lastNode.nodeType === Node.TEXT_NODE) {
        range.setStart(lastNode, lastNode.length);
        range.setEnd(lastNode, lastNode.length);
      } else {
        range.selectNode(lastNode);
      }
      const rect = range.getBoundingClientRect();
      x = rect.right - anchorRect.left;
      y = rect.top - anchorRect.top + (rect.height - cursor.offsetHeight) / 2 + anchorEl.scrollTop;
    }

    cursor.style.transform = `translate(${x}px, ${y}px)`;
  });
}

function removeGameCursor() {
  if (_cursorRafId) { cancelAnimationFrame(_cursorRafId); _cursorRafId = null; }
  if (_gameCursor && _gameCursor.isConnected) _gameCursor.remove();
  _gameCursor = null;
}

function updateStreamingText(text, isComplete) {
  const textContainer = document.getElementById('game-scene-text');
  if (!textContainer) return;

  // Clean the input text by stripping raw or partial JSON blocks
  const cleanedText = stripJsonBlocks(text, !isComplete);

  if (cleanedText.length < renderedText.length) {
    resetStreamingRenderer();
  }

  const newText = cleanedText.slice(renderedText.length);
  
  // If it's complete, render full text and remove the floating cursor
  if (isComplete) {
    let formattedText = cleanedText
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
    formattedText = processCharacterMentions(formattedText);
    textContainer.innerHTML = formattedText;
    renderedText = cleanedText;
    removeGameCursor();
    return;
  }

  if (!newText) return;

  const tokens = tokenizeText(newText);

  tokens.forEach(token => {
    if (token === '\n') {
      const br = document.createElement('br');
      textContainer.appendChild(br);
    } else if (/^[ ]+$/.test(token)) {
      const space = document.createTextNode(token);
      textContainer.appendChild(space);
    } else {
      let formatted = token
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>');
        
      formatted = processCharacterMentions(formatted);

      const span = document.createElement('span');
      span.className = 'word-stream';
      span.innerHTML = formatted;
      textContainer.appendChild(span);
    }
  });

  // Ensure cursor exists and reposition it smoothly
  getOrCreateGameCursor(textContainer);
  repositionGameCursor(textContainer);
  renderedText = cleanedText;
}

function showStartScreen() {
  const startScreen = document.getElementById('game-start-screen');
  const sceneContent = document.getElementById('game-scene-content');
  if (startScreen) {
    startScreen.classList.remove('hidden');
    startScreen.style.display = 'flex';
  }
  if (sceneContent) {
    sceneContent.classList.add('hidden');
    sceneContent.style.display = 'none';
  }

  // Reset sidebar text states and extra actions since there is no active scene
  const textStatesContainer = document.getElementById('game-text-states');
  const extraActionsContainer = document.getElementById('game-extra-actions');
  if (textStatesContainer) {
    textStatesContainer.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-tertiary); font-style: italic;">Normal</div>';
  }
  if (extraActionsContainer) {
    extraActionsContainer.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-tertiary); font-style: italic;">None</div>';
  }
  
  // Reset prompt input
  const startPrompt = document.getElementById('game-start-prompt');
  if (startPrompt) {
    startPrompt.value = '';
  }

  // Set language select value to match current game (default Russian)
  const languageSelect = document.getElementById('game-start-language');
  if (languageSelect) {
    const activeGame = gameStore.get();
    languageSelect.value = (activeGame && activeGame.language) ? activeGame.language : 'Russian';
  }

  // Set story prompt value to match current game
  const storyPromptInput = document.getElementById('game-start-story-prompt');
  if (storyPromptInput) {
    const activeGame = gameStore.get();
    storyPromptInput.value = (activeGame && activeGame.story_prompt) ? activeGame.story_prompt : '';
  }
}

function showSceneContent() {
  const startScreen = document.getElementById('game-start-screen');
  const sceneContent = document.getElementById('game-scene-content');
  if (startScreen) {
    startScreen.classList.add('hidden');
    startScreen.style.display = 'none';
  }
  if (sceneContent) {
    sceneContent.classList.remove('hidden');
    sceneContent.style.display = 'flex';
  }
}

// ─── Game History Features ───
let isHistoryExpanded = false;

function toggleGameHistory() {
  const container = document.getElementById('game-history-container');
  const btn = document.getElementById('btn-toggle-game-history');
  if (!container || !btn) return;

  isHistoryExpanded = !isHistoryExpanded;

  if (isHistoryExpanded) {
    container.classList.add('expanded');
    btn.classList.add('expanded');
    btn.querySelector('span').textContent = 'Hide Story History';
    renderGameHistory();
  } else {
    container.classList.remove('expanded');
    btn.classList.remove('expanded');
    btn.querySelector('span').textContent = 'View Story History';
  }
}

function renderGameHistory() {
  const container = document.getElementById('game-history-container');
  if (!container) return;

  const game = gameStore.get();
  if (!game) return;

  const history = game.history || [];
  const summarizedCount = game.summarized_count || 0;
  
  if (history.length === 0 && !game.summary) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-tertiary); font-style: italic; padding: 20px 0; font-size: 0.85rem;">No story history yet. This is your first scene!</div>';
    return;
  }

  container.innerHTML = '';

  // 1. Prepend Chronicle Summary Card if it exists
  if (game.summary) {
    const summaryCard = document.createElement('div');
    summaryCard.className = 'history-summary-card';
    summaryCard.innerHTML = `
      <div class="history-summary-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; color: var(--text-accent); flex-shrink: 0;">
          <path d="M12 20h9M3 20v-8a2 2 0 0 1 2-2h4l2-3 2 3h4a2 2 0 0 1 2 2v8"></path>
        </svg>
        <span>CHRONICLE (SUMMARIZED)</span>
      </div>
      <div class="history-summary-body">${game.summary.replace(/\n/g, '<br>')}</div>
    `;
    container.appendChild(summaryCard);

    // Add a timeline transition tag if detailed history follows
    if (history.length > summarizedCount) {
      const divider = document.createElement('div');
      divider.className = 'history-action-divider';
      divider.innerHTML = `<div class="history-player-action" style="background: rgba(255,255,255,0.04); border-color: var(--border-subtle); color: var(--text-tertiary); font-size: 0.75rem;">Detailed Chronology Begins</div>`;
      container.appendChild(divider);
    }
  }

  // 2. Render remaining detailed history scenes starting from the summarized count index
  const detailedScenes = history.slice(summarizedCount);

  detailedScenes.forEach((scene) => {
    // Render Scene Text
    const sceneEl = document.createElement('div');
    sceneEl.className = 'history-scene-text';
    let textHtml = scene.scene_text
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
      
    textHtml = processCharacterMentions(textHtml);
      
    sceneEl.innerHTML = textHtml;
    container.appendChild(sceneEl);

    // Render player transition action if saved
    if (scene.player_action) {
      const divider = document.createElement('div');
      divider.className = 'history-action-divider';

      const actionBadge = document.createElement('div');
      actionBadge.className = 'history-player-action';
      actionBadge.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 14px; height: 14px;">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <span>${scene.player_action}</span>
      `;
      divider.appendChild(actionBadge);

      if (scene.player_note) {
        const noteEl = document.createElement('div');
        noteEl.className = 'history-player-note';
        noteEl.textContent = `Note to GM: "${scene.player_note}"`;
        divider.appendChild(noteEl);
      }

      container.appendChild(divider);
    }
  });

  // Scroll to bottom so latest updates are visible
  container.scrollTop = container.scrollHeight;
}

function resetHistoryUI() {
  isHistoryExpanded = false;
  const container = document.getElementById('game-history-container');
  const btn = document.getElementById('btn-toggle-game-history');
  if (container) {
    container.classList.remove('expanded');
    container.innerHTML = '';
  }
  if (btn) {
    btn.classList.remove('expanded');
    btn.querySelector('span').textContent = 'View Story History';
  }
  closeSummarizeHistoryModal();
  closeGameCharactersModal();
}

// ─── Game History Summarization ───
function openSummarizeHistoryModal() {
  const modal = document.getElementById('summarize-history-modal');
  if (!modal) return;

  const game = gameStore.get();
  if (!game) return;

  const history = game.history || [];
  const totalScenes = history.length;
  const currentSummarizedCount = game.summarized_count || 0;
  
  // We summarize everything up to totalScenes - 1 (excluding second-to-last and last)
  const newScenesToSummarize = history.slice(currentSummarizedCount, totalScenes - 1);
  
  const infoBlock = document.getElementById('summary-info-block');
  const previewContainer = document.getElementById('summary-preview-container');
  const editor = document.getElementById('summary-text-editor');
  const generateBtn = document.getElementById('btn-generate-ai-summary');
  const saveBtn = document.getElementById('btn-save-summary-action');

  // Load existing summary
  if (editor) {
    editor.value = game.summary || "";
  }

  if (newScenesToSummarize.length === 0) {
    if (infoBlock) {
      infoBlock.innerHTML = `<strong>Status:</strong> Not enough narrative history yet. You must play at least a few steps further before you can compress early history (since the Game Master must always keep details of the last 2 steps).`;
      infoBlock.style.background = 'rgba(239, 68, 68, 0.08)';
      infoBlock.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      infoBlock.style.color = '#ef4444';
    }
    if (previewContainer) {
      previewContainer.innerHTML = '<div style="text-align: center; color: #94a3b8; font-style: italic; padding: 12px 0;">No scenes available for compression at this time.</div>';
    }
    if (generateBtn) generateBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
  } else {
    if (infoBlock) {
      infoBlock.innerHTML = `<strong>Action Ready:</strong> This will compress <strong>${newScenesToSummarize.length}</strong> past scene(s) into your adventure summary. The latest 2 steps will remain fully detailed.`;
      infoBlock.style.background = 'rgba(14, 165, 233, 0.08)';
      infoBlock.style.borderColor = 'rgba(14, 165, 233, 0.2)';
      infoBlock.style.color = '#cbd5e1';
    }
    if (generateBtn) generateBtn.disabled = false;
    if (saveBtn) saveBtn.disabled = false;

    // Fill in the preview list
    if (previewContainer) {
      previewContainer.innerHTML = '';
      newScenesToSummarize.forEach((scene, index) => {
        const item = document.createElement('div');
        item.style.marginBottom = '12px';
        item.style.paddingBottom = '12px';
        item.style.borderBottom = index === newScenesToSummarize.length - 1 ? 'none' : '1px solid var(--border-subtle)';
        
        item.innerHTML = `
          <div style="font-weight: 600; color: var(--text-accent); margin-bottom: 4px;">Step ${currentSummarizedCount + index + 1}</div>
          <div style="margin-bottom: 6px; color: #cbd5e1;">${scene.scene_text.substring(0, 150)}...</div>
          ${scene.player_action ? `<div style="font-size: 0.75rem; color: var(--text-accent); margin-top: 4px;"><strong>Action taken:</strong> ${scene.player_action}</div>` : ''}
          ${scene.player_note ? `<div style="font-size: 0.75rem; color: #94a3b8; font-style: italic; margin-top: 2px;"><strong>Note:</strong> ${scene.player_note}</div>` : ''}
        `;
        previewContainer.appendChild(item);
      });
    }
  }

  uiManager.open('summarize-history-modal');
}

function closeSummarizeHistoryModal() {
  uiManager.close('summarize-history-modal');
}

async function triggerAISummarization() {
  const game = gameStore.get();
  if (!game) return;

  const history = game.history || [];
  const totalScenes = history.length;
  const currentSummarizedCount = game.summarized_count || 0;
  const newScenesToSummarize = history.slice(currentSummarizedCount, totalScenes - 1);

  if (newScenesToSummarize.length === 0) return;

  const loader = document.getElementById('ai-summary-loader');
  const generateBtn = document.getElementById('btn-generate-ai-summary');
  const saveBtn = document.getElementById('btn-save-summary-action');
  const editor = document.getElementById('summary-text-editor');

  if (loader) loader.style.display = 'flex';
  if (generateBtn) generateBtn.disabled = true;
  if (saveBtn) saveBtn.disabled = true;

  try {
    const language = game.language || 'Russian';
    const summaryResult = await api.generateAdventureSummary(game.summary || "", newScenesToSummarize, language);
    if (editor && summaryResult) {
      editor.value = summaryResult.trim();
    }
  } catch (err) {
    console.error(err);
    alert('Failed to generate summary with AI. Please check console.');
  } finally {
    if (loader) loader.style.display = 'none';
    if (generateBtn) generateBtn.disabled = false;
    if (saveBtn) saveBtn.disabled = false;
  }
}

function saveSummaryAndCompress() {
  const game = gameStore.get();
  if (!game) return;

  const editor = document.getElementById('summary-text-editor');
  const newSummary = editor ? editor.value.trim() : "";

  if (!newSummary) {
    alert("Please write or generate a summary before compressing history.");
    return;
  }

  const history = game.history || [];
  const totalScenes = history.length;

  // Compress and save
  game.summary = newSummary;
  game.summarized_count = totalScenes - 1;
  gameStore.save();

  // If expanded history is visible, refresh it
  if (isHistoryExpanded) {
    renderGameHistory();
  }

  closeSummarizeHistoryModal();
}

// ─── Game Characters Modal ───
function openGameCharactersModal() {
  const game = gameStore.get();
  if (!game) return;

  uiManager.open('game-characters-modal');
  renderGameCharacters();
}

function closeGameCharactersModal() {
  uiManager.close('game-characters-modal');
}

function renderGameCharacters() {
  const container = document.getElementById('game-characters-list');
  if (!container) return;

  const game = gameStore.get();
  if (!game) return;

  const characters = game.characters || [];
  container.innerHTML = '';

  if (characters.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-tertiary); font-style: italic; padding: 20px 0; font-size: 0.85rem;">
        No characters yet. The AI Game Master will add characters as the story progresses, or you can add them manually.
      </div>
    `;
    return;
  }

  characters.forEach((char) => {
    const card = document.createElement('div');
    card.className = 'game-character-card';
    card.style.background = 'rgba(255, 255, 255, 0.03)';
    card.style.border = '1px solid var(--border-light)';
    card.style.borderRadius = 'var(--radius-md)';
    card.style.padding = '12px 16px';
    card.style.marginBottom = '8px';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '8px';
    card.style.transition = 'all 0.2s ease';

    card.onmouseenter = () => {
      card.style.background = 'rgba(255, 255, 255, 0.05)';
      card.style.borderColor = 'var(--border-subtle)';
    };
    card.onmouseleave = () => {
      card.style.background = 'rgba(255, 255, 255, 0.03)';
      card.style.borderColor = 'var(--border-light)';
    };

    const hasDetails = !!char.details;
    const shortDesc = char.short_description || '';

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-tertiary); border: 1px solid var(--border-light); display: flex; align-items: center; justify-content: center; color: var(--text-accent); flex-shrink: 0;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
              <circle cx="12" cy="8" r="4"></circle>
              <path d="M20 21a8 8 0 1 0-16 0"></path>
            </svg>
          </div>
          <div style="min-width: 0; display: flex; flex-direction: column; gap: 2px;">
            <div style="font-weight: 600; color: #f8fafc; font-size: 0.95rem; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span>${char.name}</span>
              ${char.system_prompt ? `
                <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.65rem; color: #38bdf8; background: rgba(14, 165, 233, 0.15); padding: 1px 6px; border-radius: 10px; border: 1px solid rgba(14, 165, 233, 0.3); font-weight: 500;" title="Individual AI behavior directive is configured">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 8px; height: 8px;">
                    <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                    <polyline points="2 17 12 22 22 17"></polyline>
                    <polyline points="2 12 12 17 22 12"></polyline>
                  </svg>
                  <span>Directive</span>
                </span>
              ` : ''}
            </div>
            ${shortDesc ? `<div style="font-size: 0.8rem; color: #94a3b8; line-height: 1.4; margin-top: 2px;">${shortDesc}</div>` : ''}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: 8px;">
          <button class="btn-secondary small btn-char-edit" data-name="${char.name}" style="padding: 4px 10px; font-size: 0.75rem; border-radius: 20px; border: 1px solid var(--border-light); cursor: pointer;" title="Edit character">
            Edit
          </button>
          <button class="btn-secondary small btn-char-details" data-name="${char.name}" style="padding: 4px 10px; font-size: 0.75rem; border-radius: 20px; border: 1px solid var(--border-light); cursor: pointer;">
            ${hasDetails ? 'Update Details...' : 'Details...'}
          </button>
          <button class="btn-icon small btn-char-delete" data-name="${char.name}" style="color: var(--danger, #ef4444); padding: 4px; cursor: pointer;" title="Remove character">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
      
      ${hasDetails ? `
        <div class="char-details-box" style="margin-top: 6px; padding: 10px 12px; background: rgba(15, 15, 20, 0.6); border-radius: var(--radius-sm); border-left: 3px solid var(--text-accent); font-size: 0.85rem; line-height: 1.5; color: #cbd5e1; white-space: pre-line;">
          ${char.details}
        </div>
      ` : ''}
    `;

    // Bind details click
    const detailsBtn = card.querySelector('.btn-char-details');
    if (detailsBtn) {
      detailsBtn.onclick = () => fetchCharacterDetails(char.name);
    }

    // Bind edit click
    const editBtn = card.querySelector('.btn-char-edit');
    if (editBtn) {
      editBtn.onclick = () => openEditCharacterDialog(char);
    }

    // Bind delete click
    const deleteBtn = card.querySelector('.btn-char-delete');
    if (deleteBtn) {
      deleteBtn.onclick = () => {
        if (confirm(`Remove character "${char.name}"?`)) {
          gameStore.removeCharacter(char.name);
          renderGameCharacters();
        }
      };
    }

    container.appendChild(card);
  });
}

function openEditCharacterDialog(char) {
  const oldNameInput = document.getElementById('game-character-edit-old-name');
  const nameInput = document.getElementById('game-character-edit-name');
  const descInput = document.getElementById('game-character-edit-short-desc');
  const promptInput = document.getElementById('game-character-edit-prompt');
  const title = document.getElementById('game-character-edit-title');

  if (title) title.textContent = 'Edit Character';
  if (oldNameInput) oldNameInput.value = char.name || '';
  if (nameInput) nameInput.value = char.name || '';
  if (descInput) descInput.value = char.short_description || '';
  if (promptInput) promptInput.value = char.system_prompt || '';

  uiManager.open('game-character-edit-modal');
}

function addManualCharacter() {
  const oldNameInput = document.getElementById('game-character-edit-old-name');
  const nameInput = document.getElementById('game-character-edit-name');
  const descInput = document.getElementById('game-character-edit-short-desc');
  const promptInput = document.getElementById('game-character-edit-prompt');
  const title = document.getElementById('game-character-edit-title');

  if (title) title.textContent = 'Add Character';
  if (oldNameInput) oldNameInput.value = '';
  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';
  if (promptInput) promptInput.value = '';

  uiManager.open('game-character-edit-modal');
}

function closeGameCharacterEditModal() {
  uiManager.close('game-character-edit-modal');
}

function saveGameCharacter() {
  const oldNameInput = document.getElementById('game-character-edit-old-name');
  const nameInput = document.getElementById('game-character-edit-name');
  const descInput = document.getElementById('game-character-edit-short-desc');
  const promptInput = document.getElementById('game-character-edit-prompt');

  const oldName = oldNameInput ? oldNameInput.value.trim() : '';
  const name = nameInput ? nameInput.value.trim() : '';
  const shortDesc = descInput ? descInput.value.trim() : '';
  const systemPrompt = promptInput ? promptInput.value.trim() : '';

  if (!name) {
    alert("Character name cannot be empty.");
    return;
  }

  // If we are editing and changed name, delete the old name first
  if (oldName && oldName !== name) {
    gameStore.removeCharacter(oldName);
  }

  // Get existing details if modifying, otherwise empty
  const existingChar = gameStore.getCharacter(name);
  const details = existingChar ? existingChar.details : '';

  gameStore.upsertCharacter({
    name,
    short_description: shortDesc,
    system_prompt: systemPrompt,
    details
  });

  renderGameCharacters();
  closeGameCharacterEditModal();
}

async function fetchCharacterDetails(name) {
  const game = gameStore.get();
  if (!game) return;

  const btn = document.querySelector(`.btn-char-details[data-name="${name}"]`);
  let originalHtml = '';
  if (btn) {
    originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-small" style="width: 10px; height: 10px; border: 1.5px solid rgba(255,255,255,0.1); border-top-color: #fff; border-radius: 50%; display: inline-block; animation: spin 1s linear infinite; margin-right: 4px;"></span> Thinking...`;
  }

  try {
    const history = game.history || [];
    const summarizedCount = game.summarized_count || 0;
    const remainingHistory = history.slice(summarizedCount);
    
    const fullHistoryToAnalyze = [...remainingHistory];
    if (game.currentScene) {
      fullHistoryToAnalyze.push(game.currentScene);
    }

    const details = await api.generateCharacterDetails(name, game.summary || '', fullHistoryToAnalyze);
    
    // Save to store
    gameStore.upsertCharacter({ name, details: details.trim() });
    renderGameCharacters();
  } catch (err) {
    console.error(err);
    alert('Failed to retrieve character details from the AI.');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

export async function initGameView() {
  await gameStore.load();
  
  // Bind tab click
  const tabGame = document.getElementById('tab-game');
  if (tabGame) {
    tabGame.addEventListener('click', async () => {
      // Deactivate other tabs
      const otherTabs = ['tab-characters', 'tab-books', 'tab-groups', 'tab-album'].map(id => document.getElementById(id));
      tabGame.classList.add('active');
      tabGame.style.background = 'var(--bg-tertiary)';
      tabGame.style.color = 'var(--text-primary)';
      tabGame.style.border = '1px solid var(--border-light)';
      
      otherTabs.forEach(btn => {
        if (!btn) return;
        btn.classList.remove('active');
        btn.style.background = 'transparent';
        btn.style.color = 'var(--text-secondary)';
        btn.style.border = '1px solid transparent';
      });

      // Hide other sidebars, but SHOW games-section
      const sections = ['characters-section', 'books-section', 'groups-section', 'album-section'].map(id => document.getElementById(id));
      sections.forEach(s => {
        if (s) {
          s.classList.add('hidden');
          s.style.display = 'none';
        }
      });
      const gamesSection = document.getElementById('games-section');
      if (gamesSection) {
        gamesSection.classList.remove('hidden');
        gamesSection.style.display = 'flex';
      }

      // Hide other views
      const views = ['chat-view-container', 'book-view-container', 'group-chat-view-container', 'album-view-container'].map(id => document.getElementById(id));
      views.forEach(v => {
        if (v) {
          v.classList.add('hidden');
          v.style.display = 'none';
        }
      });

      renderGamesList();
      resetHistoryUI();

      const state = gameStore.get();
      if (state) {
        // Show game view
        const gameView = document.getElementById('game-view-container');
        if (gameView) {
          gameView.classList.remove('hidden');
          gameView.style.display = 'block';
        }
        updateStatsUI();
        if (state.currentScene) {
          showSceneContent();
          renderScene(state.currentScene);
        } else {
          showStartScreen();
        }
      } else {
        // Hide game view if no active game
        const gameView = document.getElementById('game-view-container');
        if (gameView) {
          gameView.classList.add('hidden');
          gameView.style.display = 'none';
        }
      }
    });
  }

  // Bind New Game button
  const btnAddGame = document.getElementById('btn-add-game');
  if (btnAddGame) {
    btnAddGame.addEventListener('click', async () => {
      const title = await showPrompt('New Game', 'Enter a title for this game session:', 'My Epic Adventure');
      if (title) {
        gameStore.createGame(title);
        renderGamesList();
        resetHistoryUI();
        
        const gameView = document.getElementById('game-view-container');
        if (gameView) {
          gameView.classList.remove('hidden');
          gameView.style.display = 'block';
        }
        updateStatsUI();
        showStartScreen();
      }
    });
  }

  // Bind Start Game Scene Generator button (within the UI)
  const btnStartGame = document.getElementById('btn-start-game');
  if (btnStartGame) {
    btnStartGame.addEventListener('click', () => {
      const startPromptInput = document.getElementById('game-start-prompt');
      const userPrompt = startPromptInput ? startPromptInput.value.trim() : '';
      
      const languageSelect = document.getElementById('game-start-language');
      const selectedLanguage = languageSelect ? languageSelect.value : 'Russian';

      const storyPromptInput = document.getElementById('game-start-story-prompt');
      const storyPrompt = storyPromptInput ? storyPromptInput.value.trim() : '';

      const activeGame = gameStore.get();
      if (activeGame) {
        activeGame.language = selectedLanguage;
        activeGame.story_prompt = storyPrompt;
        gameStore.save();
      }

      const defaultStartPrompt = "The player wakes up in a strange forest at dusk, holding a rusty sword.";
      const promptToUse = userPrompt || defaultStartPrompt;
      generateNextScene(promptToUse, "Start Game");
    });
  }

  // Bind Toggle Game History button
  const btnToggleHistory = document.getElementById('btn-toggle-game-history');
  if (btnToggleHistory) {
    btnToggleHistory.addEventListener('click', toggleGameHistory);
  }

  // Bind Summarize History actions
  const btnSummarize = document.getElementById('btn-summarize-history');
  if (btnSummarize) {
    btnSummarize.addEventListener('click', openSummarizeHistoryModal);
  }

  const btnCloseModal = document.getElementById('btn-close-summary-modal');
  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', closeSummarizeHistoryModal);
  }

  const btnCloseAction = document.getElementById('btn-close-summary-action');
  if (btnCloseAction) {
    btnCloseAction.addEventListener('click', closeSummarizeHistoryModal);
  }

  const btnGenSummary = document.getElementById('btn-generate-ai-summary');
  if (btnGenSummary) {
    btnGenSummary.addEventListener('click', triggerAISummarization);
  }

  const btnSaveSummary = document.getElementById('btn-save-summary-action');
  if (btnSaveSummary) {
    btnSaveSummary.addEventListener('click', saveSummaryAndCompress);
  }

  // Bind Characters actions
  const btnGameCharacters = document.getElementById('btn-game-characters');
  if (btnGameCharacters) {
    btnGameCharacters.addEventListener('click', openGameCharactersModal);
  }

  const btnCloseCharsModal = document.getElementById('btn-close-game-characters-modal');
  if (btnCloseCharsModal) {
    btnCloseCharsModal.addEventListener('click', closeGameCharactersModal);
  }

  const btnAddGameChar = document.getElementById('btn-add-game-character');
  if (btnAddGameChar) {
    btnAddGameChar.addEventListener('click', addManualCharacter);
  }

  // Bind Game Character Edit Modal
  const btnCloseCharEdit = document.getElementById('btn-close-game-character-edit-modal');
  if (btnCloseCharEdit) {
    btnCloseCharEdit.addEventListener('click', closeGameCharacterEditModal);
  }
  const btnCancelCharEdit = document.getElementById('btn-cancel-game-character-edit');
  if (btnCancelCharEdit) {
    btnCancelCharEdit.addEventListener('click', closeGameCharacterEditModal);
  }
  const btnSaveCharEdit = document.getElementById('btn-save-game-character-edit');
  if (btnSaveCharEdit) {
    btnSaveCharEdit.addEventListener('click', saveGameCharacter);
  }

  // Bind Game Settings Modal
  const btnCloseGameSettings = document.getElementById('btn-close-game-settings-modal');
  if (btnCloseGameSettings) {
    btnCloseGameSettings.addEventListener('click', closeGameSettingsModal);
  }
  const btnCancelGameSettings = document.getElementById('btn-cancel-game-settings');
  if (btnCancelGameSettings) {
    btnCancelGameSettings.addEventListener('click', closeGameSettingsModal);
  }
  const btnSaveGameSettings = document.getElementById('btn-save-game-settings');
  if (btnSaveGameSettings) {
    btnSaveGameSettings.addEventListener('click', saveGameSettings);
  }

  // Bind Undo Last Move button
  const btnUndoMove = document.getElementById('btn-undo-move');
  if (btnUndoMove) {
    btnUndoMove.addEventListener('click', () => {
      if (isGenerating) {
        alert("Cannot undo while the next scene is generating!");
        return;
      }

      const activeGame = gameStore.get();
      if (!activeGame) return;

      if (!confirm("Are you sure you want to undo the last move?")) {
        return;
      }

      const success = gameStore.undoLastMove();
      if (success) {
        updateStatsUI();
        
        const updatedState = gameStore.get();
        if (updatedState && updatedState.currentScene) {
          showSceneContent();
          renderScene(updatedState.currentScene);
        } else {
          showStartScreen();
        }

        if (isHistoryExpanded) {
          renderGameHistory();
        } else {
          resetHistoryUI();
        }
      }
    });
  }

  // ─── GenAI Interactivity ───
  window.addEventListener('genai-create-game', (e) => {
    const { title } = e.detail;
    gameStore.createGame(title || 'GenAI Game');
    renderGamesList();
    resetHistoryUI();
    
    const gameView = document.getElementById('game-view-container');
    if (gameView) {
      gameView.classList.remove('hidden');
      gameView.style.display = 'block';
    }
    updateStatsUI();
    showStartScreen();
  });

  window.addEventListener('genai-switch-game', (e) => {
    const { game_id } = e.detail;
    gameStore.setActiveGame(game_id);
    renderGamesList();
    resetHistoryUI();
    
    const gameView = document.getElementById('game-view-container');
    if (gameView) {
      gameView.classList.remove('hidden');
      gameView.style.display = 'block';
    }
    
    const state = gameStore.get();
    if (state) {
      updateStatsUI();
      if (state.currentScene) {
        showSceneContent();
        renderScene(state.currentScene);
      } else {
        showStartScreen();
      }
    }
  });

  window.addEventListener('genai-send-game-action', (e) => {
    const { intent, actionText } = e.detail;
    generateNextScene(intent, actionText);
  });

  window.addEventListener('genai-rename-game', (e) => {
    const { game_id, new_title } = e.detail;
    gameStore.renameGame(game_id, new_title);
    renderGamesList();
  });
}

function renderGamesList() {
  const listContainer = document.getElementById('game-list');
  if (!listContainer) return;
  
  listContainer.innerHTML = '';
  const games = gameStore.getAllGames();
  const activeGame = gameStore.get();
  
  if (games.length === 0) {
    listContainer.innerHTML = '<div class="empty-state small"><p>No games yet</p></div>';
    return;
  }

  games.forEach(game => {
    const el = document.createElement('div');
    el.className = `character-item ${activeGame && activeGame.id === game.id ? 'active' : ''}`;
    el.innerHTML = `
      <div class="character-info" style="margin-left: 0; width: 100%;">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <div class="character-name">${game.title}</div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <button class="btn-icon small btn-rename-game" data-id="${game.id}" style="color: var(--text-secondary);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="btn-icon small btn-delete-game" data-id="${game.id}" style="color: var(--danger, #ef4444);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      </div>
    `;
    
    // Select game
    el.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-game') || e.target.closest('.btn-rename-game')) return;
      gameStore.setActiveGame(game.id);
      renderGamesList();
      resetHistoryUI();
      
      const gameView = document.getElementById('game-view-container');
      if (gameView) {
        gameView.classList.remove('hidden');
        gameView.style.display = 'block';
      }
      
      const state = gameStore.get();
      updateStatsUI();
      if (state.currentScene) {
        showSceneContent();
        renderScene(state.currentScene);
      } else {
        showStartScreen();
      }
    });

    // Rename game
    const renameBtn = el.querySelector('.btn-rename-game');
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openGameSettingsModal(game.id);
    });

    // Delete game
    const delBtn = el.querySelector('.btn-delete-game');
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = confirm('Delete this game?');
      if (confirmed) {
        gameStore.deleteGame(game.id);
        renderGamesList();
        
        const state = gameStore.get();
        const gameView = document.getElementById('game-view-container');
        if (!state) {
          if (gameView) {
            gameView.classList.add('hidden');
            gameView.style.display = 'none';
          }
        } else {
          updateStatsUI();
          if (state.currentScene) {
            showSceneContent();
            renderScene(state.currentScene);
          } else {
            showStartScreen();
          }
        }
      }
    });
    
    listContainer.appendChild(el);
  });
}

export function updateStatsUI() {
  const state = gameStore.get();
  if (!state) return;
  const { hp, stress, lust, money } = state.stats;
  
  const hpFill = document.getElementById('game-stat-hp');
  const hpText = document.getElementById('game-stat-hp-text');
  if (hpFill) hpFill.style.width = `${Math.min(100, Math.max(0, hp))}%`;
  if (hpText) hpText.textContent = `${hp}/100`;

  const stressFill = document.getElementById('game-stat-stress');
  const stressText = document.getElementById('game-stat-stress-text');
  if (stressFill) stressFill.style.width = `${Math.min(100, Math.max(0, stress))}%`;
  if (stressText) stressText.textContent = `${stress}/100`;

  const lustFill = document.getElementById('game-stat-lust');
  const lustText = document.getElementById('game-stat-lust-text');
  if (lustFill) lustFill.style.width = `${Math.min(100, Math.max(0, lust))}%`;
  if (lustText) lustText.textContent = `${lust}/100`;

  const moneyText = document.getElementById('game-stat-money');
  if (moneyText) moneyText.textContent = money;
}

function renderScene(sceneData, skipText = false) {
  const choicesContainer = document.getElementById('game-choices');
  const textStatesContainer = document.getElementById('game-text-states');
  const extraActionsContainer = document.getElementById('game-extra-actions');
  const noteInput = document.getElementById('game-gm-note');
  
  if (noteInput) noteInput.value = ''; // Clear GM note on new scene
  
  // Remove the persistent floating cursor at the end of stream
  removeGameCursor();

  if (!skipText) {
    resetStreamingRenderer();
    if (sceneData.scene_text) {
      updateStreamingText(sceneData.scene_text, true);
    }
  } else {
    // If skipping text rendering (because it streamed already), we still want to make sure
    // we render the clean final stable text properly formatted and parsed, hiding any JSON!
    if (sceneData.scene_text) {
      const textContainer = document.getElementById('game-scene-text');
      if (textContainer) {
        const cleanedText = stripJsonBlocks(sceneData.scene_text, false);
        let formattedText = cleanedText
          .replace(/\n/g, '<br>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>');
        formattedText = processCharacterMentions(formattedText);
        textContainer.innerHTML = formattedText;
      }
    }
  }

  // 1. Render Choices with sequential animations
  if (choicesContainer) {
    choicesContainer.innerHTML = '';
    const choices = (sceneData.choices && sceneData.choices.length > 0)
      ? sceneData.choices
      : [{ text: "Continue", prompt_intent: "The player continues..." }];

    choices.forEach((choice, idx) => {
      const btn = document.createElement('button');
      btn.className = 'btn-choice';
      btn.textContent = stripCharTagsForUI(choice.text);
      
      if (skipText) {
        btn.style.animation = 'none';
        btn.style.opacity = '1';
        btn.style.transform = 'none';
      } else {
        btn.style.animationDelay = `${idx * 0.1}s`;
      }
      
      btn.onclick = () => handleChoice(choice);
      choicesContainer.appendChild(btn);
    });
  }

  // 2. Render Text States
  if (textStatesContainer) {
    textStatesContainer.innerHTML = '';
    if (sceneData.text_states && sceneData.text_states.length > 0) {
      sceneData.text_states.forEach((state, idx) => {
        const el = document.createElement('span');
        const color = ['green', 'red', 'white'].includes(state.color) ? state.color : 'white';
        el.className = `game-text-state color-${color}`;
        el.textContent = stripCharTagsForUI(state.text);
        
        if (skipText) {
          el.style.animation = 'none';
          el.style.opacity = '1';
          el.style.transform = 'none';
        } else {
          el.style.animationDelay = `${idx * 0.15}s`;
        }
        
        textStatesContainer.appendChild(el);
      });
    } else {
      textStatesContainer.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-tertiary); font-style: italic;">Normal</div>';
    }
  }

  // 3. Render Extra Actions
  if (extraActionsContainer) {
    extraActionsContainer.innerHTML = '';
    if (sceneData.extra_actions && sceneData.extra_actions.length > 0) {
      sceneData.extra_actions.forEach((action, idx) => {
        const btn = document.createElement('button');
        btn.className = 'btn-extra-action';
        btn.textContent = stripCharTagsForUI(action);
        
        if (skipText) {
          btn.style.animation = 'none';
          btn.style.opacity = '1';
          btn.style.transform = 'none';
        } else {
          btn.style.animationDelay = `${idx * 0.08}s`;
        }
        
        btn.onclick = () => handleExtraAction(action);
        extraActionsContainer.appendChild(btn);
      });
    } else {
      extraActionsContainer.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-tertiary); font-style: italic;">None</div>';
    }
  }
}

async function handleChoice(choice) {
  if (isGenerating) return;
  
  // Read GM note
  const noteInput = document.getElementById('game-gm-note');
  const noteToGM = noteInput ? noteInput.value.trim() : '';
  
  generateNextScene(choice.prompt_intent, choice.text, noteToGM);
}

async function handleExtraAction(actionText) {
  if (isGenerating) return;
  
  // Read GM note
  const noteInput = document.getElementById('game-gm-note');
  const noteToGM = noteInput ? noteInput.value.trim() : '';
  
  const promptIntent = `The player decides to perform the physical action: "${actionText}".`;
  generateNextScene(promptIntent, actionText, noteToGM);
}

async function generateNextScene(promptIntent, actionText, noteToGM = '') {
  isGenerating = true;
  setLoaderVisible(true);
  
  const state = gameStore.get();
  if (!state) return;
  
  const previousText = state.currentScene ? state.currentScene.scene_text : "";
  
  // Clear previous scene containers before starting stream
  showSceneContent();
  resetStreamingRenderer();
  
  const choicesContainer = document.getElementById('game-choices');
  if (choicesContainer) choicesContainer.innerHTML = '';
  const extraActionsContainer = document.getElementById('game-extra-actions');
  if (extraActionsContainer) extraActionsContainer.innerHTML = '';
  const textStatesContainer = document.getElementById('game-text-states');
  if (textStatesContainer) textStatesContainer.innerHTML = '';
  
  const gameSummary = state.summary || "";
  const summarizedCount = state.summarized_count || 0;
  const remainingHistory = state.history ? state.history.slice(summarizedCount) : [];
  const storyPrompt = state.story_prompt || '';
  const existingCharacters = state.characters || [];
  let genError = null;

  try {
    const language = state.language || 'Russian';
    const newScene = await api.generateGameScene(
      state.stats,
      previousText,
      actionText,
      promptIntent,
      noteToGM,
      gameSummary,
      remainingHistory,
      (partialJson) => {
        // Parse and render partial scene_text stream
        const partialText = parsePartialSceneText(partialJson);
        if (partialText) {
          updateStreamingText(partialText, false);
        }
        
        const partialTextStates = parsePartialTextStates(partialJson);
        if (partialTextStates && partialTextStates.length > 0) {
          renderStreamingTextStates(partialTextStates);
        }

        const partialExtraActions = parsePartialExtraActions(partialJson);
        if (partialExtraActions && partialExtraActions.length > 0) {
          renderStreamingExtraActions(partialExtraActions);
        }

        const partialChoices = parsePartialChoices(partialJson);
        if (partialChoices && partialChoices.length > 0) {
          renderStreamingChoices(partialChoices);
        }
      },
      language,
      storyPrompt,
      existingCharacters
    );
    
    // Apply stats
    if (newScene.stats_changes) {
      gameStore.applyStatChanges(newScene.stats_changes);
      updateStatsUI();
    }
    
    // Save new scene
    const currentGame = gameStore.get();
    if (currentGame && currentGame.currentScene) {
      currentGame.currentScene.player_action = actionText;
      currentGame.currentScene.player_note = noteToGM;
    }

    gameStore.setCurrentScene(newScene);
    
    // Render final scene with choices, status states and extra action buttons, but skip text re-rendering!
    showSceneContent();
    renderScene(newScene, true);

    // If history is currently expanded, re-render it to include the latest additions!
    if (isHistoryExpanded) {
      renderGameHistory();
    }

    // ─── Separate API call: update game characters from the new scene ───
    if (newScene.scene_text) {
      try {
        const updatedChars = await api.updateGameCharacters(
          newScene.scene_text,
          gameStore.get().characters || [],
          gameSummary,
          state.language || 'Russian'
        );
        if (updatedChars && updatedChars.length > 0) {
          updatedChars.forEach(charData => {
            gameStore.upsertCharacter(charData);
          });
        }
      } catch (charErr) {
        console.warn('Character update failed (non-critical):', charErr);
      }
    }
    
  } catch (error) {
    console.error("Game Generation Error:", error);
    alert("Failed to generate next scene. Check console for details.");
    genError = error.message;
  } finally {
    isGenerating = false;
    setLoaderVisible(false);
    window.dispatchEvent(new CustomEvent('genai-game-response-finished', { detail: { error: genError } }));
  }
}

function setLoaderVisible(visible) {
  const loader = document.getElementById('game-loader');
  const choices = document.querySelectorAll('.btn-choice');
  const extraActions = document.querySelectorAll('.btn-extra-action');
  const noteInput = document.getElementById('game-gm-note');
  
  if (loader) {
    if (visible) loader.classList.add('visible');
    else loader.classList.remove('visible');
  }
  
  choices.forEach(btn => btn.disabled = visible);
  extraActions.forEach(btn => btn.disabled = visible);
  if (noteInput) noteInput.disabled = visible;
}

// ─── Character Mentions ───
function processCharacterMentions(text) {
  if (!text) return '';
  return text.replace(/\{\{char:([^|}]+)(?:\|([^}]+))?\}\}/g, (match, name, alias) => {
    const displayName = alias ? alias.trim() : name.trim();
    return `<span class="char-mention" data-char-name="${name.trim()}">${displayName}</span>`;
  });
}

// Global click delegation for character mentions
document.addEventListener('click', (e) => {
  const mention = e.target.closest('.char-mention');
  if (mention) {
    const charName = mention.getAttribute('data-char-name');
    const cleanedName = cleanCharacterName(charName);
    
    // 1. Look up in active game characters
    const game = gameStore.get();
    if (game && game.characters) {
      const char = game.characters.find(c => cleanCharacterName(c.name).toLowerCase() === cleanedName.toLowerCase());
      if (char) {
        showCharacterTooltip(mention, char);
        return;
      }
    }
    
    // 2. Fallback to global chatbot directory
    const globalChars = characterStore.getAll();
    const globalChar = globalChars.find(c => cleanCharacterName(c.name).toLowerCase() === cleanedName.toLowerCase());
    if (globalChar) {
      showCharacterTooltip(mention, globalChar);
    }
  }
});

function showCharacterTooltip(element, char) {
  // Remove existing tooltips
  document.querySelectorAll('.char-tooltip').forEach(t => t.remove());

  const tooltip = document.createElement('div');
  tooltip.className = 'char-tooltip';
  tooltip.style.position = 'absolute';
  tooltip.style.background = 'rgba(15, 15, 20, 0.95)';
  tooltip.style.backdropFilter = 'blur(10px)';
  tooltip.style.border = '1px solid var(--border-subtle)';
  tooltip.style.borderRadius = 'var(--radius-md)';
  tooltip.style.padding = '12px 16px';
  tooltip.style.zIndex = '9999';
  tooltip.style.maxWidth = '250px';
  tooltip.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
  tooltip.style.color = 'var(--text-primary)';
  tooltip.style.animation = 'fadeIn 0.2s ease';
  
  const shortDesc = char.short_description || 'No description available.';
  tooltip.innerHTML = `
    <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 4px; color: var(--text-accent);">${char.name}</div>
    <div style="font-size: 0.85rem; line-height: 1.4; color: var(--text-secondary);">${shortDesc}</div>
  `;

  document.body.appendChild(tooltip);

  const rect = element.getBoundingClientRect();
  tooltip.style.top = `${rect.bottom + window.scrollY + 8}px`;
  
  // Center relative to element, but keep inside window bounds
  let left = rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2);
  if (left < 10) left = 10;
  if (left + tooltip.offsetWidth > window.innerWidth - 10) {
    left = window.innerWidth - tooltip.offsetWidth - 10;
  }
  tooltip.style.left = `${left}px`;

  // Close when clicking outside
  const closeHandler = (e) => {
    if (!tooltip.contains(e.target) && e.target !== element) {
      tooltip.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  
  // Use timeout to avoid immediately closing from the current click event
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
  }, 10);
}

// ─── Game Settings Modal ───
function openGameSettingsModal(gameId) {
  const game = gameStore.getAllGames().find(g => g.id === gameId);
  if (!game) return;

  const modal = document.getElementById('game-settings-modal');
  const titleInput = document.getElementById('game-settings-title');
  const promptInput = document.getElementById('game-settings-story-prompt');
  const effortSelect = document.getElementById('game-settings-reasoning-effort');
  
  if (titleInput) titleInput.value = game.title || '';
  if (promptInput) promptInput.value = game.story_prompt || '';
  if (effortSelect) effortSelect.value = game.reasoning_effort || 'none';
  
  modal.setAttribute('data-game-id', gameId);
  uiManager.open('game-settings-modal');
}

function closeGameSettingsModal() {
  uiManager.close('game-settings-modal');
}

function saveGameSettings() {
  const modal = document.getElementById('game-settings-modal');
  const gameId = modal.getAttribute('data-game-id');
  if (!gameId) return;

  const titleInput = document.getElementById('game-settings-title');
  const promptInput = document.getElementById('game-settings-story-prompt');
  const effortSelect = document.getElementById('game-settings-reasoning-effort');
  
  const title = titleInput ? titleInput.value.trim() : '';
  const storyPrompt = promptInput ? promptInput.value.trim() : '';
  const reasoningEffort = effortSelect ? effortSelect.value : 'none';
  
  if (!title) {
    alert("Game title cannot be empty.");
    return;
  }
  
  gameStore.updateGameSettings(gameId, { title, story_prompt: storyPrompt, reasoning_effort: reasoningEffort });
  
  // Re-render games list and potentially update start screen if it's the active game
  renderGamesList();
  
  const activeGame = gameStore.get();
  if (activeGame && activeGame.id === gameId) {
    const startPromptInput = document.getElementById('game-start-story-prompt');
    if (startPromptInput) {
      startPromptInput.value = storyPrompt;
    }
  }

  closeGameSettingsModal();
}
