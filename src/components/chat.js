/* ════════════════════════════════════════════════════════════════════
   Chat Component — Main chat interface
   ════════════════════════════════════════════════════════════════════ */

import { showToast, checkConnection, showConfirm, showPrompt, openWindow, closeWindow } from '../main.js';
import { appState } from '../state.js';
import { chatStore } from '../services/chat-store.js';
import { characterStore } from '../services/character-store.js';
import { gameStore } from '../services/game-store.js';
import { api } from '../services/api.js';
import { settingsStore } from '../services/settings-store.js';
import { lorebookStore, idbGet, idbSet } from '../services/lorebook-store.js';
import { memoryService } from '../services/memory-service.js';
import {
  renderMarkdown,
  parseThinking,
  parseStreamThinking,
  parseGLMThinking,
  createThinkingBlockHTML,
  autoResizeTextarea,
  formatTime,
  escapeHtml,
  wrapWordsInSpans,
} from '../utils/helpers.js';
import morphdom from '../vendor/morphdom.js';
import { perf } from '../utils/perf.js';
import { groupChatStore } from '../services/group-chat-store.js';
import { buildGroupApiMessages } from './group-chat-view.js';
import { generateImageComfyUI } from '../services/comfyui-service.js';
import { initLorebookButtons, renderLorebookEditorList } from './lorebook-ui.js';
import { parseMessageExamples } from '../utils/message-examples-parser.js';
// Lazy notify GenAI panel when a response arrives (avoids circular import)
function notifyGenAI(response, characterName) {
  import('../components/genai-panel.js').then(m => m.notifyGenAIResponse(response, characterName)).catch(() => { });
}

const ANIMA_BETTER_PROMPT_TEXT = `[IMAGE GENERATION RULES & GUIDELINES]
Prompting
The model is trained on Danbooru-style tags, natural language captions, and combinations of tags and captions.

Use lowercase for tags, and spaces instead of underscores. Score tags are the only tags that use underscores.
Recommended positive prefix: "masterpiece, best quality, score_7, [safety tag], "
Recommended negative: "worst quality, low quality, score_1, score_2, score_3, artist name"
When using a tag that is different between Danbooru and Gelbooru, prefer the Gelbooru version.
Prompt weighting works, but needs a weight higher than typically used for SDXL. Example: "(chibi:2)"
Tag order
[quality/meta/year/safety tags] [1girl/1boy/1other etc] [character] [series] [artist] [general tags]

Within each tag section, the tags can be in arbitrary order.

Quality tags
Human score based: masterpiece, best quality, good quality, normal quality, low quality, worst quality

PonyV7 aesthetic model based: score_9, score_8, ..., score_1

You can use either the human score quality tags, the aesthetic model tags, both together, or neither. All combinations work.

Time period tags
Specific year: year 2025, year 2024, ...

Period: newest, recent, mid, early, old

Meta tags
highres, absurdres, anime screenshot, jpeg artifacts, official art, etc

Safety tags
safe, sensitive, nsfw, explicit

MANDATORY RULE FOR SAFETY TAGS:
- You MUST select EXACTLY ONE safety tag based on the user's request.
- Use "safe" only for clean/SFW content.
- Use "nsfw" or "explicit" for adult, 18+, nudity, or NSFW requests.
- Replace the "[safety tag]" placeholder in the recommended positive prefix with your chosen tag (e.g., "masterpiece, best quality, score_7, nsfw, " for adult requests).
- NEVER use the "safe" tag if the user requests NSFW/explicit content, and never use "nsfw"/"explicit" if the user requests clean content.

Artist tags
Prefix artist with @. E.g. "@big chungus". You must put @ in front of the artist. The effect will be very weak if you don't.

Full tag example
year 2025, newest, normal quality, score_5, highres, safe, 1girl, oomuro sakurako, yuru yuri, @nnn yryr, smile, brown hair, hat, solo, fur-trimmed gloves, open mouth, long hair, gift box, fang, skirt, red gloves, blunt bangs, gloves, one eye closed, shirt, brown eyes, santa costume, red hat, skin fang, twitter username, white background, holding bag, fur trim, simple background, brown skirt, bag, gift bag, looking at viewer, santa hat, ;d, red shirt, box, gift, fur-trimmed headwear, holding, red capelet, holding box, capelet

Tag dropout
The model was trained with random tag dropout. You don't need to include every single relevant tag for the image.

Dataset tags
To improve style and content diversity, the model was additionally trained on two non-anime datasets: LAION-POP (specifically the ye-pop version) and DeviantArt. Both were filtered to exclude photos. Because these datasets are qualitatively different from anime datasets, captions from them have been labeled with a "dataset tag". This occurs at the very beginning of a prompt followed by a newline. Optionally, the second line can contain either the image alt-text (ye-pop) or the title of the work (DeviantArt). Examples:

ye-pop
For Sale: Others by Arun Prem
Abstract, oil painting of three faceless, blue-skinned figures. Left: white, draped figure; center: yellow-shirted, dark-haired figure; right: red-veiled, dark-haired figure carrying another. Bold, textured colors, minimalist style.

deviantart
Flame
Digital painting of a fiery dragon with glowing yellow eyes, black horns, and a long, sinuous tail, perched on a glowing, molten rock formation. The background is a gradient of dark purple to orange.

Natural language prompting tips
Follow standard English capitalization rules for character and series names.
If using pure natural langauge, more descriptive is better. Aim for at least 2 sentences. Extremely short prompts can give unexpected results.
You can mix tags and natural language in arbitrary order.
You can put quality / artist tags at the beginning of a natural language prompt.
"masterpiece, best quality, @big chungus. An anime girl with medium-length blonde hair is..."
Name a character, then describe their basic appearance.
"Digital artwork of Fern from Sousou no Frieren, with long purple hair and purple eyes, wearing a black coat over a white dress with puffy sleeves..."
This is extra important when prompting for multiple characters. If you just list off character names with no description of appearance, the model can get confused.`;

// ─── DOM Elements ───────────────────────────────────────────────────

let messagesContainer;
let messageInput;
let btnSend;
let btnStop;
let emptyState;
let headerCharName;
let headerCharStatus;
let headerAvatar;
let btnInputSettings;
let inputSettingsPopover;


// ─── Context Indicator & Breakdown Modal DOM Elements ───────────────
let contextIndicator;
let donutSegment;
let contextDetailsModal;
let contextModalBackdrop;
let btnCloseContextDetails;
let btnCloseContextModalFooter;
let contextTotalInfo;
let contextFreeInfo;
let barCharCard;
let barSystemPrompt;
let barMemoryContext;
let barChatHistory;
let legendCharCard;
let legendSystemPrompt;
let legendMemoryContext;
let legendAutoSummary;
let legendChatHistory;
let badgeDetailsChar;
let badgeDetailsSystem;
let badgeDetailsMemory;
let badgeDetailsSummary;
let badgeDetailsHistory;
let contentDetailsChar;
let contentDetailsSystem;
let contentDetailsMemory;
let contentDetailsSummary;
let contentDetailsHistory;
let barAutoSummary;
let btnSummarySettings;
let summarySettingsDropdown;
let chkSummaryThinking;
let selectSummaryLength;
let selectSummaryMode;
let btnAutoSummarizeAll;
let btnAddSummaryChunk;
let btnRevertAutoSummary;
let summaryChunksList;
let autoSummaryRecommendation;
let btnRecHide;
let btnRecEnable;

// In-memory caches for context calculation
const sessionBaseTokensCache = new Map();      // session.id -> { baseTokens, maxContext }
const sessionHistoryTokensCache = new Map();   // session.id::signature -> totalHistoryTokens
const sessionHistoryItemsCache = new Map();    // session.id::signature -> historyItemsArray
let currentIndicatorCalcId = 0; // Tracks active token calculation sequence ID to prevent overlapping API calls

function getHistorySignature(session) {
  if (!session || !session.messages) return '';

  // History starts after the last summary chunk (or from msg index 3 if no chunks)
  const KEEP_FIRST = 3;
  const chunks = session.summaryChunks;
  let messagesToCount = session.messages;
  if (chunks && chunks.length > 0) {
    const lastChunk = chunks[chunks.length - 1];
    const idx = session.messages.findIndex(m => m.id === lastChunk.endMsgId);
    if (idx !== -1) {
      messagesToCount = session.messages.slice(idx + 1);
    }
  } else {
    messagesToCount = session.messages.slice(KEEP_FIRST);
  }

  return messagesToCount
    .filter(m => m.role !== 'system' && (m.role !== 'assistant' || m.content))
    .map(m => `${m.id}:${(m.role === 'user' ? (m.translated_content || m.content) : (m.original_text || m.content))?.length || 0}`)
    .join('|');
}

const tokenCountCache = new Map();
let contextDebounceTimer = null;
let activeContextCalculationController = null;

// ─── Suggestions Explorer State ──────────────────────────────────────
let moreSuggestionsAbortController = null;
let moreSuggestionsContext = { character: null, session: null, msgElement: null };
let generatedSuggestionsHistory = [];

// ─── Floating Streaming Cursor ───────────────────────────────────────
// A single absolutely-positioned cursor element that glides smoothly
// to the end of the last rendered word using CSS transition.

let _chatCursor = null;
let _chatCursorRafId = null;

function getOrCreateChatCursor() {
  if (!_chatCursor || !_chatCursor.isConnected) {
    _chatCursor = document.createElement('span');
    _chatCursor.className = 'streaming-cursor streaming-cursor--float';
    document.body.appendChild(_chatCursor);
  }
  return _chatCursor;
}

function repositionChatCursor(contentEl) {
  if (_chatCursorRafId) cancelAnimationFrame(_chatCursorRafId);
  _chatCursorRafId = requestAnimationFrame(() => {
    const cursor = _chatCursor;
    if (!cursor || !cursor.isConnected) return;

    // Walk the contentEl to find the last visible text node
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    });
    let lastTextNode = null;
    while (walker.nextNode()) lastTextNode = walker.currentNode;

    if (lastTextNode) {
      const range = document.createRange();
      range.setStart(lastTextNode, lastTextNode.length);
      range.setEnd(lastTextNode, lastTextNode.length);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return; // not in viewport yet
      const cursorH = cursor.offsetHeight || 16;
      // position:fixed uses viewport coordinates — no scroll offset needed
      cursor.style.transform = `translate(${rect.right}px, ${rect.top + (rect.height - cursorH) / 2}px)`;
    }
  });
}

function removeChatCursor() {
  if (_chatCursorRafId) { cancelAnimationFrame(_chatCursorRafId); _chatCursorRafId = null; }
  if (_chatCursor && _chatCursor.isConnected) _chatCursor.remove();
  _chatCursor = null;
}

// ─── Init ───────────────────────────────────────────────────────────

export function initChat() {
  messagesContainer = document.getElementById('chat-messages');

  window.addEventListener('local-sync-applied', async () => {
    chatStore.clearCache();
    memoryService.clearCache();
    if (appState.currentCharacter) {
      await chatStore.loadForCharacter(appState.currentCharacter.id);
      try {
        await memoryService.loadForCharacter(appState.currentCharacter.id);
      } catch (err) {
        console.warn('Failed to reload character memories:', err);
      }
      updateChatHistory();
      if (appState.currentChat) {
        const updatedSession = chatStore.getSessions(appState.currentCharacter.id)
          .find(s => s.id === appState.currentChat.id);
        if (updatedSession) {
          chatStore.setCurrentSession(updatedSession);
          loadChat(updatedSession);
        }
      }
    }
  });
  messageInput = document.getElementById('message-input');
  btnSend = document.getElementById('btn-send');
  btnStop = document.getElementById('btn-stop');
  emptyState = document.getElementById('empty-state');
  headerCharName = document.getElementById('header-char-name');
  headerCharStatus = document.getElementById('header-char-status');
  headerAvatar = document.getElementById('header-avatar');
  btnInputSettings = document.getElementById('btn-input-settings');
  inputSettingsPopover = document.getElementById('input-settings-popover');


  // Bind Context Indicator and Breakdown Modal Elements
  contextIndicator = document.getElementById('context-indicator');
  donutSegment = document.getElementById('donut-segment');
  contextDetailsModal = document.getElementById('context-details-modal');
  contextModalBackdrop = document.getElementById('context-modal-backdrop');
  btnCloseContextDetails = document.getElementById('btn-close-context-details');
  btnCloseContextModalFooter = document.getElementById('btn-close-context-modal-footer');
  contextTotalInfo = document.getElementById('context-total-info');
  contextFreeInfo = document.getElementById('context-free-info');
  barCharCard = document.getElementById('bar-char-card');
  barSystemPrompt = document.getElementById('bar-system-prompt');
  barMemoryContext = document.getElementById('bar-memory-context');
  barAutoSummary = document.getElementById('bar-auto-summary');
  barChatHistory = document.getElementById('bar-chat-history');
  legendCharCard = document.getElementById('legend-char-card');
  legendSystemPrompt = document.getElementById('legend-system-prompt');
  legendMemoryContext = document.getElementById('legend-memory-context');
  legendAutoSummary = document.getElementById('legend-auto-summary');
  legendChatHistory = document.getElementById('legend-chat-history');
  badgeDetailsChar = document.getElementById('badge-details-char');
  badgeDetailsSystem = document.getElementById('badge-details-system');
  badgeDetailsMemory = document.getElementById('badge-details-memory');
  badgeDetailsSummary = document.getElementById('badge-details-summary');
  badgeDetailsHistory = document.getElementById('badge-details-history');
  contentDetailsChar = document.getElementById('content-details-char');
  contentDetailsSystem = document.getElementById('content-details-system');
  contentDetailsMemory = document.getElementById('content-details-memory');
  contentDetailsSummary = document.getElementById('content-details-summary');
  contentDetailsHistory = document.getElementById('content-details-history');

  btnSummarySettings = document.getElementById('btn-summary-settings');
  summarySettingsDropdown = document.getElementById('summary-settings-dropdown');
  chkSummaryThinking = document.getElementById('chk-summary-thinking');
  selectSummaryLength = document.getElementById('select-summary-length');
  selectSummaryMode = document.getElementById('select-summary-mode');
  btnAutoSummarizeAll = document.getElementById('btn-auto-summarize-all');
  btnAddSummaryChunk = document.getElementById('btn-add-summary-chunk');
  btnRevertAutoSummary = document.getElementById('btn-revert-auto-summary');
  summaryChunksList = document.getElementById('summary-chunks-list');
  autoSummaryRecommendation = document.getElementById('auto-summary-recommendation');
  btnRecHide = document.getElementById('btn-rec-hide');
  btnRecEnable = document.getElementById('btn-rec-enable');

  // Context indicator click -> open modal
  if (contextIndicator) {
    contextIndicator.addEventListener('click', () => {
      const session = appState.currentChat;
      if (!session) return;
      populateContextDetailsModal(session);
      openWindow(contextDetailsModal);
    });
  }

  // Refresh context breakdown click -> force recalculate via API
  const btnRefreshContext = document.getElementById('btn-refresh-context');
  if (btnRefreshContext) {
    btnRefreshContext.addEventListener('click', async () => {
      const session = appState.currentChat;
      if (!session) return;

      const refreshIcon = btnRefreshContext.querySelector('svg');
      if (refreshIcon) refreshIcon.classList.add('spin-animation');
      btnRefreshContext.setAttribute('disabled', 'true');

      try {
        // Clear caches for this session
        sessionBaseTokensCache.delete(session.id);
        for (const key of sessionHistoryTokensCache.keys()) {
          if (key.startsWith(session.id + '::')) {
            sessionHistoryTokensCache.delete(key);
            sessionHistoryItemsCache.delete(key);
          }
        }

        // Force full recalculation
        await updateContextIndicator(false, true);

        // Re-populate modal contents
        populateContextDetailsModal(session);
      } catch (err) {
        console.error('Failed to refresh context breakdown:', err);
      } finally {
        if (refreshIcon) refreshIcon.classList.remove('spin-animation');
        btnRefreshContext.removeAttribute('disabled');
      }
    });
  }

  // Modal close handlers
  const closeContextModal = () => closeWindow(contextDetailsModal);
  if (btnCloseContextDetails) btnCloseContextDetails.addEventListener('click', closeContextModal);
  if (btnCloseContextModalFooter) btnCloseContextModalFooter.addEventListener('click', closeContextModal);
  if (contextModalBackdrop) contextModalBackdrop.addEventListener('click', closeContextModal);

  // Accordion Expand/Collapse logic
  const setupAccordion = (headerId, contentId) => {
    const header = document.getElementById(headerId);
    const content = document.getElementById(contentId);
    if (header && content) {
      header.addEventListener('click', () => {
        content.classList.toggle('hidden');
      });
    }
  };
  setupAccordion('header-details-char', 'content-details-char');
  setupAccordion('header-details-system', 'content-details-system');
  setupAccordion('header-details-memory', 'content-details-memory');
  setupAccordion('header-details-summary', 'content-details-summary');
  setupAccordion('header-details-history', 'content-details-history');
  setupAccordion('header-details-lorebooks', 'content-details-lorebooks');

  // ─── Auto Summary: Settings & Add Chunks ──────────────────────────────
  if (btnSummarySettings && summarySettingsDropdown) {
    btnSummarySettings.addEventListener('click', (e) => {
      e.stopPropagation();
      summarySettingsDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (summarySettingsDropdown && !summarySettingsDropdown.classList.contains('hidden')) {
        if (!summarySettingsDropdown.contains(e.target) && e.target !== btnSummarySettings) {
          summarySettingsDropdown.classList.add('hidden');
        }
      }
    });
  }

  if (chkSummaryThinking) {
    chkSummaryThinking.addEventListener('change', (e) => {
      settingsStore.set({ summary_thinking_enabled: e.target.checked });
    });
  }

  if (selectSummaryLength) {
    selectSummaryLength.addEventListener('change', (e) => {
      settingsStore.set({ summary_length: e.target.value });
    });
  }

  if (selectSummaryMode) {
    selectSummaryMode.addEventListener('change', (e) => {
      settingsStore.set({ summary_injection_mode: e.target.value });
    });
  }

  // Helper: compute the next chunk window and generate a summary chunk
  async function addSummaryChunk(session, character, silent = false) {
    const settings = settingsStore.get();
    const userName = session.user_name || settings.user_name || 'User';
    const characterName = character.name;
    const chunkSize = settings.summary_chunk_size || 10;
    const summaryLength = settings.summary_length || 'default';
    const enableThinking = settings.summary_thinking_enabled ?? false;

    // First 3 messages are always kept verbatim — never summarized
    const KEEP_FIRST = 3;
    // Last 6 messages are always kept verbatim — never summarized
    const KEEP_LAST = 6;

    const chunks = session.summaryChunks || [];
    const lastChunk = chunks[chunks.length - 1];

    // Start of next chunk: right after the last summarized message, or from msg index 3
    let startIndex;
    if (lastChunk) {
      const idx = session.messages.findIndex(m => m.id === lastChunk.endMsgId);
      startIndex = idx !== -1 ? idx + 1 : KEEP_FIRST;
    } else {
      startIndex = KEEP_FIRST;
    }

    // End of available window: exclude last 6 messages
    const maxEnd = session.messages.length - KEEP_LAST;

    if (startIndex >= maxEnd) {
      if (!silent) showToast('Not enough new messages to summarize (last 6 are always kept).', 'info');
      return false;
    }

    // Take up to chunkSize messages
    const endIndex = Math.min(startIndex + chunkSize, maxEnd);
    const newMessages = session.messages.slice(startIndex, endIndex);

    if (newMessages.length === 0) {
      if (!silent) showToast('No messages available for a new summary chunk.', 'info');
      return false;
    }

    const summaryText = await api.generateChatSummary('', newMessages, userName, characterName, {
      summaryLength,
      enableThinking
    });

    const newChunk = {
      id: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 6),
      text: summaryText.trim(),
      startMsgId: session.messages[startIndex].id,
      endMsgId: session.messages[endIndex - 1].id
    };

    if (!session.summaryChunks) session.summaryChunks = [];
    session.summaryChunks.push(newChunk);

    await chatStore.saveSession(session);
    return true;
  }

  if (btnAutoSummarizeAll) {
    btnAutoSummarizeAll.addEventListener('click', async (e) => {
      e.stopPropagation();
      const session = appState.currentChat;
      const character = appState.currentCharacter;
      if (!session || !character) return;

      if (!session.messages || session.messages.length === 0) {
        showToast('No messages to summarize.', 'info');
        return;
      }

      // Calculate context breakdown and summary needs based on 70% threshold
      const breakdown = await computeContextAndTrimHistory(character, session);
      let needs = calculateSummaryNeeds(session, breakdown.maxContext, breakdown.baseTokens);

      if (!needs.needsMore) {
        const usedPct = Math.round((breakdown.baseTokens / breakdown.maxContext) * 100);
        showToast(`Context usage is ${usedPct}% (below 70% threshold). No summary needed!`, 'info');
        return;
      }

      btnAutoSummarizeAll.disabled = true;
      if (btnAddSummaryChunk) btnAddSummaryChunk.disabled = true;
      if (btnRevertAutoSummary) btnRevertAutoSummary.disabled = true;

      let createdCount = 0;
      try {
        while (needs.needsMore) {
          btnAutoSummarizeAll.textContent = `… ${needs.doneCount}/${needs.totalNeeded}`;
          const ok = await addSummaryChunk(session, character, true);
          if (!ok) break;
          createdCount++;

          const freshBreakdown = await computeContextAndTrimHistory(character, session);
          needs = calculateSummaryNeeds(session, freshBreakdown.maxContext, freshBreakdown.baseTokens);
          await updateContextIndicator(false, true);
          populateContextDetailsModal(session, freshBreakdown);
        }
        if (createdCount > 0) {
          showToast(`Generated ${createdCount} summary chunk(s)! Context usage reduced below 70%.`, 'success');
        }
      } catch (err) {
        console.error('Failed auto summarization loop:', err);
        showToast('Auto summarization failed: ' + err.message, 'error');
      } finally {
        btnAutoSummarizeAll.disabled = false;
        if (btnAddSummaryChunk) btnAddSummaryChunk.disabled = false;
        if (btnRevertAutoSummary) btnRevertAutoSummary.disabled = false;
        populateContextDetailsModal(session);
      }
    });
  }

  if (btnAddSummaryChunk) {
    btnAddSummaryChunk.addEventListener('click', async (e) => {
      e.stopPropagation();
      const session = appState.currentChat;
      const character = appState.currentCharacter;
      if (!session || !character) return;

      if (session.messages.length === 0) {
        showToast('No messages to summarize.', 'info');
        return;
      }

      const originalText = btnAddSummaryChunk.textContent;
      btnAddSummaryChunk.disabled = true;
      btnAddSummaryChunk.textContent = '…';

      try {
        const ok = await addSummaryChunk(session, character, false);
        if (ok) {
          showToast('Summary chunk added!', 'success');
          await updateContextIndicator(false, true);
          populateContextDetailsModal(session);
        }
      } catch (err) {
        console.error('Failed to add summary chunk:', err);
        showToast('Summarization failed: ' + err.message, 'error');
      } finally {
        btnAddSummaryChunk.disabled = false;
        btnAddSummaryChunk.textContent = originalText;
      }
    });
  }

  if (btnRevertAutoSummary) {
    btnRevertAutoSummary.addEventListener('click', async (e) => {
      e.stopPropagation();
      const session = appState.currentChat;
      if (!session) return;

      const confirmed = await showConfirm('Revert Auto Summary', 'Are you sure you want to delete all summary chunks and restore the full message history in context?');
      if (!confirmed) return;

      session.summaryChunks = [];
      await chatStore.saveSession(session);
      showToast('All summary chunks removed.', 'info');

      await updateContextIndicator(false, true);
      populateContextDetailsModal(session);
    });
  }

  // Recommendation Popover Actions
  if (btnRecHide) {
    btnRecHide.addEventListener('click', () => {
      const session = appState.currentChat;
      if (session) {
        session._autoSummaryDismissed = true;
      }
      if (autoSummaryRecommendation) {
        autoSummaryRecommendation.classList.add('hidden');
      }
    });
  }

  if (btnRecEnable) {
    btnRecEnable.addEventListener('click', async () => {
      const session = appState.currentChat;
      const character = appState.currentCharacter;
      if (!session || !character) return;

      if (session.messages.length === 0) {
        showToast('No messages to summarize.', 'info');
        return;
      }

      if (autoSummaryRecommendation) {
        autoSummaryRecommendation.classList.add('hidden');
      }

      showToast('Summarizing chat history...', 'info');

      try {
        const ok = await addSummaryChunk(session, character);
        if (ok) {
          showToast('Auto Summary enabled!', 'success');
          await updateContextIndicator(false, true);
        }
      } catch (err) {
        console.error('Failed to enable auto summary:', err);
        showToast('Failed to generate summary: ' + err.message, 'error');
      }
    });
  }

  // Send message
  btnSend.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize input
  messageInput.addEventListener('input', () => {
    autoResizeTextarea(messageInput);
    
    // Recount context tokens debounced on typing
    updateContextIndicator(true);

    // Abort pending suggestions generation if any
    if (appState.suggestionsAbortController) {
      appState.suggestionsAbortController.abort();
      appState.suggestionsAbortController = null;
    }

    // Fade out continuation options when typing
    if (messageInput.value.trim().length > 0) {
      const options = messagesContainer.querySelectorAll('.continuation-options:not(.fade-out)');
      options.forEach(opt => {
        opt.classList.add('fade-out');
        setTimeout(() => opt.remove(), 400); // match animation duration

        // Also clear options from the store for the corresponding message
        const msgEl = opt.closest('.message');
        if (msgEl) {
          const msgId = msgEl.dataset.messageId;
          const session = chatStore.getCurrentSession();
          if (session) {
            const msg = session.messages.find(m => m.id === msgId);
            if (msg) {
              delete msg.options;
              chatStore.saveCurrentSession();
            }
          }
        }
      });
    }
  });

  // Stop generation
  btnStop.addEventListener('click', stopGeneration);

  // Global click delegation for character mentions in chat
  messagesContainer.addEventListener('click', (e) => {
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

  // New chat button
  document.getElementById('btn-new-chat').addEventListener('click', () => {
    if (!appState.currentCharacter) {
      showToast('Select a character first', 'error');
      return;
    }
    startNewChat();
  });

  // Chat History Toggle
  const btnToggleHistory = document.getElementById('btn-toggle-history');
  const historyList = document.getElementById('chat-history-list');
  const historyChevron = document.getElementById('history-chevron');

  if (btnToggleHistory && historyChevron) {
    btnToggleHistory.addEventListener('click', () => {
      const section = btnToggleHistory.closest('.sidebar-section');
      if (section) {
        section.classList.toggle('collapsed');
        const isCollapsed = section.classList.contains('collapsed');
        historyChevron.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
      }
    });
  }

  // Input Settings Popover
  if (btnInputSettings) {
    btnInputSettings.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleInputSettings();
      // Hide other popover
      const chatPlusPopover = document.getElementById('chat-plus-popover');
      if (chatPlusPopover) chatPlusPopover.classList.add('hidden');
    });
  }

  // Chat Plus Popover
  const btnChatPlus = document.getElementById('btn-chat-plus');
  const chatPlusPopover = document.getElementById('chat-plus-popover');
  const btnChatToggleImagegen = document.getElementById('btn-chat-toggle-imagegen');
  const chatImagegenToggleCheck = document.getElementById('chat-imagegen-toggle-check');
  const btnChatToggleNamegen = document.getElementById('btn-chat-toggle-namegen');
  const chatNamegenToggleCheck = document.getElementById('chat-namegen-toggle-check');

  if (btnChatPlus && chatPlusPopover) {
    const chatPlusSlider = document.getElementById('chat-plus-slider');
    const btnChatPlusLorebooks = document.getElementById('btn-chat-plus-lorebooks');
    const btnChatLorebooksBack = document.getElementById('btn-chat-lorebooks-back');
    const btnChatLorebooksManage = document.getElementById('btn-chat-lorebooks-manage');

    btnChatPlus.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = chatPlusPopover.classList.contains('hidden');
      if (isHidden) {
        const enabled = settingsStore.get().comfyui_enabled;
        if (chatImagegenToggleCheck) chatImagegenToggleCheck.checked = !!enabled;
        const namegenEnabled = settingsStore.get().namegen_enabled;
        if (chatNamegenToggleCheck) chatNamegenToggleCheck.checked = !!namegenEnabled;
        if (chatPlusSlider) chatPlusSlider.style.transform = 'translateX(0)';
        chatPlusPopover.classList.remove('hidden');
        if (inputSettingsPopover) inputSettingsPopover.classList.add('hidden');
        
        // Calculate initial height based on main panel
        const mainPanel = document.getElementById('chat-plus-main');
        if (mainPanel) chatPlusPopover.style.height = mainPanel.offsetHeight + 'px';
      } else {
        chatPlusPopover.classList.add('hidden');
      }
    });

    document.addEventListener('click', (e) => {
      if (chatPlusPopover && !chatPlusPopover.contains(e.target) && (!btnChatPlus || !btnChatPlus.contains(e.target))) {
        chatPlusPopover.classList.add('hidden');
        if (chatPlusSlider) chatPlusSlider.style.transform = 'translateX(0)';
      }
    });

    const updateChatPlusHeight = (targetPageId) => {
      if (!chatPlusPopover) return;
      const targetEl = document.getElementById(targetPageId);
      if (targetEl) {
        chatPlusPopover.style.height = targetEl.offsetHeight + 'px';
      }
    };

    if (btnChatPlusLorebooks && chatPlusSlider) {
      btnChatPlusLorebooks.addEventListener('click', async (e) => {
        e.stopPropagation();
        chatPlusSlider.style.transform = 'translateX(-50%)';
        await window.renderChatLorebooksList();
        updateChatPlusHeight('chat-plus-lorebooks-view');
      });
    }
    
    if (btnChatLorebooksBack && chatPlusSlider) {
      btnChatLorebooksBack.addEventListener('click', (e) => {
        e.stopPropagation();
        chatPlusSlider.style.transform = 'translateX(0)';
        updateChatPlusHeight('chat-plus-main');
      });
    }

    if (btnChatLorebooksManage) {
      btnChatLorebooksManage.addEventListener('click', (e) => {
        e.stopPropagation();
        chatPlusPopover.classList.add('hidden');
        const modal = document.getElementById('lorebook-editor-modal');
        if (modal) {
          modal.classList.remove('hidden');
          modal.style.display = 'flex';
          initLorebookButtons();
          renderLorebookEditorList();
        }
      });
    }

    const btnLorebookModalClose = document.getElementById('btn-lorebook-modal-close');
    if (btnLorebookModalClose) {
      btnLorebookModalClose.addEventListener('click', () => {
        const modal = document.getElementById('lorebook-editor-modal');
        if (modal) {
          modal.classList.add('hidden');
          modal.style.display = 'none';
        }
      });
    }
  }

  // Define render functions on window so they can be called easily
  window.renderChatLorebooksList = async function() {
    const container = document.getElementById('chat-lorebooks-list');
    if (!container) return;
    
    const allBooks = await lorebookStore.load();
    const favBooks = allBooks.filter(b => b.favorite);
    
    container.innerHTML = '';
    
    if (favBooks.length === 0) {
      container.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-tertiary); font-size: 12px;">No favorite lorebooks.</div>';
      return;
    }
    const activeSessionId = (typeof chatStore !== 'undefined' && chatStore.getCurrentSession()) ? chatStore.getCurrentSession().id : 'default';
    const savedState = await idbGet(`llmchat_active_lorebooks_${activeSessionId}`);
    const activeState = savedState ? JSON.parse(savedState) : {};
    
    favBooks.forEach(book => {
      const isActive = !!activeState[book.id];
      
      const btn = document.createElement('button');
      btn.className = 'dropdown-option';
      btn.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: var(--radius-sm); border: none; background: transparent; cursor: pointer; width: 100%; text-align: left;';
      btn.innerHTML = `
        <span style="display: flex; flex-direction: column; align-items: flex-start; gap: 2px;">
          <span style="font-weight: 500; font-size: var(--text-sm); color: var(--text-primary);">${book.name}</span>
          <span style="font-size: 11px; color: var(--text-tertiary);">${book.entries?.length || 0} entries</span>
        </span>
        <label class="toggle-switch small" style="pointer-events: none; flex-shrink: 0;">
          <input type="checkbox" ${isActive ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      `;
      
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const activeSessionId = (typeof chatStore !== 'undefined' && chatStore.getCurrentSession()) ? chatStore.getCurrentSession().id : 'default';
        const newState = !isActive;
        activeState[book.id] = newState;
        try {
          await idbSet(`llmchat_active_lorebooks_${activeSessionId}`, JSON.stringify(activeState));
        } catch (e) {
          console.warn("Could not save active lorebooks to IndexedDB", e);
        }
        window.renderChatLorebooksList();
        window.syncLorebookIndicators();
      });
      
      container.appendChild(btn);
    });
  };

  window.syncLorebookIndicators = async function() {
    const container = document.getElementById('active-lorebooks-container');
    if (!container) return;
    
    const allBooks = typeof lorebookStore !== 'undefined' ? lorebookStore.getAll() : [];
    const activeSessionId = (typeof chatStore !== 'undefined' && chatStore.getCurrentSession()) ? chatStore.getCurrentSession().id : 'default';
    const savedState = await idbGet(`llmchat_active_lorebooks_${activeSessionId}`);
    const activeState = savedState ? JSON.parse(savedState) : {};
    
    container.innerHTML = '';
    
    allBooks.forEach(book => {
      if (activeState[book.id]) {
        const el = document.createElement('div');
        // Wrap in a div that looks identical to thinking-effort-wrapper
        el.className = 'thinking-effort-wrapper'; 
        el.style.marginLeft = '4px';
        el.title = `Lorebook ON: ${book.name}`;
        el.innerHTML = `
          <button class="btn-thinking-effort" style="cursor: default; padding-right: 12px; display: flex; align-items: center; gap: 6px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
            <span class="thinking-btn-label" style="display: block;">${escapeHtml(book.name)}</span>
          </button>
        `;
        container.appendChild(el);
      }
    });
  };

    btnChatToggleImagegen.addEventListener('click', (e) => {
      e.stopPropagation();
      const current = settingsStore.get();
      const newVal = !current.comfyui_enabled;
      settingsStore.save({ ...current, comfyui_enabled: newVal });
      if (window.syncImageGenIndicators) {
        window.syncImageGenIndicators();
      } else {
        const chatInd = document.getElementById('chat-imagegen-indicator');
        const chatGear = document.getElementById('btn-imagegen-gear');
        if (chatInd) chatInd.classList.toggle('hidden', !newVal);
        if (chatGear) chatGear.classList.toggle('hidden', !newVal);
        if (chatImagegenToggleCheck) chatImagegenToggleCheck.checked = newVal;
      }
      setTimeout(() => chatPlusPopover.classList.add('hidden'), 350);
    });
    
    if (btnChatToggleNamegen) {
      btnChatToggleNamegen.addEventListener('click', (e) => {
        e.stopPropagation();
        const current = settingsStore.get();
        const newVal = !current.namegen_enabled;
        settingsStore.save({ ...current, namegen_enabled: newVal });
        if (chatNamegenToggleCheck) chatNamegenToggleCheck.checked = newVal;
        setTimeout(() => chatPlusPopover.classList.add('hidden'), 350);
      });
    }

  document.addEventListener('click', (e) => {
    if (inputSettingsPopover && !inputSettingsPopover.contains(e.target) && (!btnInputSettings || !btnInputSettings.contains(e.target))) {
      inputSettingsPopover.classList.add('hidden');
    }
  });

  // ─── Thinking Effort Button ──────────────────────────────────────────
  (function initThinkingEffortBtn() {
    const wrapper = document.getElementById('thinking-effort-wrapper');
    const btnMain = document.getElementById('btn-thinking-effort-main');
    const btnArrow = document.getElementById('btn-thinking-effort-arrow');
    const dropdown = document.getElementById('thinking-effort-dropdown');
    if (!wrapper || !btnArrow || !dropdown) return;

    function refreshThinkingEffortUI() {
      let effort = settingsStore.get().reasoning_effort || 'none';
      const qwenEnabled = !!settingsStore.get().qwen35_thinking_support;
      const gemmaStyleEnabled = !!settingsStore.get().change_gemma4_thinking_style;
      const simplifiedEffort = qwenEnabled || gemmaStyleEnabled;
      if (simplifiedEffort) {
        if (effort !== 'none' && effort !== 'medium' && effort !== 'high') {
          effort = 'none';
        }
      }

      const levelSpan = btnMain?.querySelector('.effort-level-label');
      if (effort === 'none') {
        wrapper.classList.remove('active');
        if (levelSpan) levelSpan.textContent = '';
      } else {
        wrapper.classList.add('active');
        if (levelSpan) {
          if (simplifiedEffort) {
            levelSpan.textContent = effort === 'medium' ? 'Lite' : 'High';
          } else {
            levelSpan.textContent = effort;
          }
        }
      }
      // Mark active option
      dropdown.querySelectorAll('.effort-option').forEach(opt => {
        const val = opt.dataset.value;
        if (simplifiedEffort) {
          if (val === 'none') {
            opt.textContent = 'Off';
            opt.style.display = '';
          } else if (val === 'medium') {
            opt.textContent = 'Lite';
            opt.style.display = '';
          } else if (val === 'high') {
            opt.textContent = 'High';
            opt.style.display = '';
          } else {
            opt.style.display = 'none';
          }
        } else {
          if (val === 'none') opt.textContent = 'None';
          else if (val === 'minimal') opt.textContent = 'Minimal';
          else if (val === 'low') opt.textContent = 'Low';
          else if (val === 'medium') opt.textContent = 'Medium';
          else if (val === 'high') opt.textContent = 'High';
          opt.style.display = '';
        }
        opt.classList.toggle('selected', val === effort);
      });
    }

    const toggleDropdown = (e) => {
      e.stopPropagation();
      const isHidden = dropdown.classList.contains('hidden');
      // Close other popovers
      if (inputSettingsPopover) inputSettingsPopover.classList.add('hidden');
      const chatPlusPopover = document.getElementById('chat-plus-popover');
      if (chatPlusPopover) chatPlusPopover.classList.add('hidden');
      dropdown.classList.toggle('hidden', !isHidden);
    };

    btnArrow.addEventListener('click', toggleDropdown);
    if (btnMain) {
      btnMain.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentEffort = settingsStore.get().reasoning_effort || 'none';
        const qwenEnabled = !!settingsStore.get().qwen35_thinking_support;
        const gemmaStyleEnabled = !!settingsStore.get().change_gemma4_thinking_style;
        const simplifiedEffort = qwenEnabled || gemmaStyleEnabled;
        if (currentEffort !== 'none') {
          settingsStore.save({ ...settingsStore.get(), reasoning_effort: 'none', previous_reasoning_effort: currentEffort });
        } else {
          let prev = settingsStore.get().previous_reasoning_effort || 'medium';
          if (simplifiedEffort && prev !== 'none' && prev !== 'medium' && prev !== 'high') {
            prev = 'medium';
          }
          settingsStore.save({ ...settingsStore.get(), reasoning_effort: prev });
        }
        if (dropdown) dropdown.classList.add('hidden');
        refreshThinkingEffortUI();
        if (window.refreshGenAIThinkingEffortUI) window.refreshGenAIThinkingEffortUI();
      });
    }

    dropdown.addEventListener('click', (e) => {
      const opt = e.target.closest('.effort-option');
      if (!opt) return;
      e.stopPropagation();
      const value = opt.dataset.value;
      if (!value || value === 'extended') return;
      const updateData = { reasoning_effort: value };
      if (value !== 'none') {
        updateData.previous_reasoning_effort = value;
      }
      settingsStore.save({ ...settingsStore.get(), ...updateData });
      dropdown.classList.add('hidden');
      refreshThinkingEffortUI();
      if (window.refreshGenAIThinkingEffortUI) window.refreshGenAIThinkingEffortUI();
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    });

    refreshThinkingEffortUI();
    window.refreshThinkingEffortUI = refreshThinkingEffortUI;
  })();
  // ─────────────────────────────────────────────────────────────────────

  setupRightSidebarToggle();


  // Init Image Gen indicator based on saved settings and add click handler to open settings modal
  const _chatInd = document.getElementById('chat-imagegen-indicator');
  const _chatGear = document.getElementById('btn-imagegen-gear');
  if (_chatInd) {
    const _igEnabled = settingsStore.get().comfyui_enabled;
    _chatInd.classList.toggle('hidden', !_igEnabled);
    if (_chatGear) _chatGear.classList.toggle('hidden', !_igEnabled);
    
    _chatInd.addEventListener('click', (e) => {
      e.stopPropagation();
      openWindow('modal-settings-imagegen');
    });

    if (_chatGear) {
      _chatGear.addEventListener('click', (e) => {
        e.stopPropagation();
        openWindow('modal-settings-imagegen');
      });
    }
  }

  // Listen for GenAI programmatic message sends
  window.addEventListener('genai-send-chat-message', (e) => {
    if (appState.isGenerating) return;
    const { content } = e.detail;
    if (content) {
      messageInput.value = content;
      sendMessage();
    }
  });

  // Listen for GenAI programmatic chat management
  window.addEventListener('genai-create-new-chat', (e) => {
    const { character_id } = e.detail;
    const character = characterStore.getById(character_id);
    if (character) {
      selectCharacter(character, 'NEW');
    }
  });

  window.addEventListener('genai-switch-chat', (e) => {
    const { chat_id, character_id } = e.detail;
    const character = characterStore.getById(character_id);
    if (character) {
      selectCharacter(character, chat_id);
    }
  });

  window.addEventListener('genai-rename-chat', (e) => {
    const { chat_id, character_id, new_title } = e.detail;
    chatStore.renameSession(chat_id, new_title, character_id).then(() => {
      if (appState.currentCharacter?.id === character_id) {
        updateChatHistory();
      }
    });
  });

  // Make AI comment feature global
  window.requestAiComment = requestAiComment;

  // ─── Suggestions Explorer Modal Event Listeners ────────────────────
  const btnCloseMore = document.getElementById('btn-close-more-suggestions');
  if (btnCloseMore) {
    btnCloseMore.addEventListener('click', () => {
      closeWindow('more-suggestions-modal');
      abortMoreSuggestionsGeneration();
    });
  }

  const btnMoreRefresh = document.getElementById('btn-more-suggestions-refresh');
  if (btnMoreRefresh) {
    btnMoreRefresh.addEventListener('click', () => {
      generateMoreSuggestions();
    });
  }

  const btnMoreSendTopic = document.getElementById('btn-more-suggestions-send-topic');
  const inputMoreTopic = document.getElementById('more-suggestions-topic-input');
  if (btnMoreSendTopic && inputMoreTopic) {
    const handleSendTopic = () => {
      const topic = inputMoreTopic.value.trim();
      if (topic) {
        generateMoreSuggestions(topic);
        inputMoreTopic.value = '';
      }
    };
    btnMoreSendTopic.addEventListener('click', handleSendTopic);
    inputMoreTopic.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSendTopic();
      }
    });
  }
}

function toggleInputSettings() {
  const isHidden = inputSettingsPopover.classList.contains('hidden');
  if (isHidden) {
    renderInputSettings();
    inputSettingsPopover.classList.remove('hidden');
  } else {
    inputSettingsPopover.classList.add('hidden');
  }
}

function renderInputSettings() {
  const settings = settingsStore.get();
  const length = settings.response_length || 'auto';
  const depth = settings.description_depth || 0;


  inputSettingsPopover.innerHTML = `
    <div class="settings-group">
      <h4>Response Length</h4>
      <div class="response-length-selector">
        ${['auto', 'short', 'medium', 'long'].map(l => `
          <button class="length-option ${length === l ? 'active' : ''}" data-length="${l}">
            ${l}
          </button>
        `).join('')}
      </div>
    </div>
    <div class="settings-group">
      <h4>Description Depth</h4>
      <div class="description-depth-slider">
        <input type="range" id="input-depth-slider" min="0" max="4" step="1" value="${depth}">
        <div class="depth-labels">
          <span>Auto</span>
          <span>1</span>
          <span>2</span>
          <span>3</span>
          <span>Max</span>
        </div>
      </div>
    </div>

    <div class="indicator-management-section">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <h4 style="margin: 0;">Mood Indicators</h4>
        ${(() => {
      if (appState.currentChat && !appState.currentChat.indicators) {
        appState.currentChat.indicators = { enabled: false, list: [] };
      }
      return '';
    })()}
        <label class="toggle-switch small">
          <input type="checkbox" id="toggle-indicators" ${appState.currentChat?.indicators?.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="indicator-preset-list">
        ${settings.indicator_presets.map(p => `
          <div class="indicator-preset-item" data-preset-id="${p.id}">
            <span class="indicator-preset-name">${p.name}</span>
          </div>
        `).join('')}
        ${settings.custom_indicator_presets.map((p, idx) => `
          <div class="indicator-preset-item" data-custom-idx="${idx}">
            <span class="indicator-preset-name">${p.name}</span>
            <button class="btn-delete-preset" style="background:none; border:none; color:var(--text-tertiary); padding:4px; cursor:pointer;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px; height:12px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        `).join('')}
      </div>

      <button id="btn-add-indicator" class="btn-add-indicator-preset">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px; height:14px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Add Custom Indicators</span>
      </button>
    </div>

    <div class="settings-group" style="margin-top: 12px; border-top: 1px solid var(--border-subtle); padding-top: 12px;">
      <button id="btn-open-advanced" class="btn-secondary btn-full" style="gap: 8px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <span>Advanced settings</span>
      </button>
    </div>
  `;

  // Handlers for length
  inputSettingsPopover.querySelectorAll('.length-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const newLength = btn.dataset.length;
      settingsStore.save({ ...settingsStore.get(), response_length: newLength });
      renderInputSettings();
    });
  });

  // Handlers for depth
  const slider = inputSettingsPopover.querySelector('#input-depth-slider');
  slider.addEventListener('input', () => {
    const newDepth = parseInt(slider.value);
    settingsStore.save({ ...settingsStore.get(), description_depth: newDepth });
  });

  // Toggle indicators
  const toggleIndicators = inputSettingsPopover.querySelector('#toggle-indicators');
  toggleIndicators?.addEventListener('change', () => {
    if (!appState.currentChat) return;
    if (!appState.currentChat.indicators) {
      appState.currentChat.indicators = { enabled: false, list: [] };
    }
    appState.currentChat.indicators.enabled = toggleIndicators.checked;
    chatStore.saveCurrentSession();
    renderIndicators();
  });

  // Preset selection
  inputSettingsPopover.querySelectorAll('.indicator-preset-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-preset')) {
        const idx = item.dataset.customIdx;
        const currentSettings = settingsStore.get();
        currentSettings.custom_indicator_presets.splice(idx, 1);
        settingsStore.save(currentSettings);
        renderInputSettings();
        return;
      }

      if (!appState.currentChat) return;
      const presetId = item.dataset.presetId;
      const customIdx = item.dataset.customIdx;

      let indicatorsList = [];
      if (presetId) {
        const preset = settings.indicator_presets.find(p => p.id === presetId);
        indicatorsList = preset.indicators.map(name => ({ name, value: 50 }));
      } else if (customIdx !== undefined) {
        const preset = settings.custom_indicator_presets[customIdx];
        indicatorsList = preset.indicators.map(name => ({ name, value: 50 }));
      }

      appState.currentChat.indicators = {
        enabled: true,
        list: indicatorsList
      };
      chatStore.saveCurrentSession();
      renderIndicators();
      renderInputSettings(); // refresh to show toggle as checked
    });
  });

  // Add custom indicators
  const btnAdd = inputSettingsPopover.querySelector('#btn-add-indicator');
  btnAdd?.addEventListener('click', async () => {
    const names = await showPrompt('Add Indicators', 'Enter indicator names separated by commas (e.g. Trust, Fear, Anger)');
    if (names) {
      const list = names.split(',').map(s => s.trim()).filter(s => s !== '');
      if (list.length > 0) {
        const presetName = await showPrompt('Save Preset', 'Enter a name for this preset', 'My Preset');
        if (presetName) {
          const currentSettings = settingsStore.get();
          currentSettings.custom_indicator_presets.push({
            name: presetName,
            indicators: list
          });
          settingsStore.save(currentSettings);
          renderInputSettings();
        }
      }
    }
  });

  const btnAdv = inputSettingsPopover.querySelector('#btn-open-advanced');
  btnAdv?.addEventListener('click', () => {
    inputSettingsPopover.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('open-advanced-settings'));
  });

  const imageGenToggle = inputSettingsPopover.querySelector('#input-imagegen-toggle-check');
  imageGenToggle?.addEventListener('change', () => {
    const newVal = imageGenToggle.checked;
    settingsStore.save({ ...settingsStore.get(), comfyui_enabled: newVal });
    // Sync all indicators + genai popover toggle via global helper
    if (window.syncImageGenIndicators) window.syncImageGenIndicators();
    else {
      const chatInd = document.getElementById('chat-imagegen-indicator');
      const chatGear = document.getElementById('btn-imagegen-gear');
      if (chatInd) chatInd.classList.toggle('hidden', !newVal);
      if (chatGear) chatGear.classList.toggle('hidden', !newVal);
    }
  });
}

export function renderIndicators() {
  const container = document.getElementById('chat-indicators');
  if (!container) return;

  const session = appState.currentChat;
  if (!session || !session.indicators?.enabled || !session.indicators.list?.length) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = session.indicators.list.map(ind => `
    <div class="indicator-item" title="${escapeHtml(ind.name)}: ${ind.value}%">
      <div class="indicator-label">
        <span>${escapeHtml(ind.name)}</span>
        <span class="indicator-value">${ind.value}%</span>
      </div>
      <div class="indicator-bar-container">
        <div class="indicator-bar-fill" style="width: ${ind.value}%"></div>
      </div>
    </div>
  `).join('');
}

// ─── Start New Chat ─────────────────────────────────────────────────

export function startNewChat(character = null) {
  const char = character || appState.currentCharacter;
  if (!char) return;

  const session = chatStore.createSession(char.id);

  // Only update global appState if this character is active
  if (appState.currentCharacter?.id === char.id) {
    appState.currentChat = session;
    clearMessages();
    renderIndicators();
    if (window.syncLorebookIndicators) window.syncLorebookIndicators();
  }

  // Show first message if character has one
  if (char.first_message) {
    const settings = settingsStore.get();
    const userName = settings.user_name || 'User';

    // Support random first message if multiple are available
    let content = char.first_message;
    let greetingIdx = 0;

    // In SillyTavern, users usually want to start with the primary one, 
    // but some apps randomize. We'll start with index 0 (primary).
    session.selected_greeting_index = 0;

    let processedContent = content.replace(/\{\{user\}\}/gi, userName);
    processedContent = processedContent.replace(/\{\{char\}\}/gi, char.name);

    const msg = chatStore.addMessage('assistant', processedContent, null, session);
    characterStore.updateLastChat(char.id);
    window.dispatchEvent(new CustomEvent('character-list-updated'));
    if (appState.currentCharacter?.id === char.id) {
      appendMessage(msg, false, char);
    }
  }

  chatStore.saveSession(session);
  if (appState.currentCharacter?.id === char.id) {
    updateChatHistory();
    updateContextIndicator();
    if (window.updateUserNameDisplay) {
      window.updateUserNameDisplay();
    }
    window.dispatchEvent(new CustomEvent('genai-active-skills-changed'));
  }
}

// ─── Load Existing Chat ─────────────────────────────────────────────

export function loadChat(session) {
  if (!session) return;
  if (appState.currentCharacter?.id !== session.character_id) return;
  if (!session.summaryChunks && session.summary_chunks) {
    session.summaryChunks = session.summary_chunks;
  }
  if (!session.summary_chunks && session.summaryChunks) {
    session.summary_chunks = session.summaryChunks;
  }
  if (!session.summaryChunks) {
    session.summaryChunks = [];
    session.summary_chunks = [];
  }
  appState.currentChat = session;
  chatStore.setCurrentSession(session);
  clearMessages();

  if (window.updateUserNameDisplay) {
    window.updateUserNameDisplay();
  }

  for (const msg of session.messages) {
    appendMessage(msg);
  }

  const toggleBtn = document.getElementById('btn-toggle-right-sidebar');
  if (toggleBtn) {
    toggleBtn.classList.remove('hidden');
  }

  const settings = settingsStore.get();
  if (!settings.genai_mode_enabled) {
    renderAiCommentsHistory();
  }
  renderIndicators();
  updateContextIndicator();
  scrollToBottom();
  updateChatHistory();
  window.dispatchEvent(new CustomEvent('genai-active-skills-changed'));
  if (window.syncLorebookIndicators) window.syncLorebookIndicators();
}

// ─── Select Character ───────────────────────────────────────────────

export async function selectCharacter(character, sessionId = null) {
  if (!character) {
    appState.currentCharacter = null;
    appState.currentChat = null;
    chatStore.setCurrentSession(null);

    // Update header
    if (headerCharName) headerCharName.textContent = 'Select a character';
    if (headerCharStatus) {
      headerCharStatus.textContent = 'Ready';
      headerCharStatus.classList.remove('generating');
    }
    if (headerAvatar) {
      headerAvatar.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
      </svg>`;
    }

    // Clear messages
    if (messagesContainer) {
      messagesContainer.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>
          </svg>
          <h3>No character selected</h3>
          <p>Select a character from the sidebar or create a new one to start chatting.</p>
        </div>
      `;
    }

    // Clear indicators
    const container = document.getElementById('chat-indicators');
    if (container) {
      container.classList.add('hidden');
    }

    // Clear chat history list
    const historyList = document.getElementById('chat-history-list');
    if (historyList) {
      historyList.innerHTML = '';
    }

    // Update character list active states
    const list = document.getElementById('character-list');
    if (list) {
      const items = list.querySelectorAll('.character-item');
      items.forEach(item => item.classList.remove('active'));
    }

    window.dispatchEvent(new CustomEvent('character-selected', { detail: { id: null } }));
    return;
  }

  const charId = character.id;
  appState.currentCharacter = character;

  // Update header
  headerCharName.textContent = character.name;
  headerCharStatus.textContent = 'Ready';

  if (character.avatar) {
    headerAvatar.innerHTML = `<img src="${character.avatar}" alt="${escapeHtml(character.name)}">`;
  } else {
    headerAvatar.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
    </svg>`;
  }

  // 1. Clear history list immediately to provide instant feedback
  const list = document.getElementById('chat-history-list');
  if (list) {
    list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-tertiary); font-size: var(--text-sm);">Loading chats...</div>';
  }

  try {
    // 2. Load chats for this character
    try {
      await chatStore.loadForCharacter(charId);
    } catch (err) {
      console.warn('Failed to load chats:', err);
    }

    // 3. Load memory (don't block UI for this)
    memoryService.loadForCharacter(charId).catch(err => console.warn('Memory load failed:', err));

    // Check if this character is still the active one
    if (appState.currentCharacter?.id !== charId) return;

    const sessions = chatStore.getSessions(charId);
    if (sessionId === 'NEW') {
      startNewChat(character);
    } else if (sessionId) {
      const session = sessions.find(s => s.id === sessionId);
      if (session) {
        loadChat(session);
      } else {
        loadChat(sessions[0] || null);
      }
    } else if (sessions && sessions.length > 0) {
      loadChat(sessions[0]);
    } else {
      startNewChat(character);
    }
  } catch (err) {
    console.error('Critical switch error:', err);
  } finally {
    // 4. ENSURE UI updates even if something failed
    updateChatHistory(charId);
    renderIndicators();
    updateContextIndicator();
    window.dispatchEvent(new CustomEvent('character-selected', { detail: { id: charId } }));
  }
}

// ─── Send Message ───────────────────────────────────────────────────

/**
 * Smoothly replaces text in an element with a translation from a stream
 * @param {HTMLElement} contentEl
 * @param {string} textToTranslate
 * @param {string} targetLang
 * @returns {Promise<string>}
 */
async function performStreamingTranslation(contentEl, textToTranslate, targetLang) {
  let fullTranslatedBuffer = '';

  await new Promise((resolve) => {
    api.streamTranslate(
      textToTranslate,
      targetLang,
      (chunk) => {
        fullTranslatedBuffer += chunk;

        const targetHtml = wrapWordsInSpans(renderMarkdown(fullTranslatedBuffer));
        const temp = document.createElement('div');
        temp.innerHTML = targetHtml;

        morphdom(contentEl, temp, {
          childrenOnly: true,
          getNodeKey: (node) => node.dataset?.wordIndex || node.id || null,
          onBeforeElUpdated: (from, to) => {
            if (from.nodeName === 'THINKING-SNIPPETS') {
              if (to.hasAttribute('thoughts')) {
                from.setAttribute('thoughts', to.getAttribute('thoughts'));
              }
              return false;
            }
            if (from.classList && from.classList.contains('word-blur') && from.textContent !== to.textContent) {
              from.classList.add('word-replacing-out');
              setTimeout(() => {
                from.textContent = to.textContent;
                from.classList.remove('word-replacing-out');
                from.classList.add('word-replacing-in');
                setTimeout(() => from.classList.remove('word-replacing-in'), 400);
              }, 120);
              return false;
            }
            return true;
          },
          onNodeAdded: (node) => {
            if (node.classList?.contains('word-blur')) {
              node.classList.add('word-replacing-in');
              setTimeout(() => node.classList.remove('word-replacing-in'), 400);
            }
          },
        });
      },
      () => resolve(),
      (err) => {
        console.error('Translation stream error:', err);
        resolve();
      }
    );
  });

  return fullTranslatedBuffer;
}

// ─── Send Message ───────────────────────────────────────────────────

async function sendMessage() {
  const content = messageInput.value.trim();

  if (appState.isGenerating) return;

  // Abort pending suggestions generation if any
  if (appState.suggestionsAbortController) {
    appState.suggestionsAbortController.abort();
    appState.suggestionsAbortController = null;
  }

  // Abort any pending context calculations to prevent concurrent API requests
  if (activeContextCalculationController) {
    activeContextCalculationController.abort();
    activeContextCalculationController = null;
  }

  const settings = settingsStore.get();
  const character = appState.currentCharacter;
  if (!character) {
    showToast('Select a character first', 'error');
    return;
  }

  let session = appState.currentChat;

  if (!content) {
    // If input is empty, check if we should regenerate (last message is user)
    if (session && session.messages.length > 0) {
      const lastMsg = session.messages[session.messages.length - 1];
      if (lastMsg.role === 'user') {
        triggerAssistantGeneration();
        return;
      }
    }
    return;
  }

  if (!session) {
    startNewChat(character);
    session = appState.currentChat;
  }

  // Add user message
  const userMsg = chatStore.addMessage('user', content, null, session);
  characterStore.updateLastChat(character.id);
  window.dispatchEvent(new CustomEvent('character-list-updated'));
  const userMsgElement = appendMessage(userMsg, false, character);
  const userContentEl = userMsgElement.querySelector('.message-text');

  // Immediate save to prevent loss if app is closed before AI response
  await chatStore.saveSession(session);

  // Clear input
  messageInput.value = '';
  autoResizeTextarea(messageInput);

  // If outgoing translation is enabled, translate first
  if (settings.translate_user_messages) {
    headerCharStatus.textContent = 'Translating your message...';
    headerCharStatus.classList.add('generating');
    const target = settings.outgoing_target_language || 'English';
    const translated = await performStreamingTranslation(userContentEl, content, target);
    if (translated) {
      chatStore.updateMessage(userMsg.id, { translated_content: translated });
      await chatStore.saveSession(session);
    }
    headerCharStatus.textContent = 'Ready';
    headerCharStatus.classList.remove('generating');
  }

  // Start generation
  appState.isGenerating = true;
  appState.abortController = new AbortController();
  btnSend.classList.add('hidden');
  btnStop.classList.remove('hidden');
  headerCharStatus.textContent = 'Generating...';
  headerCharStatus.classList.add('generating');

  // Build messages array for API (will use translated_content for user messages if available)
  const apiMessages = await buildApiMessages(character, session);

  // Update UI context indicator instantly using the now-warmed cache
  updateContextIndicator(true);

  // Add placeholder assistant message
  const assistantMsg = chatStore.addMessage('assistant', '', null, session);
  const msgElement = appendMessage(assistantMsg, true, character);
  const contentEl = msgElement.querySelector('.message-text');

  let fullResponse = (settings.force_reasoning && settings.reasoning_tag_open && (settings.reasoning_effort || 'none') !== 'none') ? settings.reasoning_tag_open : '';
  let thinkingText = '';    // accumulated thinking from delta.reasoning_content
  let isStreaming = true;   // true while generation is in progress
  let hasReceivedFirstChunk = false; // tracks if anything has arrived yet
  let thinkingActive = false; // true during thinking phase, false once content starts
  let thinkingStartTime = Date.now();
  let thinkingTime = 0;
  let thinkingActiveInline = false;

  // Dynamic options override
  const apiOptions = {};

  // Show Processing... immediately while waiting for API response
  contentEl.innerHTML = `<span class="chat-working-placeholder">Processing...</span>`;

  // Morphdom options — shared between stream and final renders
  const morphOptions = {
    childrenOnly: true,
    getNodeKey: (node) => node.dataset?.wordIndex || node.id || null,
    onBeforeElUpdated: (from, to) => {
      // Keep THINKING-SNIPPETS alive (let attributeChangedCallback handle updates)
      // BUT only when the replacement is ALSO THINKING-SNIPPETS — otherwise let morphdom replace it
      if (from.nodeName === 'THINKING-SNIPPETS' && to.nodeName === 'THINKING-SNIPPETS') {
        if (to.hasAttribute('thoughts')) {
          from.setAttribute('thoughts', to.getAttribute('thoughts'));
        }
        return false;
      }
      // Force clearing of display: none style when elements should no longer be hidden
      if (from.style && from.style.display === 'none' && to.style.display !== 'none') {
        from.style.display = '';
      }
      // For table elements: replace innerHTML directly to avoid morphdom flickering
      if (from.nodeName === 'TABLE') {
        if (from.innerHTML !== to.innerHTML) {
          from.innerHTML = to.innerHTML;
        }
        return false;
      }
      return true;
    }
  };

  // Shared UI updater — called both from onChunk and onThinkingChunk
  function scheduleUpdate() {
    if (appState.updateScheduled) return;
    appState.updateScheduled = true;

    requestAnimationFrame(() => {
      appState.updateScheduled = false;
      if (!isStreaming) return;

      try {
        const useGLM = settings.glm47_support && !/<(?:think|thought|reasoning|\|channel>thought)/i.test(fullResponse);
        let displayContent, currentThinking, currentIsInThinking;
        if (thinkingText) {
          // delta.reasoning_content path: thinking comes separately
          currentThinking = thinkingText;
          currentIsInThinking = thinkingActive;
          let cleanResponseForParsing = fullResponse;
          if (settings.force_reasoning && settings.reasoning_tag_open && cleanResponseForParsing.startsWith(settings.reasoning_tag_open)) {
            cleanResponseForParsing = cleanResponseForParsing.substring(settings.reasoning_tag_open.length);
          }
          displayContent = cleanResponseForParsing;
        } else {
          // Inline tag or GLM 4.7 path
          const parsed = useGLM ? parseGLMThinking(fullResponse) : parseStreamThinking(fullResponse, settings.reasoning_tag_open, settings.reasoning_tag_close);
          currentThinking = parsed.thinking;
          displayContent = parsed.content;
          currentIsInThinking = parsed.isInThinking;
          
          if (parsed.isInThinking && !thinkingActiveInline) {
            thinkingActiveInline = true;
            thinkingStartTime = Date.now();
          }

          // Detect thinking→done transition for inline tags
          if (thinkingActiveInline && !parsed.isInThinking && parsed.thinking) {
            thinkingActiveInline = false;
            thinkingTime = Math.round((Date.now() - thinkingStartTime) / 1000);
          }
        }

        // Still waiting for first output — keep Working... visible
        if (!hasReceivedFirstChunk) return;

        if (!currentIsInThinking && displayContent.startsWith('*') && !displayContent.endsWith('*')) {
          displayContent += '*';
        }

        const isNewAnimation = settings.new_streaming_animation;
        const streamingSpeed = settings.streaming_speed || 45;

        // Helper: renders content into contentEl using morphdom
        const renderChatContent = (dc, thinking, isInThinking, revealProgress) => {
          let html = '';
          const showThinking = isInThinking || thinking;
          if (showThinking) {
            html += createThinkingBlockHTML(thinking, isInThinking, settings.glm47_support, typeof thinkingTime !== "undefined" ? thinkingTime : 0, settings.reasoning_effort);
          }
          const cleaned = stripJsonBlocks(dc, true);
          let formatted = renderMarkdown(cleaned);
          formatted = processCharacterMentions(formatted);

          if (isNewAnimation) {
            html += wrapWordsInSpans(formatted, true, revealProgress, streamingSpeed);
            contentEl._rawCharCount = wrapWordsInSpans.lastTotalChars || 0;
          } else {
            html += wrapWordsInSpans(formatted);
          }

          if (!cleaned.trim() && isStreaming && !isInThinking) {
            html += `<span class="chat-working-placeholder">Processing...</span>`;
          }

          const temp = document.createElement('div');
          temp.className = contentEl.className;
          temp.innerHTML = html;

          morphdom(contentEl, temp, morphOptions);

          if (!isInThinking) {
            getOrCreateChatCursor();
            repositionChatCursor(contentEl);
          }
          scrollToBottom(false);
        };

        if (isNewAnimation) {
          // Always store latest state so animateReveal can access fresh data
          contentEl._latestState = { displayContent, currentThinking, currentIsInThinking };

          if (!contentEl._revealInterval) {
            contentEl._revealProgress = contentEl._revealProgress || 0;
            contentEl._lastRevealTime = performance.now();
            contentEl.classList.remove('stream-finished');

            const animateReveal = () => {
              if (!contentEl || !contentEl.isConnected) {
                contentEl._revealInterval = null;
                return;
              }

              const rawLimit = contentEl._rawCharCount || 0;
              const isCurrentlyStreaming = isStreaming;

              const now = performance.now();
              const deltaMs = now - contentEl._lastRevealTime;
              contentEl._lastRevealTime = now;

              const spd = settings.streaming_speed || 45;
              const charsToAdd = deltaMs * (spd / 1000);
              const oldProgress = contentEl._revealProgress;
              contentEl._revealProgress = Math.min(rawLimit, contentEl._revealProgress + charsToAdd);

              contentEl.style.setProperty('--reveal-progress', contentEl._revealProgress + 'ch');

              if (Math.floor(contentEl._revealProgress) > Math.floor(oldProgress)) {
                // Re-render using the LATEST stored state (not stale closure)
                const state = contentEl._latestState;
                if (state) {
                  renderChatContent(state.displayContent, state.currentThinking, state.currentIsInThinking, contentEl._revealProgress);
                }
              }

              if (isCurrentlyStreaming || contentEl._revealProgress < rawLimit) {
                contentEl._revealInterval = requestAnimationFrame(animateReveal);
              } else {
                contentEl.style.setProperty('--reveal-progress', (rawLimit + 20) + 'ch');
                contentEl.classList.add('stream-finished');
                const revealSpans = contentEl.querySelectorAll('.word-reveal');
                revealSpans.forEach(span => span.classList.add('revealed'));
                contentEl._revealInterval = null;

                if (contentEl._onRevealFinish) {
                  contentEl._onRevealFinish();
                  contentEl._onRevealFinish = null;
                }
              }
            };
            contentEl._revealInterval = requestAnimationFrame(animateReveal);
          }

          // Render immediately with current progress
          renderChatContent(displayContent, currentThinking, currentIsInThinking, contentEl._revealProgress || 0);
        } else {
          renderChatContent(displayContent, currentThinking, currentIsInThinking, 0);
        }
      } catch (err) {
        console.error("STREAM CHUNK ERROR:", err);
        showToast("Streaming UI error: " + err.message, "error");
      }
    });
  }

  try {
    await api.streamChat(
      apiMessages,
      appState.abortController.signal,
      // onChunk (delta.content)
      (chunk) => {
        fullResponse += chunk;
        hasReceivedFirstChunk = true;
        // If thinking was active and we now have content, thinking phase is done
        if (thinkingActive) {
          thinkingActive = false;
          if (thinkingTime === 0) thinkingTime = Math.round((Date.now() - thinkingStartTime) / 1000);
        }
        scheduleUpdate();
      },
      // onDone
      async () => {
        isStreaming = false;
        if (thinkingActive) {
          thinkingActive = false;
          if (thinkingTime === 0) thinkingTime = Math.round((Date.now() - thinkingStartTime) / 1000);
        }

        const finalizeUI = async () => {
          const useGLM = settings.glm47_support && !/<(?:think|thought|reasoning|\|channel>thought)/i.test(fullResponse);
          let parsedThinking, parsedContent;
          try {
            if (thinkingText) {
              parsedThinking = thinkingText;
              let cleanResponseForParsing = fullResponse;
              if (settings.force_reasoning && settings.reasoning_tag_open && cleanResponseForParsing.startsWith(settings.reasoning_tag_open)) {
                cleanResponseForParsing = cleanResponseForParsing.substring(settings.reasoning_tag_open.length);
              }
              parsedContent = cleanResponseForParsing;
            } else {
              const parsed = useGLM ? parseGLMThinking(fullResponse) : parseThinking(fullResponse, settings.reasoning_tag_open, settings.reasoning_tag_close);
              parsedThinking = parsed.thinking;
              parsedContent = parsed.content;
            }

            removeChatCursor();
            let finalHtml = '';
            if (parsedThinking) {
              if (thinkingTime === 0) thinkingTime = Math.round((Date.now() - thinkingStartTime) / 1000);
              finalHtml += createThinkingBlockHTML(parsedThinking, false, settings.glm47_support, thinkingTime, settings.reasoning_effort);
            }
            const cleaned = stripJsonBlocks(parsedContent, false);
            let formatted = renderMarkdown(cleaned);
            formatted = processCharacterMentions(formatted);
            
            const isNewAnimation = settings.new_streaming_animation;
            if (isNewAnimation) {
              finalHtml += wrapWordsInSpans(formatted, true, Infinity, settings.streaming_speed || 45);
            } else {
              finalHtml += wrapWordsInSpans(formatted);
            }

            const tempFinal = document.createElement('div');
            tempFinal.className = contentEl.className;
            tempFinal.innerHTML = finalHtml;

            perf.start('morphdom-final-patch');
            morphdom(contentEl, tempFinal, morphOptions);
            perf.end('morphdom-final-patch');
          } catch (err) {
            console.error("ON DONE ERROR:", err);
            showToast("Final UI render error: " + err.message, "error");
            const fallback = parseThinking(fullResponse, settings.reasoning_tag_open, settings.reasoning_tag_close);
            parsedThinking = fallback.thinking;
            parsedContent = fallback.content;
          }

          let originalContent = parsedContent;

          let translatedContent = null;

          // Auto-translation (AI response)
          if (settings.auto_translate && originalContent) {
            headerCharStatus.textContent = 'Translating...';
            headerCharStatus.classList.add('generating');
            translatedContent = await performStreamingTranslation(contentEl, originalContent, settings.target_language);
          }

          chatStore.updateLastAssistantMessage(originalContent, parsedThinking, session, translatedContent, thinkingTime);
          await chatStore.saveSession(session);
          updateContextIndicator();

          if (appState.currentCharacter?.id === character.id) {
            appState.isGenerating = false;
            appState.abortController = null;
            btnSend.classList.remove('hidden');
            btnStop.classList.add('hidden');
            headerCharStatus.textContent = 'Ready';
            headerCharStatus.classList.remove('generating');
            updateChatHistory();
            updateRegenerateVisibility();
            scrollToBottom();
          }

          if (originalContent) {
            // Strict sequential execution IIFE to respect single-concurrency LLM limits
            (async () => {
              try {
                // 1. Generate continuation options replies first (High Priority UI)
                await generateContinuationOptions(character, session, msgElement);
              } catch (e) {
                console.warn('Failed to generate suggestions:', e);
              }

              try {
                // 2. Process Image Gen suggestion popup (High Priority UI)
                const freshSettings = settingsStore.get();
                if (freshSettings.comfyui_enabled && freshSettings.comfyui_auto_chat) {
                  await triggerAutomaticImageGeneration(character, session, originalContent);
                } else if (freshSettings.comfyui_enabled && !freshSettings.comfyui_auto_chat) {
                  await triggerImageGenerationSuggestion(character, session, originalContent, msgElement);
                }
              } catch (e) {
                console.warn('Failed to handle image generation:', e);
              }

              try {
                // 3. Extract and save memory (Low Priority Background)
                await extractAndShowMemory(character, session, content, originalContent, msgElement);
              } catch (e) {
                console.warn('Failed to extract memory:', e);
              }

              try {
                // 4. Update indicators status (Low Priority Background)
                await triggerIndicatorUpdate(character, session, content, originalContent);
              } catch (e) {
                console.warn('Failed to update indicators:', e);
              }

              // 5. Notify GenAI (for vibe plot mode)
              notifyGenAI(originalContent, character.name);

              try {
                // 6. Auto-naming
                const freshSettings = settingsStore.get();
                if (freshSettings.auto_naming_enabled) {
                  const chatMessages = session.messages.filter(m => m.role !== 'system');
                  const msgCount = chatMessages.length;
                  const lastCount = session.last_auto_named_count || (session.custom_title ? 3 : 0);

                  if (lastCount === 0 && msgCount >= 3 && !session.custom_title) {
                    const newName = await api.generateChatName(chatMessages, true);
                    if (newName && newName !== 'New Chat') {
                      session.last_auto_named_count = msgCount;
                      await chatStore.renameSession(session.id, newName, session.character_id);
                      updateChatHistory();
                    }
                  } else if (lastCount > 0 && (msgCount - lastCount >= 6)) {
                    if (freshSettings.continuous_auto_naming_enabled) {
                      const newName = await api.generateChatName(chatMessages, true);
                      if (newName && newName !== 'New Chat') {
                        session.last_auto_named_count = msgCount;
                        await chatStore.renameSession(session.id, newName, session.character_id);
                        updateChatHistory();
                      }
                    }
                  }
                }
              } catch (e) {
                console.warn('Failed to auto-name chat:', e);
              }
            })();
          }

          window.dispatchEvent(new CustomEvent('genai-chat-response-finished'));
          checkConnection();
        };

        if (settings.new_streaming_animation && contentEl._revealInterval) {
          contentEl._onRevealFinish = finalizeUI;
        } else {
          await finalizeUI();
        }
      },
      // onError
      (err) => {
        console.error('Stream error:', err);
        isStreaming = false;
        removeChatCursor();
        contentEl.innerHTML = `<p style="color: var(--error)">Error: ${escapeHtml(err.message)}</p>`;

        if (appState.currentCharacter?.id === character.id) {
          appState.isGenerating = false;
          appState.abortController = null;
          btnSend.classList.remove('hidden');
          btnStop.classList.add('hidden');
          headerCharStatus.textContent = 'Error';
          headerCharStatus.classList.remove('generating');
          updateContextIndicator();
        }
        window.dispatchEvent(new CustomEvent('genai-chat-response-finished', { detail: { error: err.message } }));
      },
      apiOptions,
      // onThinkingChunk (delta.reasoning_content from KoboldCpp thinking models)
      (thinkChunk) => {
        thinkingText += thinkChunk;
        thinkingActive = true;  // mark thinking phase as active
        hasReceivedFirstChunk = true;
        scheduleUpdate();
      }
    );
  } catch (err) {
    console.error('Send error:', err);
    showToast('Failed to send message', 'error');
    if (appState.currentCharacter?.id === character.id) {
      appState.isGenerating = false;
      updateContextIndicator();
    }
    window.dispatchEvent(new CustomEvent('genai-chat-response-finished', { detail: { error: err.message } }));
  }
}

// ─── Memory Extraction ──────────────────────────────────────────────

async function extractAndShowMemory(character, session, userMessage, assistantResponse, msgElement) {
  try {
    const newEntries = await memoryService.extractMemories(
      character.id,
      userMessage,
      assistantResponse
    );

    if (newEntries.length > 0) {
      // Show notification only if this message is still in the DOM
      if (msgElement.isConnected) {
        const notification = document.createElement('div');
        notification.className = 'memory-notification';
        notification.innerHTML = `
          <span class="memory-icon">📝</span>
          <span>${newEntries.length} memor${newEntries.length === 1 ? 'y' : 'ies'} saved</span>
        `;
        msgElement.querySelector('.message-body').appendChild(notification);
        scrollToBottom();
      }

      // Refresh memory panel if it belongs to the current character
      if (appState.currentCharacter?.id === character.id) {
        const event = new CustomEvent('memory-updated', {
          detail: { characterId: character.id },
        });
        window.dispatchEvent(event);
      }
    }
  } catch (e) {
    console.warn('Memory extraction background error:', e);
  }
}

// ─── Calculate Summary Needs Based on 70% Context Usage ──────────────

export function calculateSummaryNeeds(session, maxContext, fullContextTokens, unsummarizedMessages = []) {
  const settings = settingsStore.get();
  const chunkSize = settings.summary_chunk_size || 10;
  const summaryLength = settings.summary_length || 'default';
  const KEEP_LAST = 6;
  const doneCount = session.summaryChunks ? session.summaryChunks.length : 0;

  if (!session || !session.messages || session.messages.length === 0) {
    return { doneCount, totalNeeded: doneCount, needsMore: false, targetLimit: Math.round(0.70 * maxContext) };
  }

  const targetLimit = 0.70 * maxContext;

  // If full unsummarized context is ALREADY <= 70% of maxContext, no extra summaries needed!
  if (fullContextTokens <= targetLimit) {
    return { doneCount, totalNeeded: doneCount, needsMore: false, targetLimit: Math.round(targetLimit) };
  }

  // Calculate how many summary chunks are required to bring fullContextTokens <= 70%
  let simulatedTokens = fullContextTokens;
  let additionalChunks = 0;
  let currIdx = 0;
  const maxEndIdx = Math.max(0, unsummarizedMessages.length - KEEP_LAST);

  const estSummaryTokens = summaryLength === 'short' ? 120 : (summaryLength === 'long' ? 350 : 200);

  while (simulatedTokens > targetLimit && currIdx < maxEndIdx) {
    const endIdx = Math.min(currIdx + chunkSize, maxEndIdx);
    const batch = unsummarizedMessages.slice(currIdx, endIdx);
    if (batch.length === 0) break;

    // Calculate raw tokens of this batch of messages
    let batchRawTokens = 0;
    for (const m of batch) {
      const text = m.role === 'user' ? (m.translated_content || m.content) : (m.original_text || m.content);
      const msgKey = `msg_${m.id}_${(text || '').length}`;
      const cached = tokenCountCache.get(msgKey);
      batchRawTokens += (cached ? cached.value : Math.ceil((text || '').length / 3.3)) + 4;
    }

    // Token reduction for creating this summary chunk
    const netSavings = batchRawTokens - estSummaryTokens;
    if (netSavings <= 0) {
      // Summarizing doesn't save tokens, stop loop
      break;
    }

    simulatedTokens -= netSavings;
    additionalChunks++;
    currIdx = endIdx;
  }

  const totalNeeded = doneCount + additionalChunks;
  return {
    doneCount,
    totalNeeded,
    needsMore: doneCount < totalNeeded,
    targetLimit: Math.round(targetLimit)
  };
}

// ─── Build API Messages ─────────────────────────────────────────────

// ─── Compute Context And Trim History (Sliding Window) ──────────────

async function computeContextAndTrimHistory(character, session, signal = null) {
  const settings = settingsStore.get();
  const userName = session.user_name || settings.user_name || 'User';
  const personaId = session.persona_id || settings.active_persona_id || 'default';
  const activePersona = (settings.personas || []).find(p => p.id === personaId);

  // 1. Get max context length
  const maxContext = await api.getMaxContextLength();

  // 2. Count tokens for Character Card (description + personality + scenario)
  const charData = {
    description: character.description || '',
    personality: character.personality ? `Personality: ${character.personality}` : '',
    scenario: character.scenario ? `Scenario: ${character.scenario}` : ''
  };
  const charText = [charData.description, charData.personality, charData.scenario].filter(Boolean).join('\n\n') || `You are ${character.name}.`;

  const charKey = `char_${character.id}_${charText.length}`;
  let charTokensObj = tokenCountCache.get(charKey);
  if (charTokensObj === undefined) {
    charTokensObj = await api.countTokensDetailed(charText, signal);
    tokenCountCache.set(charKey, charTokensObj);
  }
  const charTokens = charTokensObj.value;

  // 3. Count tokens for Memory Context
  const memoryText = memoryService.getMemoryContext(character.id) || '';
  const memoryKey = `mem_${character.id}_${memoryText.length}`;
  let memoryTokensObj = tokenCountCache.get(memoryKey);
  if (memoryTokensObj === undefined) {
    if (memoryText) {
      memoryTokensObj = await api.countTokensDetailed(memoryText, signal);
    } else {
      memoryTokensObj = { value: 0, precise: true };
    }
    tokenCountCache.set(memoryKey, memoryTokensObj);
  }
  const memoryTokens = memoryTokensObj.value;

  // 4. Count tokens for System Prompt (Preset instructions, replaced placeholders, user persona, formatting, indicators)
  let systemBasePure = '';
  if (character.system_prompt) {
    systemBasePure = character.system_prompt;
    // Replace placeholders with empty string to avoid double counting with Character Card tokens
    systemBasePure = systemBasePure.replace(/\{\{description\}\}/gi, '');
    systemBasePure = systemBasePure.replace(/\{\{personality\}\}/gi, '');
    systemBasePure = systemBasePure.replace(/\{\{scenario\}\}/gi, '');
  } else {
    const activePresetId = settings.active_system_prompt_preset_id;
    const presets = settings.system_prompt_presets || [];
    const activePreset = presets.find(p => p.id === activePresetId);

    if (activePreset) {
      systemBasePure = activePreset.content;
      systemBasePure = systemBasePure.replace(/\{\{description\}\}/gi, '');
      systemBasePure = systemBasePure.replace(/\{\{personality\}\}/gi, '');
      systemBasePure = systemBasePure.replace(/\{\{scenario\}\}/gi, '');
    }
  }

  const exMode = settings.example_messages_mode || 'chat';
  let exampleChatMsgs = [];
  let exampleSystemText = '';

  if (character.message_examples && character.message_examples.trim() && exMode !== 'off') {
    const parsedEx = parseMessageExamples(character.message_examples, userName, character.name);
    if (exMode === 'chat') {
      exampleChatMsgs = parsedEx.messages;
    } else if (exMode === 'system') {
      exampleSystemText = parsedEx.formattedSystemText;
    }
  }

  if (exampleSystemText) {
    systemBasePure += `\n\n${exampleSystemText}`;
  }

  systemBasePure = systemBasePure.replace(/\{\{user\}\}/gi, userName);
  systemBasePure = systemBasePure.replace(/\{\{char\}\}/gi, character.name);

  let systemContentPure = systemBasePure;
  if (activePersona && activePersona.description) {
    let personaStr = activePersona.description.replace(/\{\{user\}\}/gi, userName).replace(/\{\{char\}\}/gi, character.name);
    systemContentPure += `\n\n[USER PERSONA]\nThe user's persona is as follows. Treat the user as this persona:\n${personaStr}`;
  }

  if (settingsStore.get().namegen_enabled) {
    systemContentPure += `\n\n[NAME GENERATOR ACTIVE]\nIf the plot or the user's request requires introducing a new character, YOU MUST first call the name generator tool. To do this, you must output a JSON command specifying the gender and whether to use popular names only:\n{"genai_action":"generate_name", "gender": "boy" | "girl" | "neutral", "popular_only": true | false}\nOutput this on a new line and continue writing.`;
  }

  const formattingInstructions = [];
  if (settings.response_length === 'short') {
    formattingInstructions.push("Write extremely short, brief, and concise responses. Limit yourself to 1-2 sentences maximum. No fluff.");
  } else if (settings.response_length === 'medium') {
    formattingInstructions.push("Write balanced, moderately detailed responses. Strictly limit your response to about 650 characters (letters and spaces) maximum.");
  } else if (settings.response_length === 'long') {
    formattingInstructions.push("Write very long, detailed, and expansive responses. Elaborate on everything and be as verbose as possible.");
  }

  if (settings.description_depth > 0) {
    const depthPrompts = [
      "",
      "Add brief descriptions of the scene.",
      "Include vivid and clear descriptions of the environment and atmosphere.",
      "Provide highly detailed and immersive scene descriptions with sensory details.",
      "Describe every scene with extreme detail and atmosphere, focusing on deep sensory information, textures, sounds, and intense character introspection. Be extremely descriptive."
    ];
    formattingInstructions.push(depthPrompts[settings.description_depth]);
  }

  if (formattingInstructions.length > 0) {
    systemContentPure += `\n\n[MANDATORY FORMATTING RULES]\n${formattingInstructions.join("\n")}`;
  }

  if (session.indicators?.enabled && session.indicators.list?.length > 0) {
    const statusStr = session.indicators.list.map(ind => `${ind.name}: ${ind.value}%`).join('\n');
    systemContentPure += `\n\n[CURRENT MOOD STATUS]\n${statusStr}`;
  }

  const systemKey = `sys_${character.id}_${session.id}_${systemContentPure.length}`;
  let systemTokensObj = tokenCountCache.get(systemKey);
  if (systemTokensObj === undefined) {
    systemTokensObj = await api.countTokensDetailed(systemContentPure, signal);
    tokenCountCache.set(systemKey, systemTokensObj);
  }
  const systemTokens = systemTokensObj.value;

  // 5. Count tokens for Summary Chunks + pinned first 3 messages
  const KEEP_FIRST = 3;
  const summaryChunks = session.summaryChunks || [];
  const injectionMode = settings.summary_injection_mode || 'system';

  let summaryText = "";
  if (summaryChunks.length > 0 && injectionMode === 'system') {
    const lines = summaryChunks.map((c, idx) => `Event ${idx + 1}: ${c.text}`);
    summaryText = `[Chat Summary]\n${lines.join('\n\n')}`;
  }

  // Count tokens for summary chunks
  let summaryTokens = 0;
  let summaryTokensPrecise = true;
  if (summaryChunks.length > 0) {
    if (injectionMode === 'system') {
      const chunkKey = `summary_sys_${session.id}_${summaryText.length}`;
      let tokenObj = tokenCountCache.get(chunkKey);
      if (tokenObj === undefined) {
        tokenObj = await api.countTokensDetailed(`\n\n${summaryText}`, signal);
        tokenCountCache.set(chunkKey, tokenObj);
      }
      summaryTokens = tokenObj.value;
      if (!tokenObj.precise) summaryTokensPrecise = false;
    } else {
      for (let idx = 0; idx < summaryChunks.length; idx++) {
        const chunk = summaryChunks[idx];
        const chunkContent = `[Chat Summary - Event ${idx + 1}:\n${chunk.text}]`;
        const chunkKey = `chunk_hist_${chunk.id}_${chunk.text.length}`;
        let chunkTokensObj = tokenCountCache.get(chunkKey);
        if (chunkTokensObj === undefined) {
          chunkTokensObj = await api.countTokensDetailed(chunkContent, signal);
          tokenCountCache.set(chunkKey, chunkTokensObj);
        }
        summaryTokens += chunkTokensObj.value + 4;
        if (!chunkTokensObj.precise) summaryTokensPrecise = false;
      }
    }
  }
  const summaryTokensObj = { value: summaryTokens, precise: summaryTokensPrecise };

  // Count tokens for pinned first 3 messages
  const pinnedMessages = session.messages.slice(0, KEEP_FIRST).filter(
    m => m.role !== 'system' && (m.role !== 'assistant' || m.content)
  );
  let pinnedTokens = 0;
  let pinnedTokensPrecise = true;
  for (const msg of pinnedMessages) {
    const contentText = msg.role === 'user' ? (msg.translated_content || msg.content) : (msg.original_text || msg.content);
    const msgKey = `msg_${msg.id}_${contentText.length}`;
    let tokenObj = tokenCountCache.get(msgKey);
    if (tokenObj === undefined) {
      tokenObj = await api.countTokensDetailed(contentText, signal);
      tokenCountCache.set(msgKey, tokenObj);
    }
    pinnedTokens += tokenObj.value + 4;
    if (!tokenObj.precise) pinnedTokensPrecise = false;
  }

  // 6. Sliding Window Calculation
  const maxTokensSetting = settings.max_tokens || 2048;
  const safetyBuffer = 100;
  const basePromptTokens = charTokens + systemTokens + memoryTokens + summaryTokens + pinnedTokens;
  const totalPromptBudget = maxContext - maxTokensSetting - safetyBuffer;

  // Determine sliding window start: after last chunk's endMsgId, or from index KEEP_FIRST
  let historyStartIdx = KEEP_FIRST;
  if (summaryChunks.length > 0) {
    const lastChunk = summaryChunks[summaryChunks.length - 1];
    const idx = session.messages.findIndex(m => m.id === lastChunk.endMsgId);
    if (idx !== -1) {
      historyStartIdx = idx + 1;
    }
  }

  // Filter messages for sliding window (messages after summaries, excluding pinned first 3)
  const messagesToCount = session.messages.slice(historyStartIdx);

  const messagesMeta = [];
  for (const msg of messagesToCount) {
    if (msg.role === 'system') continue;
    if (msg.role === 'assistant' && !msg.content) continue;

    const contentText = msg.role === 'user' ? (msg.translated_content || msg.content) : (msg.original_text || msg.content);
    const msgKey = `msg_${msg.id}_${contentText.length}`;
    messagesMeta.push({ msg, contentText, msgKey });
  }

  // Count uncached messages (concurrency limit = 4)
  const uncachedList = messagesMeta.filter(item => tokenCountCache.get(item.msgKey) === undefined);
  const batchSize = 4;
  for (let i = 0; i < uncachedList.length; i += batchSize) {
    const batch = uncachedList.slice(i, i + batchSize);
    await Promise.all(batch.map(async (item) => {
      const res = await api.countTokensDetailed(item.contentText, signal);
      tokenCountCache.set(item.msgKey, res);
    }));
  }

  // Go backward to fit within budget (estimate first using local token counts)
  let estimatedHistoryTokens = 0;
  const trimmedMessages = [];
  const estimatedBudget = maxContext - maxTokensSetting - 15; // Leave at least 15 tokens free

  for (let i = messagesMeta.length - 1; i >= 0; i--) {
    const item = messagesMeta[i];
    const cachedItem = tokenCountCache.get(item.msgKey);
    const tokens = cachedItem ? cachedItem.value : 0;
    const tokensWithOverhead = tokens + 4; // Add message wrapper overhead (~4 tokens)

    const isLastMessage = (i === messagesMeta.length - 1);
    if (isLastMessage || (basePromptTokens + estimatedHistoryTokens + tokensWithOverhead <= estimatedBudget)) {
      estimatedHistoryTokens += tokensWithOverhead;
      trimmedMessages.unshift(item.msg);
    } else {
      break;
    }
  }

  // Construct the exact messages array template to count exact tokens on the server
  const buildTestMessages = (trimmed) => {
    const msgs = [];
    let systemPromptContent = [charText, systemContentPure, memoryText].filter(Boolean).join('\n\n');
    if (injectionMode === 'system' && summaryText) {
      systemPromptContent += `\n\n${summaryText}`;
    }
    msgs.push({ role: 'system', content: systemPromptContent });

    // Insert separate example chat messages if in 'chat' mode
    for (const exMsg of exampleChatMsgs) {
      msgs.push({ role: exMsg.role, content: exMsg.content });
    }

    // Insert pinned first 3 messages
    for (const msg of pinnedMessages) {
      const contentText = msg.role === 'user' ? (msg.translated_content || msg.content) : (msg.original_text || msg.content);
      msgs.push({ role: msg.role, content: contentText });
    }

    if (injectionMode === 'history' && summaryChunks.length > 0) {
      for (let idx = 0; idx < summaryChunks.length; idx++) {
        msgs.push({ role: 'system', content: `[Chat Summary - Event ${idx + 1}:\n${summaryChunks[idx].text}]` });
      }
    }

    for (const msg of trimmed) {
      const contentText = msg.role === 'user' ? (msg.translated_content || msg.content) : (msg.original_text || msg.content);
      msgs.push({ role: msg.role, content: contentText });
    }
    return msgs;
  };

  // Call the precise token counting endpoint on the constructed message list
  let testMsgs = buildTestMessages(trimmedMessages);
  let exactTokensObj = await api.countMessagesTokensDetailed(testMsgs, signal);

  // Prune further if the server token count exceeds the limit (leaving 15 tokens free)
  while (exactTokensObj.value > maxContext - maxTokensSetting - 15 && trimmedMessages.length > 0) {
    trimmedMessages.shift(); // Remove the oldest message
    testMsgs = buildTestMessages(trimmedMessages);
    exactTokensObj = await api.countMessagesTokensDetailed(testMsgs, signal);
  }

  // Calculate tokens of ALL unsummarized history messages
  let fullHistoryTokens = 0;
  for (const item of messagesMeta) {
    const cachedItem = tokenCountCache.get(item.msgKey);
    const tokens = cachedItem ? cachedItem.value : 0;
    fullHistoryTokens += tokens + 4;
  }
  const fullContextTokens = basePromptTokens + fullHistoryTokens;

  const historyItems = trimmedMessages.map(msg => {
    const contentText = msg.role === 'user' ? (msg.translated_content || msg.content) : (msg.original_text || msg.content);
    const cachedItem = tokenCountCache.get(`msg_${msg.id}_${contentText.length}`);
    const tokens = cachedItem ? cachedItem.value : 0;
    return {
      role: msg.role,
      text: contentText,
      tokens: tokens
    };
  });

  const allPrecise = charTokensObj.precise &&
                     memoryTokensObj.precise &&
                     systemTokensObj.precise &&
                     summaryTokensObj.precise &&
                     pinnedTokensPrecise &&
                     trimmedMessages.every(msg => {
                       const contentText = msg.role === 'user' ? (msg.translated_content || msg.content) : (msg.original_text || msg.content);
                       const cachedItem = tokenCountCache.get(`msg_${msg.id}_${contentText.length}`);
                       return cachedItem ? cachedItem.precise : false;
                     }) &&
                     exactTokensObj.precise;

  return {
    maxContext,
    charTokens,
    charText,
    systemTokens,
    systemText: systemContentPure,
    memoryTokens,
    memoryText,
    summaryTokens,
    summaryChunks,
    pinnedMessages,
    fullHistoryTokens,
    fullContextTokens,
    historyTokens: exactTokensObj.value - basePromptTokens,
    historyItems,
    trimmedMessages,
    unsummarizedMessages: messagesMeta.map(m => m.msg),
    baseTokens: exactTokensObj.value,
    precise: allPrecise
  };
}

// ─── Build API Messages ─────────────────────────────────────────────

async function buildApiMessages(character, session) {
  if (!character || !session) return [];

  const result = await computeContextAndTrimHistory(character, session);
  const settings = settingsStore.get();
  const userName = session.user_name || settings.user_name || 'User';

  const messages = [];

  // Re-build systemContent with appropriate replacements and memory injection
  let systemContent = '';
  const charData = {
    description: character.description || '',
    personality: character.personality ? `Personality: ${character.personality}` : '',
    scenario: character.scenario ? `Scenario: ${character.scenario}` : ''
  };

  if (character.system_prompt) {
    systemContent = character.system_prompt;

    // Check if any standard placeholders are used
    const hasPlaceholders = /\{\{description\}\}/gi.test(systemContent) ||
      /\{\{personality\}\}/gi.test(systemContent) ||
      /\{\{scenario\}\}/gi.test(systemContent);

    // Replace placeholders
    systemContent = systemContent.replace(/\{\{description\}\}/gi, charData.description);
    systemContent = systemContent.replace(/\{\{personality\}\}/gi, charData.personality);
    systemContent = systemContent.replace(/\{\{scenario\}\}/gi, charData.scenario);

    // If no placeholders were used, prepend character info automatically to ensure context
    if (!hasPlaceholders) {
      const parts = [charData.description, charData.personality, charData.scenario].filter(Boolean);
      if (parts.length > 0) {
        systemContent = parts.join('\n\n') + '\n\n' + systemContent;
      }
    }
  } else {
    // Use active preset if available, otherwise build from fields
    const activePresetId = settings.active_system_prompt_preset_id;
    const presets = settings.system_prompt_presets || [];
    const activePreset = presets.find(p => p.id === activePresetId);

    if (activePreset) {
      systemContent = activePreset.content;

      // Check if any standard placeholders are used
      const hasPlaceholders = /\{\{description\}\}/gi.test(systemContent) ||
        /\{\{personality\}\}/gi.test(systemContent) ||
        /\{\{scenario\}\}/gi.test(systemContent);

      // Replace placeholders
      systemContent = systemContent.replace(/\{\{description\}\}/gi, charData.description);
      systemContent = systemContent.replace(/\{\{personality\}\}/gi, charData.personality);
      systemContent = systemContent.replace(/\{\{scenario\}\}/gi, charData.scenario);

      // If no placeholders were used, prepend character info automatically to ensure context
      if (!hasPlaceholders) {
        const parts = [charData.description, charData.personality, charData.scenario].filter(Boolean);
        if (parts.length > 0) {
          systemContent = parts.join('\n\n') + '\n\n' + systemContent;
        }
      }
    } else {
      // Fallback to building from fields
      const parts = [charData.description, charData.personality, charData.scenario].filter(Boolean);
      systemContent = parts.join('\n\n') || `You are ${character.name}.`;
    }
  }

  const exMode = settings.example_messages_mode || 'chat';
  let exampleChatMsgs = [];
  let exampleSystemText = '';

  if (character.message_examples && character.message_examples.trim() && exMode !== 'off') {
    const parsedEx = parseMessageExamples(character.message_examples, userName, character.name);
    if (exMode === 'chat') {
      exampleChatMsgs = parsedEx.messages;
    } else if (exMode === 'system') {
      exampleSystemText = parsedEx.formattedSystemText;
    }
  }

  if (exampleSystemText) {
    systemContent += `\n\n${exampleSystemText}`;
  }

  // Replace placeholders
  systemContent = systemContent.replace(/\{\{user\}\}/gi, userName);
  systemContent = systemContent.replace(/\{\{char\}\}/gi, character.name);

  // Inject memory context
  const memoryContext = memoryService.getMemoryContext(character.id);
  if (memoryContext) {
    systemContent += memoryContext;
  }

  const personaId = session.persona_id || settings.active_persona_id || 'default';
  const personas = settings.personas || [];
  const activePersona = personas.find(p => p.id === personaId);

  // Inject persona description if active
  if (activePersona && activePersona.description) {
    let personaStr = activePersona.description.replace(/\{\{user\}\}/gi, userName).replace(/\{\{char\}\}/gi, character.name);
    systemContent += `\n\n[USER PERSONA]\nThe user's persona is as follows. Treat the user as this persona:\n${personaStr}`;
  }

  // Add formatting instructions based on settings
  const formattingInstructions = [];

  // Response Length
  if (settings.response_length === 'short') {
    formattingInstructions.push("Write extremely short, brief, and concise responses. Limit yourself to 1-2 sentences maximum. No fluff.");
  } else if (settings.response_length === 'medium') {
    formattingInstructions.push("Write balanced, moderately detailed responses. Strictly limit your response to about 650 characters (letters and spaces) maximum.");
  } else if (settings.response_length === 'long') {
    formattingInstructions.push("Write very long, detailed, and expansive responses. Elaborate on everything and be as verbose as possible.");
  }

  // Description Depth
  if (settings.description_depth > 0) {
    const depthPrompts = [
      "",
      "Add brief descriptions of the scene.",
      "Include vivid and clear descriptions of the environment and atmosphere.",
      "Provide highly detailed and immersive scene descriptions with sensory details.",
      "Describe every scene with extreme detail and atmosphere, focusing on deep sensory information, textures, sounds, and intense character introspection. Be extremely descriptive."
    ];
    formattingInstructions.push(depthPrompts[settings.description_depth]);
  }

  if (formattingInstructions.length > 0) {
    systemContent += `\n\n[MANDATORY FORMATTING RULES]\n${formattingInstructions.join("\n")}`;
  }

  // Inject mood indicators if enabled
  if (session.indicators?.enabled && session.indicators.list?.length > 0) {
    const statusStr = session.indicators.list.map(ind => `${ind.name}: ${ind.value}%`).join('\n');
    systemContent += `\n\n[CURRENT MOOD STATUS]\n${statusStr}`;
  }

  // Apply Gemma 4 thinking style directive if experimental toggle is enabled and reasoning effort is Lite (medium)
  if (settings.change_gemma4_thinking_style && settings.reasoning_effort === 'medium') {
    systemContent += `\n\nCORE INSTRUCTION:
Before answering, you must use your internal monologue channel.
1. When you enter the <|channel|>thought channel, think in the first person ("I"). Think like a curious, analytical researcher. 
2. Do NOT use bullet points or asterisks (*) for every line. Write in natural, cohesive paragraphs.
3. Structure your logic, verify assumptions, and prepare the response.
4. After closing the thought channel with <channel|>, provide your final response.
5. Think extremely concise and briefly.`;
  }

  const injectionMode = settings.summary_injection_mode || 'system';

  // Append summary chunks directly to the end of main system message if in system mode
  if (injectionMode === 'system' && result.summaryChunks && result.summaryChunks.length > 0) {
    const lines = result.summaryChunks.map((c, idx) => `Event ${idx + 1}: ${c.text}`);
    systemContent += `\n\n[Chat Summary]\n${lines.join('\n\n')}`;
  }

  // Prepend <|think|> for Gemma 4 thinking models when reasoning effort is active and Google's thinking preset is enabled
  if (settings.gemma4_support && settings.gemma4_google_thinking_preset && settings.reasoning_effort && settings.reasoning_effort !== 'none') {
    systemContent = '<|think|>\n' + systemContent;
  }

  messages.push({ role: 'system', content: systemContent });

  // Inject separate example chat messages if in 'chat' mode
  for (const exMsg of exampleChatMsgs) {
    messages.push({ role: exMsg.role, content: exMsg.content });
  }

  // ─── LOREBOOK INJECTION ───────────────────────────────────────────
  try {
    const activeSessionId = (typeof chatStore !== 'undefined' && chatStore.getCurrentSession()) ? chatStore.getCurrentSession().id : 'default';
    const savedState = await idbGet(`llmchat_active_lorebooks_${activeSessionId}`);
    const activeLorebookState = savedState ? JSON.parse(savedState) : {};
    const allLorebooks = typeof lorebookStore !== 'undefined' ? lorebookStore.getAll() : [];
    const activeBooks = allLorebooks.filter(b => activeLorebookState[b.id]);
    
    if (activeBooks.length > 0 && result.trimmedMessages) {
      // Scan the last few messages for keywords
      const recentMessages = result.trimmedMessages.slice(-3);
      const textToScan = recentMessages.map(m => m.role === 'user' ? (m.translated_content || m.content) : (m.original_text || m.content)).join('\n');
      
      const matchedEntries = lorebookStore.scanText(textToScan, activeBooks);
      if (matchedEntries.length > 0) {
        console.log(`[Lorebooks] Activated ${matchedEntries.length} entries.`);
        const lorebookText = matchedEntries.map(e => e.content).join('\n\n');
        messages.push({ role: 'system', content: `[World Info / Lorebook Context]\n${lorebookText}` });
      }
    }
  } catch (e) {
    console.error('Failed to inject Lorebooks', e);
  }

  // Inject pinned first 3 messages (always present, before summaries)
  for (const msg of result.pinnedMessages) {
    const content = msg.role === 'user' ? (msg.translated_content || msg.content) : (msg.original_text || msg.content);
    messages.push({ role: msg.role, content: content });
  }

  // Inject summary chunks in history if mode is 'history'
  if (injectionMode === 'history' && result.summaryChunks && result.summaryChunks.length > 0) {
    for (let idx = 0; idx < result.summaryChunks.length; idx++) {
      const chunk = result.summaryChunks[idx];
      messages.push({ role: 'system', content: `[Chat Summary - Event ${idx + 1}:\n${chunk.text}]` });
    }
  }

  // Append trimmed messages (sliding window after last chunk)
  for (const msg of result.trimmedMessages) {
    const content = msg.role === 'user' ? (msg.translated_content || msg.content) : (msg.original_text || msg.content);
    messages.push({ role: msg.role, content: content });
  }

  // FORCE REASONING PREFILL
  if (settings.force_reasoning && settings.reasoning_tag_open && (settings.reasoning_effort || 'none') !== 'none') {
    messages.push({ role: 'assistant', content: settings.reasoning_tag_open });
  } else if (settings.gemma4_support && (!settings.reasoning_effort || settings.reasoning_effort === 'none')) {
    let openTag = settings.reasoning_tag_open || '<|think|>';
    let closeTag = settings.reasoning_tag_close || '</|think|>';
    if (settings.change_gemma4_thinking_style) {
      openTag = '<|channel|>thought';
      closeTag = '<channel|>';
    }
    messages.push({ role: 'assistant', content: `${openTag}\n${closeTag}` });
  }

  return messages;
}

// ─── Stop Generation ────────────────────────────────────────────────

function stopGeneration() {
  if (appState.abortController) {
    appState.abortController.abort();
  }
}

// ─── DOM Helpers ────────────────────────────────────────────────────

function clearMessages() {
  messagesContainer.innerHTML = '';
  emptyState = null;
}

function appendMessage(msg, isStreaming = false, character = null) {
  const settings = settingsStore.get();
  // Remove empty state if present
  const empty = messagesContainer.querySelector('.empty-state');
  if (empty) empty.remove();

  const el = document.createElement('div');
  el.className = `message ${msg.role} message-enter`;
  el.dataset.messageId = msg.id;

  const isUser = msg.role === 'user';
  // Use passed character or fallback to global (not ideal but safe for non-leaking cases)
  const char = character || appState.currentCharacter;

  let avatarHtml;
  if (isUser) {
    avatarHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
    </svg>`;
  } else if (char?.avatar) {
    avatarHtml = `<img src="${char.avatar}" alt="${escapeHtml(char.name)}">`;
  } else {
    avatarHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
    </svg>`;
  }

  let contentHtml = '';
  let msgThinking = msg.thinking;
  let msgContent = (msg.translated_content && !msg.show_original) ? msg.translated_content : msg.content;

  // Auto-recovery: if the message has no thinking block saved, but the content contains tags, parse them!
  if (!msgThinking && msgContent && /<(?:think|thought|reasoning|\|channel>thought)/i.test(msgContent)) {
    const parsed = parseThinking(msgContent, settings.reasoning_tag_open, settings.reasoning_tag_close);
    if (parsed.thinking) {
      msgThinking = parsed.thinking;
      msgContent = parsed.content;
    }
  }

  if (msgThinking) {
    contentHtml += createThinkingBlockHTML(msgThinking, false, settings.glm47_support, msg.thinking_time || 0, settings.reasoning_effort);
  }

  const cleanedContent = stripJsonBlocks(msgContent, isStreaming);
  let formatted = renderMarkdown(cleanedContent);
  formatted = processCharacterMentions(formatted);
  contentHtml += formatted;

  // Swipe Greetings UI for the first message
  const isFirstMessage = appState.currentChat?.messages?.[0]?.id === msg.id;
  const greetings = char?.alternate_greetings || [];
  const hasAltGreetings = greetings.length > 0;
  const currentIdx = appState.currentChat?.selected_greeting_index || 0;
  const totalGreetings = greetings.length + 1;

  const swipeHtml = (isFirstMessage && hasAltGreetings) ? `
    <div class="swipe-greetings">
      <button class="btn-swipe btn-swipe-left" title="Previous Greeting">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="swipe-index">${currentIdx + 1} / ${totalGreetings}</span>
      <button class="btn-swipe btn-swipe-right" title="Next Greeting">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  ` : '';

  el.innerHTML = `
    <div class="message-avatar">${avatarHtml}</div>
    <div class="message-body">
      <div class="message-content">
        <div class="message-text">${contentHtml || (isStreaming ? '<span class="streaming-cursor"></span>' : '')}</div>
      </div>
      ${swipeHtml}
      <div class="message-meta">
        <span class="message-time">${formatTime(msg.timestamp)}</span>
        <div class="message-actions">
          <button class="btn-regenerate hidden" title="Regenerate">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
          </button>
          <button class="btn-edit-msg" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn-translate-msg" title="Translate">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              <text x="12" y="15" font-family="sans-serif" font-size="10" font-weight="bold" text-anchor="middle" stroke="none" fill="currentColor">あ</text>
            </svg>
          </button>
          <button class="btn-copy" title="Copy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button class="btn-ai-comment" title="AI Comment">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
              <path d="M12 7l1.5 3 3.5.5-2.5 2.5.5 3.5-3-1.5-3 1.5.5-3.5-2.5-2.5 3.5-.5z"/>
            </svg>
          </button>
          ${isUser ? '' : `
          <button class="btn-illustrate-msg" title="Generate Illustration">
            <svg viewBox="0 0 512 512" fill="currentColor" style="width: 14px; height: 14px;">
              <g transform="translate(0.000000,512.000000) scale(0.100000,-0.100000)">
                <path d="M4903 4956 c-305 -96 -1216 -820 -2401 -1909 l-292 -269 79 -87 c44 -47 212 -217 373 -378 l293 -291 140 155 c835 927 1486 1719 1807 2198 157 234 229 397 214 479 -9 48 -49 93 -94 106 -47 13 -67 12 -119 -4z"/>
                <path d="M1830 2414 c-107 -104 -195 -192 -195 -195 0 -3 173 -181 384 -395 l383 -389 129 135 c71 74 156 164 188 200 l59 65 -377 384 -377 384 -194 -189z"/>
                <path d="M1320 2019 c-344 -73 -553 -224 -685 -494 -59 -119 -90 -222 -136 -440 -93 -441 -157 -541 -369 -576 -39 -7 -82 -20 -95 -31 -52 -41 -39 -125 25 -158 60 -31 288 -97 426 -124 490 -95 935 -24 1229 198 238 179 415 463 491 788 l18 78 -385 387 c-221 223 -392 389 -404 390 -11 1 -63 -7 -115 -18z"/>
              </g>
            </svg>
          </button>
          `}
          <button class="btn-delete-msg delete" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;

  // Translate button
  el.querySelector('.btn-translate-msg')?.addEventListener('click', async () => {
    const settings = settingsStore.get();
    const contentEl = el.querySelector('.message-text');
    const target = msg.role === 'user' ? (settings.outgoing_target_language || 'English') : (settings.target_language || 'Russian');

    // If already translated, toggle between original and translated
    if (msg.translated_content) {
      msg.show_original = !msg.show_original;
      chatStore.updateMessage(msg.id, { show_original: msg.show_original });
      await chatStore.saveCurrentSession();

      const newDisplayContent = msg.show_original ? msg.content : msg.translated_content;

      // Update UI with a nice effect
      contentEl.classList.add('block-replacing-out');
      setTimeout(() => {
        let html = '';
        if (msg.thinking) html += createThinkingBlockHTML(msg.thinking, false, settings.glm47_support, msg.thinking_time || 0, settings.reasoning_effort);
        const cleaned = stripJsonBlocks(newDisplayContent, false);
        let formatted = renderMarkdown(cleaned);
        formatted = processCharacterMentions(formatted);
        html += formatted;
        contentEl.innerHTML = html;
        contentEl.classList.remove('block-replacing-out');
        contentEl.classList.add('block-replacing-in');
        setTimeout(() => contentEl.classList.remove('block-replacing-in'), 400);
      }, 300);
      return;
    }

    headerCharStatus.textContent = 'Translating message...';
    headerCharStatus.classList.add('generating');

    // Ensure spans exist for the replacement effect
    if (!contentEl.querySelector('.word-blur')) {
      const displayContent = (msg.translated_content && !msg.show_original) ? msg.translated_content : msg.content;
      const cleaned = stripJsonBlocks(displayContent, false);
      let formatted = renderMarkdown(cleaned);
      formatted = processCharacterMentions(formatted);
      contentEl.innerHTML = wrapWordsInSpans(formatted);
    }

    const translated = await performStreamingTranslation(contentEl, msg.content, target);
    if (translated) {
      chatStore.updateMessage(msg.id, { translated_content: translated, show_original: false });
      await chatStore.saveSession(appState.currentChat);
    }

    headerCharStatus.textContent = 'Ready';
    headerCharStatus.classList.remove('generating');
  });

  // Copy button
  el.querySelector('.btn-copy')?.addEventListener('click', () => {
    const copyContent = (msg.translated_content && !msg.show_original) ? msg.translated_content : msg.content;
    navigator.clipboard.writeText(copyContent);
    showToast('Copied to clipboard');
  });

  // Delete button
  el.querySelector('.btn-delete-msg')?.addEventListener('click', () => {
    chatStore.deleteMessage(msg.id);
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => el.remove(), 300);
    chatStore.saveCurrentSession();
    updateRegenerateVisibility();
    updateContextIndicator();

    // Abort suggestions generation if any
    if (appState.suggestionsAbortController) {
      appState.suggestionsAbortController.abort();
      appState.suggestionsAbortController = null;
    }

    // Clear visible suggestions if they were for this message or because list changed
    const options = messagesContainer.querySelectorAll('.continuation-options');
    options.forEach(opt => opt.remove());
  });

  // Edit button
  el.querySelector('.btn-edit-msg')?.addEventListener('click', () => {
    enterEditMode(msg, el);
  });

  // AI Comment button
  el.querySelector('.btn-ai-comment')?.addEventListener('click', () => {
    requestAiComment(msg, character || appState.currentCharacter);
  });

  // Paintbrush (manual illustration) button
  el.querySelector('.btn-illustrate-msg')?.addEventListener('click', () => {
    const character = appState.currentCharacter;
    const session = appState.currentChat;
    if (!character || !session) {
      showToast('Please select a character first', 'error');
      return;
    }

    const freshSettings = settingsStore.get();
    if (!freshSettings.comfyui_enabled) {
      showToast('ComfyUI is disabled in settings', 'warning');
      return;
    }

    showToast('Starting manual image generation...', 'success');
    
    // Trigger standard automatic generation flow targeting this message
    triggerAutomaticImageGeneration(character, session, msg.content, msg);
  });

  // Swipe listeners
  if (isFirstMessage && hasAltGreetings) {
    el.querySelector('.btn-swipe-left')?.addEventListener('click', () => swipeGreeting(msg.id, -1));
    el.querySelector('.btn-swipe-right')?.addEventListener('click', () => swipeGreeting(msg.id, 1));
  }

  // Regenerate button
  const btnRegen = el.querySelector('.btn-regenerate');
  btnRegen?.addEventListener('click', () => {
    regenerateResponse(msg, el);
  });

  messagesContainer.appendChild(el);
  updateRegenerateVisibility();
  scrollToBottom();

  // Render continuation options if they exist
  if (msg.options && msg.options.length > 0) {
    renderContinuationOptions(el, msg.options);
  }

  return el;
}

async function swipeGreeting(messageId, direction) {
  if (!appState.currentChat || appState.isGenerating) return;
  const char = appState.currentCharacter;
  if (!char) return;

  const greetings = [char.first_message, ...(char.alternate_greetings || [])];
  if (greetings.length <= 1) return;

  let currentIdx = appState.currentChat.selected_greeting_index || 0;
  currentIdx = (currentIdx + direction + greetings.length) % greetings.length;
  appState.currentChat.selected_greeting_index = currentIdx;

  const newContent = greetings[currentIdx];
  const settings = settingsStore.get();
  const userName = settings.user_name || 'User';
  let processedContent = newContent.replace(/\{\{user\}\}/gi, userName);
  processedContent = processedContent.replace(/\{\{char\}\}/gi, char.name);

  // Update store
  chatStore.updateMessage(messageId, { content: processedContent, translated_content: null });
  await chatStore.saveCurrentSession();

  // Re-render chat
  loadChat(appState.currentChat);
}

let userHasScrolledUp = false;
let isProgrammaticScrolling = false;

function setupScrollListener() {
  if (!messagesContainer || messagesContainer._scrollListenerAttached) return;
  messagesContainer._scrollListenerAttached = true;
  messagesContainer.addEventListener('scroll', () => {
    if (isProgrammaticScrolling) return;
    const threshold = 60;
    const distanceFromBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
    userHasScrolledUp = distanceFromBottom > threshold;
  }, { passive: true });
}

function scrollToBottom(force = false) {
  if (!messagesContainer) return;
  setupScrollListener();

  if (force) {
    userHasScrolledUp = false;
  } else if (userHasScrolledUp) {
    return;
  }

  requestAnimationFrame(() => {
    if (!messagesContainer) return;
    isProgrammaticScrolling = true;
    const maxScrollTop = messagesContainer.scrollHeight - messagesContainer.clientHeight;
    messagesContainer.scrollTop = Math.max(0, maxScrollTop);

    setTimeout(() => {
      isProgrammaticScrolling = false;
    }, 60);
  });
}
window.scrollToBottom = scrollToBottom;

// ─── Edit & Regenerate Logic ────────────────────────────────────────

function updateRegenerateVisibility() {
  // Only the last assistant message should have the regenerate button
  const allMessages = messagesContainer.querySelectorAll('.message');
  allMessages.forEach(m => m.querySelector('.btn-regenerate')?.classList.add('hidden'));

  const lastMsg = allMessages[allMessages.length - 1];
  if (lastMsg && lastMsg.classList.contains('assistant') && !appState.isGenerating) {
    lastMsg.querySelector('.btn-regenerate')?.classList.remove('hidden');
  }
}

function enterEditMode(msg, msgEl) {
  const contentEl = msgEl.querySelector('.message-text');
  const originalHtml = contentEl.innerHTML;
  const originalContent = msg.content;

  // Create editor
  const editor = document.createElement('div');
  editor.className = 'message-edit-container';
  editor.innerHTML = `
    <textarea class="message-edit-textarea">${originalContent}</textarea>
    <div class="edit-actions">
      <button class="btn-cancel-edit btn-secondary small">Cancel</button>
      <button class="btn-save-edit btn-primary small">Save</button>
    </div>
  `;

  contentEl.style.display = 'none';
  msgEl.querySelector('.message-body').insertBefore(editor, msgEl.querySelector('.message-meta'));

  const textarea = editor.querySelector('.message-edit-textarea');
  autoResizeTextarea(textarea);
  textarea.focus();
  textarea.selectionStart = textarea.value.length;

  textarea.addEventListener('input', () => autoResizeTextarea(textarea));

  editor.querySelector('.btn-cancel-edit').addEventListener('click', () => {
    editor.remove();
    contentEl.style.display = 'block';
  });

  editor.querySelector('.btn-save-edit').addEventListener('click', async () => {
    const newContent = textarea.value.trim();
    if (newContent && newContent !== originalContent) {
      chatStore.updateMessage(msg.id, { content: newContent, translated_content: null });
      await chatStore.saveCurrentSession();

      // Update UI
      msg.content = newContent;
      msg.translated_content = null;
      const cleaned = stripJsonBlocks(newContent, false);
      let formatted = renderMarkdown(cleaned);
      formatted = processCharacterMentions(formatted);
      contentEl.innerHTML = formatted;
      updateContextIndicator();
    }
    editor.remove();
    contentEl.style.display = 'block';
  });
}

async function regenerateResponse(msg, msgEl) {
  if (appState.isGenerating) return;

  // Remove the message from UI and store
  chatStore.deleteMessage(msg.id);
  msgEl.remove();
  await chatStore.saveCurrentSession();

  // Trigger new generation
  // We need to call sendMessage but without adding a new user message
  // Let's create a specialized trigger for this
  triggerAssistantGeneration();
}

async function triggerAssistantGeneration() {
  if (appState.isGenerating || !appState.currentCharacter || !appState.currentChat) return;

  // Abort pending suggestions generation if any
  if (appState.suggestionsAbortController) {
    appState.suggestionsAbortController.abort();
    appState.suggestionsAbortController = null;
  }

  // Abort any pending context calculations to prevent concurrent API requests
  if (activeContextCalculationController) {
    activeContextCalculationController.abort();
    activeContextCalculationController = null;
  }

  const character = appState.currentCharacter;
  const session = appState.currentChat;
  const settings = settingsStore.get();

  // Start generation
  appState.isGenerating = true;
  appState.abortController = new AbortController();

  // Update last chat timestamp
  characterStore.updateLastChat(character.id);
  window.dispatchEvent(new CustomEvent('character-list-updated'));

  btnSend.classList.add('hidden');
  btnStop.classList.remove('hidden');
  headerCharStatus.textContent = 'Generating...';
  headerCharStatus.classList.add('generating');

  // Build messages
  const apiMessages = await buildApiMessages(character, session);

  // Add placeholder
  const assistantMsg = chatStore.addMessage('assistant', '', null, session);
  const msgElement = appendMessage(assistantMsg, true, character);
  const contentEl = msgElement.querySelector('.message-text');

  let fullResponse = (settings.force_reasoning && settings.reasoning_tag_open && (settings.reasoning_effort || 'none') !== 'none') ? settings.reasoning_tag_open : '';
  let thinkingText2 = '';  // accumulated from delta.reasoning_content
  let isStreaming2 = true;
  let hasReceivedFirstChunk2 = false;
  let thinkingActive2 = false;
  let thinkingStartTime = Date.now();
  let thinkingTime = 0;
  let thinkingActiveInline2 = false;
  const apiOptions = {};

  // Show Processing... immediately while waiting for API response
  contentEl.innerHTML = `<span class="chat-working-placeholder">Processing...</span>`;

  const morphOptions2 = {
    childrenOnly: true,
    getNodeKey: (node) => node.dataset?.wordIndex || node.id || null,
    onBeforeElUpdated: (from, to) => {
      if (from.nodeName === 'THINKING-SNIPPETS' && to.nodeName === 'THINKING-SNIPPETS') {
        if (to.hasAttribute('thoughts')) from.setAttribute('thoughts', to.getAttribute('thoughts'));
        return false;
      }
      // Force clearing of display: none style when elements should no longer be hidden
      if (from.style && from.style.display === 'none' && to.style.display !== 'none') {
        from.style.display = '';
      }
      // For table elements: replace innerHTML directly to avoid morphdom flickering
      if (from.nodeName === 'TABLE') {
        if (from.innerHTML !== to.innerHTML) {
          from.innerHTML = to.innerHTML;
        }
        return false;
      }
      return true;
    }
  };

  function scheduleUpdate2() {
    if (appState.updateScheduled) return;
    appState.updateScheduled = true;
    requestAnimationFrame(() => {
      appState.updateScheduled = false;
      if (!isStreaming2) return;

      const useGLM = settings.glm47_support && !/<(?:think|thought|reasoning|\|channel>thought)/i.test(fullResponse);
      let displayContent, currentThinking, currentIsInThinking;
      if (thinkingText2) {
        currentThinking = thinkingText2;
        currentIsInThinking = thinkingActive2;
        let cleanResponseForParsing = fullResponse;
        if (settings.force_reasoning && settings.reasoning_tag_open && cleanResponseForParsing.startsWith(settings.reasoning_tag_open)) {
          cleanResponseForParsing = cleanResponseForParsing.substring(settings.reasoning_tag_open.length);
        }
        displayContent = cleanResponseForParsing;
      } else {
        const parsed = useGLM ? parseGLMThinking(fullResponse) : parseStreamThinking(fullResponse, settings.reasoning_tag_open, settings.reasoning_tag_close);
        currentThinking = parsed.thinking;
        displayContent = parsed.content;
        currentIsInThinking = parsed.isInThinking;
        
        if (parsed.isInThinking && !thinkingActiveInline2) {
          thinkingActiveInline2 = true;
          thinkingStartTime = Date.now();
        }

        if (thinkingActiveInline2 && !parsed.isInThinking && parsed.thinking) {
          thinkingActiveInline2 = false;
          thinkingTime = Math.round((Date.now() - thinkingStartTime) / 1000);
        }
      }

      if (!currentIsInThinking && displayContent.startsWith('*') && !displayContent.endsWith('*')) {
        displayContent += '*';
      }

      // Still waiting for first output — keep Working... visible
      if (!hasReceivedFirstChunk2) return;

      let html = '';
      if (currentIsInThinking || currentThinking) html += createThinkingBlockHTML(currentThinking, currentIsInThinking, settings.glm47_support, typeof thinkingTime !== "undefined" ? thinkingTime : 0, settings.reasoning_effort);
      const cleaned2 = stripJsonBlocks(displayContent, true);
      html += wrapWordsInSpans(renderMarkdown(cleaned2));

      if (!cleaned2.trim() && isStreaming2 && !currentIsInThinking) {
        html += `<span class="chat-working-placeholder">Processing...</span>`;
      }

      const temp = document.createElement('div');
      temp.className = contentEl.className;
      temp.innerHTML = html;
      morphdom(contentEl, temp, morphOptions2);

      if (!currentIsInThinking) {
        getOrCreateChatCursor();
        repositionChatCursor(contentEl);
      }
    });
  }

  try {
    await api.streamChat(
      apiMessages,
      appState.abortController.signal,
      (chunk) => {
        fullResponse += chunk;
        hasReceivedFirstChunk2 = true;
        if (thinkingActive2) {
          thinkingActive2 = false;
          if (thinkingTime === 0) thinkingTime = Math.round((Date.now() - thinkingStartTime) / 1000);
        }
        scheduleUpdate2();
      },
      async () => {
        isStreaming2 = false;
        if (thinkingActive2) {
          thinkingActive2 = false;
          if (thinkingTime === 0) thinkingTime = Math.round((Date.now() - thinkingStartTime) / 1000);
        }
        const useGLM = settings.glm47_support && !/<(?:think|thought|reasoning|\|channel>thought)/i.test(fullResponse);
        let parsedThinking2, parsedContent2;
        try {
          if (thinkingText2) {
            parsedThinking2 = thinkingText2;
            let cleanResponseForParsing = fullResponse;
            if (settings.force_reasoning && settings.reasoning_tag_open && cleanResponseForParsing.startsWith(settings.reasoning_tag_open)) {
              cleanResponseForParsing = cleanResponseForParsing.substring(settings.reasoning_tag_open.length);
            }
            parsedContent2 = cleanResponseForParsing;
          } else {
            const parsed = useGLM ? parseGLMThinking(fullResponse) : parseThinking(fullResponse, settings.reasoning_tag_open, settings.reasoning_tag_close);
            parsedThinking2 = parsed.thinking;
            parsedContent2 = parsed.content;
          }

          removeChatCursor();
          let finalHtml = '';
          if (parsedThinking2) {
              if (thinkingTime === 0) thinkingTime = Math.round((Date.now() - thinkingStartTime) / 1000);
              finalHtml += createThinkingBlockHTML(parsedThinking2, false, settings.glm47_support, thinkingTime, settings.reasoning_effort);
          }
          const cleaned = stripJsonBlocks(parsedContent2, false);
          let formatted = renderMarkdown(cleaned);
          formatted = processCharacterMentions(formatted);
          
          const isNewAnimation = settings.new_streaming_animation;
          if (isNewAnimation) {
            finalHtml += wrapWordsInSpans(formatted, true, Infinity, settings.streaming_speed || 45);
          } else {
            finalHtml += wrapWordsInSpans(formatted);
          }

          const tempFinal = document.createElement('div');
          tempFinal.className = contentEl.className;
          tempFinal.innerHTML = finalHtml;
          morphdom(contentEl, tempFinal, morphOptions2);
        } catch (e) {
          console.error("Error finalizing regenerate UI:", e);
        }

        let originalContent = parsedContent2;

        let translatedContent = null;
        if (settings.auto_translate && originalContent) {
          headerCharStatus.textContent = 'Translating...';
          translatedContent = await performStreamingTranslation(contentEl, originalContent, settings.target_language);
        }

        chatStore.updateLastAssistantMessage(originalContent, parsedThinking2, session, translatedContent, thinkingTime);
        await chatStore.saveSession(session);

        appState.isGenerating = false;
        appState.abortController = null;
        btnSend.classList.remove('hidden');
        btnStop.classList.add('hidden');
        headerCharStatus.textContent = 'Ready';
        headerCharStatus.classList.remove('generating');
        updateChatHistory();
        updateRegenerateVisibility();
        scrollToBottom();

        if (originalContent) {
          // Strict sequential execution IIFE to respect single-concurrency LLM limits
          (async () => {
            try {
              // 1. Generate continuation options replies first (High Priority UI)
              await generateContinuationOptions(character, session, msgElement);
            } catch (e) {
              console.warn('Failed to generate suggestions:', e);
            }

            try {
              // 2. Process Automatic Image Gen if active (High Priority UI)
              const freshSettings = settingsStore.get();
              if (freshSettings.comfyui_enabled && freshSettings.comfyui_auto_chat) {
                await triggerAutomaticImageGeneration(character, session, originalContent);
              } else if (freshSettings.comfyui_enabled && !freshSettings.comfyui_auto_chat) {
                await triggerImageGenerationSuggestion(character, session, originalContent, msgElement);
              }
            } catch (e) {
              console.warn('Failed to handle image generation:', e);
            }

            const lastUserMsg = session.messages.slice().reverse().find(m => m.role === 'user');
            if (lastUserMsg) {
              try {
                // 3. Extract and save memory (Low Priority Background)
                await extractAndShowMemory(character, session, lastUserMsg.content, originalContent, msgElement);
              } catch (e) {
                console.warn('Failed to extract memory:', e);
              }

              try {
                // 4. Update indicators status (Low Priority Background)
                await triggerIndicatorUpdate(character, session, lastUserMsg.content, originalContent);
              } catch (e) {
                console.warn('Failed to update indicators:', e);
              }
            }

            try {
              // 5. Auto-naming
              const freshSettings = settingsStore.get();
              if (freshSettings.auto_naming_enabled) {
                const chatMessages = session.messages.filter(m => m.role !== 'system');
                const msgCount = chatMessages.length;
                const lastCount = session.last_auto_named_count || (session.custom_title ? 3 : 0);

                if (lastCount === 0 && msgCount >= 3 && !session.custom_title) {
                  const newName = await api.generateChatName(chatMessages, true);
                  if (newName && newName !== 'New Chat') {
                    session.last_auto_named_count = msgCount;
                    await chatStore.renameSession(session.id, newName, session.character_id);
                    updateChatHistory();
                  }
                } else if (lastCount > 0 && (msgCount - lastCount >= 6)) {
                  if (freshSettings.continuous_auto_naming_enabled) {
                    const newName = await api.generateChatName(chatMessages, true);
                    if (newName && newName !== 'New Chat') {
                      session.last_auto_named_count = msgCount;
                      await chatStore.renameSession(session.id, newName, session.character_id);
                      updateChatHistory();
                    }
                  }
                }
              }
            } catch (e) {
              console.warn('Failed to auto-name chat:', e);
            }
          })();
        }
      },
      (err) => {
        console.error('Regeneration error:', err);
        isStreaming2 = false;
        removeChatCursor();
        appState.isGenerating = false;
        btnSend.classList.remove('hidden');
        btnStop.classList.add('hidden');
        headerCharStatus.textContent = 'Error';
        headerCharStatus.classList.remove('generating');
      },
      apiOptions,
      // onThinkingChunk (delta.reasoning_content from KoboldCpp thinking models)
      (thinkChunk) => {
        thinkingText2 += thinkChunk;
        thinkingActive2 = true;
        hasReceivedFirstChunk2 = true;
        scheduleUpdate2();
      }
    );
  } catch (err) {
    console.error('Regeneration try/catch error:', err);
    appState.isGenerating = false;
  }
}

export function updateChatHistory() {
  if (!appState.currentCharacter) return;

  const list = document.getElementById('chat-history-list');
  if (!list) return;

  const sessions = chatStore.getSessions(appState.currentCharacter.id);
  const currentChat = appState.currentChat;

  // Напрямую обновляем DOM
  list.innerHTML = sessions.map(session => {
    const firstUserMsg = session.messages.find(m => m.role === 'user');
    let title = session.custom_title;
    if (!title) {
      title = firstUserMsg
        ? firstUserMsg.content.substring(0, 40) + (firstUserMsg.content.length > 40 ? '...' : '')
        : 'New Chat';
    }

    const isActive = currentChat && (session.id === currentChat.id);

    return `
      <div class="chat-history-item ${isActive ? 'active' : ''}" data-chat-id="${session.id}">
        <div class="chat-history-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="chat-history-item-info">
          <div class="chat-history-item-title">${escapeHtml(title)}</div>
          <div class="chat-history-item-date">${formatTime(session.updated_at)}</div>
        </div>
        <button class="chat-history-item-delete" data-delete-chat="${session.id}" title="Delete chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `;
  }).join('');

  // Инициализация обработчиков только один раз
  if (!list._listenersAttached) {
    list._listenersAttached = true;
    list.addEventListener('click', async (e) => {
      // Удаление
      const deleteBtn = e.target.closest('[data-delete-chat]');
      if (deleteBtn) {
        e.stopPropagation();
        const chatId = deleteBtn.dataset.deleteChat;
        const confirmed = await showConfirm('Delete Chat', 'Are you sure you want to delete this chat history?');
        if (confirmed) {
          await chatStore.deleteSession(appState.currentCharacter.id, chatId);
          updateChatHistory();
          if (appState.currentChat?.id === chatId) {
            clearMessages();
            const container = document.getElementById('chat-messages');
            container.innerHTML = `
            <div class="empty-state">
              <div class="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <h2>Start a new chat</h2>
              <p>Click the + button to begin a new conversation.</p>
            </div>
          `;
            appState.currentChat = null;
          }
        }
        return;
      }

      const item = e.target.closest('.chat-history-item');
      if (item) {
        const chatId = item.dataset.chatId;
        const currentSessions = chatStore.getSessions(appState.currentCharacter.id);
        const session = currentSessions.find(s => s.id === chatId);

        // Загружаем только если это другой чат
        if (session && session.id !== appState.currentChat?.id) {
          try {
            loadChat(session);
          } finally {
            updateChatHistory();
          }
        }
      }
    });
  }

  perf.end('updateChatHistory');
}

// ─── Continuation Options ───────────────────────────────────────────

async function generateContinuationOptions(character, session, msgElement) {
  try {
    const messages = await buildApiMessages(character, session);
    if (messages.length === 0) return;

    const settings = settingsStore.get();
    if (!settings.suggestions_enabled) return;

    const suggestionsLang = settings.suggestions_language || 'Russian';

    // Abort previous suggestions generation if any
    if (appState.suggestionsAbortController) {
      appState.suggestionsAbortController.abort();
    }
    const controller = new AbortController();
    appState.suggestionsAbortController = controller;
    const signal = controller.signal;

    // Add a system instruction to generate options
    messages.push({
      role: 'system',
      content: `Based on the conversation so far, generate exactly 3 logical and engaging continuation options for the user to reply with.
Return ONLY a valid JSON array of objects with 'label' (short summary, max 4 words) and 'message' (the actual full message to send).

CRITICAL INSTRUCTIONS:
1. The 'label' field must be in ${suggestionsLang}.
2. The 'message' field must be in English.

Example:
[
  { "label": "Ask about sword", "message": "Where did you find that glowing sword?" },
  { "label": "Run away", "message": "I don't trust you, I'm leaving!" },
  { "label": "Offer help", "message": "How can I assist you with your quest?" }
]
Do not include any Markdown formatting like \`\`\`json or any other text. Return strictly the raw JSON array.`
    });

    const response = await api.chatCompletion(messages, {
      max_tokens: 1024,
      temperature: 0.7,
      signal: signal,
      priority: 'background',
      reasoning_effort: 'none'
    });

    // CRITICAL: Check if we were aborted while waiting for the network
    if (signal.aborted || !msgElement.isConnected) return;

    // Check if user started typing in the meantime
    if (messageInput.value.trim().length > 0) return;

    // Strip thinking blocks just in case
    const cleanResponse = response.replace(/(?:<\|?think\|?>|<reasoning>|<\|channel>thought)([\s\S]*?)(?:<\|?\/think\|?>|<\/reasoning>|<channel\|>)/gi, '');

    const jsonMatch = cleanResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const options = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(options) || options.length === 0) return;

    // Check if the message still exists in the session before saving
    const msgId = msgElement.dataset.messageId;
    if (session && !session.messages.some(m => m.id === msgId)) {
      return;
    }

    // Save options to store using captured session
    chatStore.updateLastAssistantOptions(options, session);
    chatStore.saveSession(session);

    // Only render if the element is still in the DOM and belongs to this character
    if (msgElement.isConnected && appState.currentCharacter?.id === character.id) {
      renderContinuationOptions(msgElement, options, character, session);
    }

    appState.suggestionsAbortController = null;
  } catch (err) {
    if (err.name === 'AbortError' || (err.message && err.message.includes('abort'))) return;
    console.warn('Failed to generate continuation options:', err);
    appState.suggestionsAbortController = null;
  }

}

function renderContinuationOptions(msgElement, options, character, session) {
  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'continuation-options';

  options.slice(0, 3).forEach((opt, index) => {
    if (!opt.label || !opt.message) return;
    const btn = document.createElement('button');
    btn.className = 'continuation-option-btn';
    btn.textContent = opt.label;
    btn.style.animationDelay = `${index * 0.15}s`;

    btn.addEventListener('click', () => {
      // Remove options when one is clicked
      optionsContainer.remove();

      // Update store using captured session
      const msgId = msgElement.dataset.messageId;
      if (session) {
        const msg = session.messages.find(m => m.id === msgId);
        if (msg) {
          delete msg.options;
          chatStore.saveSession(session);
        }
      }

      // Send the message (this will naturally use appState but we ensure input is set)
      messageInput.value = opt.message;
      sendMessage();
    });

    optionsContainer.appendChild(btn);
  });

  // Append + button after the options
  const btnPlus = document.createElement('button');
  btnPlus.className = 'continuation-option-btn plus-option-btn';
  btnPlus.title = "Explore more unique options";
  btnPlus.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 14px; height: 14px; display: block;">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  `;
  btnPlus.style.animationDelay = `${options.slice(0, 3).length * 0.15}s`;
  btnPlus.addEventListener('click', () => {
    openMoreSuggestionsModal(character || appState.currentCharacter, session || appState.currentChat, msgElement);
  });
  optionsContainer.appendChild(btnPlus);

  if (optionsContainer.children.length > 0) {
    msgElement.querySelector('.message-body').appendChild(optionsContainer);
    scrollToBottom();
  }
}

// ─── AI Comment Feature ─────────────────────────────────────────────

async function requestAiComment(msg, character) {
  const settings = settingsStore.get();

  // Detect context
  const groupViewEl = document.getElementById('group-chat-view-container');
  const isGroupViewOpen = groupViewEl && !groupViewEl.classList.contains('hidden');

  let session, store, builder;
  if (isGroupViewOpen) {
    session = groupChatStore.getCurrentSession();
    store = groupChatStore;
    const groupId = groupChatStore.getActiveGroupId();
    const group = groupChatStore.getGroupById(groupId);
    const members = (group?.character_ids || []).map(id => characterStore.getById(id)).filter(Boolean);
    builder = (char, sess) => buildGroupApiMessages(char, members, sess);
  } else {
    session = chatStore.getCurrentSession();
    store = chatStore;
    builder = buildApiMessages;
  }

  if (!session || !character || !settings.ai_comments_enabled) return;

  const modal = document.getElementById('ai-comment-modal');
  const contentEl = document.getElementById('ai-comment-content');
  const btnOk = document.getElementById('btn-ok-ai-comment');
  const btnCopy = document.getElementById('btn-copy-ai-comment');
  const btnClose = document.getElementById('btn-close-ai-comment');
  const btnAdvice = document.getElementById('btn-advice-ai-comment');

  btnAdvice.classList.add('hidden');
  btnOk.disabled = false; // Always enabled as "Hide"

  openWindow(modal);
  contentEl.innerHTML = injectCursor('');
  btnCopy.classList.add('hidden');

  // Build API messages up to this point
  const msgIndex = session.messages.findIndex(m => m.id === msg.id);
  let contextMessages = [];
  if (msgIndex !== -1) {
    const relevantMsgs = session.messages.slice(0, msgIndex + 1);
    const tempSession = { ...session, messages: relevantMsgs };
    contextMessages = await builder(character, tempSession);
  } else {
    contextMessages = await builder(character, session);
  }

  // Append the comment prompt
  let commentPrompt = settings.ai_comments_prompt || 'Comment on the last action.';

  const commentLang = settings.ai_comments_language || 'Auto';
  if (commentLang === 'Auto') {
    commentPrompt += ` Respond in the current conversation language (${settings.target_language || 'Russian'}).`;
  } else {
    commentPrompt += ` Respond strictly in ${commentLang}.`;
  }

  contextMessages.push({
    role: 'user',
    content: `[SYSTEM COMMAND] ${commentPrompt}`
  });

  const abortController = new AbortController();

  const cleanup = () => {
    abortController.abort();
    closeWindow(modal);
    btnOk.onclick = null;
    btnClose.onclick = null;
    btnCopy.onclick = null;
    btnAdvice.onclick = null;
  };

  btnOk.onclick = cleanup;
  btnClose.onclick = cleanup;

  let fullComment = '';

  try {
    await api.streamChat(
      contextMessages,
      abortController.signal,
      (chunk) => {
        fullComment += chunk;
        contentEl.innerHTML = injectCursor(renderMarkdown(fullComment));
      },
      async () => {
        contentEl.innerHTML = renderMarkdown(fullComment);
        btnCopy.classList.remove('hidden');
        btnAdvice.classList.remove('hidden');

        if (settings.ai_comments_history_enabled) {
          const snippet = msg.content ? msg.content.substring(0, 60).replace(/\n/g, ' ') + (msg.content.length > 60 ? '...' : '') : '...';
          store.addAiComment(msg.id, snippet, fullComment, session);
          store.saveSession(session);
          renderAiCommentsHistory();
        }

        btnCopy.onclick = () => {
          navigator.clipboard.writeText(fullComment);
          btnCopy.textContent = 'Copied!';
          setTimeout(() => btnCopy.textContent = 'Copy', 2000);
        };

        btnAdvice.onclick = async () => {
          btnAdvice.classList.add('hidden');

          let adviceTextPrefix = "посоветуй, что мне стоит делать дальше?"; // Default
          let adviceInstruction = "";

          const commentLang = settings.ai_comments_language || 'Auto';
          if (commentLang === 'Auto') {
            adviceTextPrefix = "What should I do next?";
            adviceInstruction = ` Respond in the current conversation language (${settings.target_language || 'Russian'}).`;
          } else if (commentLang === 'English') {
            adviceTextPrefix = "What should I do next?";
            adviceInstruction = " Respond in English.";
          } else if (commentLang === 'Russian') {
            adviceTextPrefix = "посоветуй, что мне стоит делать дальше?";
            adviceInstruction = " Respond in Russian.";
          } else if (commentLang === 'Spanish') {
            adviceTextPrefix = "¿Qué debo hacer a continuación?";
            adviceInstruction = " Respond in Spanish.";
          }

          contextMessages.push({ role: 'assistant', content: fullComment });
          contextMessages.push({ role: 'user', content: `[SYSTEM COMMAND] ${adviceTextPrefix}${adviceInstruction}` });

          const separator = '<hr style="margin: 1.5rem 0; border: none; border-top: 1px solid var(--border-subtle); opacity: 0.5;">';
          let adviceText = '';

          try {
            await api.streamChat(
              contextMessages,
              abortController.signal,
              (chunk) => {
                adviceText += chunk;
                contentEl.innerHTML = renderMarkdown(fullComment) + separator + injectCursor(renderMarkdown(adviceText));
              },
              () => {
                contentEl.innerHTML = renderMarkdown(fullComment) + separator + renderMarkdown(adviceText);
                const combinedText = fullComment + "\n\n---\n\n" + adviceText;
                btnCopy.onclick = () => {
                  navigator.clipboard.writeText(combinedText);
                  btnCopy.textContent = 'Copied!';
                  setTimeout(() => btnCopy.textContent = 'Copy', 2000);
                };
              }
            );
          } catch (err) {
            if (err.name !== 'AbortError') {
              contentEl.innerHTML += `<p style="color: var(--error)">Error: ${escapeHtml(err.message)}</p>`;
            }
            btnOk.disabled = false;
          }
        };
      },
      (err) => {
        if (err.name !== 'AbortError') {
          contentEl.innerHTML = `<p style="color: var(--error)">Error: ${escapeHtml(err.message)}</p>`;
        }
      }
    );
  } catch (err) {
    if (err.name !== 'AbortError') {
      contentEl.innerHTML = `<p style="color: var(--error)">Error: ${escapeHtml(err.message)}</p>`;
    }
  }
}

function injectCursor(html) {
  // Used for non-streaming contexts (e.g. genai-panel, book-view)
  const cursorHtml = '<span class="streaming-cursor"></span>';
  if (html.includes('</')) {
    return html.replace(/(<\/[a-z0-9]+>\s*)+$/i, (match) => cursorHtml + match);
  }
  return html + cursorHtml;
}



export function renderAiCommentsHistory() {
  const listEl = document.getElementById('ai-comments-list');
  if (!listEl) return;

  // Detect context
  const groupViewEl = document.getElementById('group-chat-view-container');
  const isGroupViewOpen = groupViewEl && !groupViewEl.classList.contains('hidden');

  let session;
  if (isGroupViewOpen) {
    session = groupChatStore.getCurrentSession();
  } else {
    session = chatStore.getCurrentSession();
  }

  listEl.innerHTML = '';

  if (!session || !session.ai_comments || session.ai_comments.length === 0) {
    listEl.innerHTML = '<div style="text-align: center; color: var(--text-tertiary); padding: 20px; font-size: var(--text-sm);">No comments yet.</div>';
    return;
  }

  const comments = [...session.ai_comments].reverse();

  comments.forEach(comment => {
    const item = document.createElement('div');
    item.className = 'ai-comment-history-item';

    // Format timestamp
    const date = new Date(comment.timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    item.innerHTML = `
      <div class="ai-comment-history-target">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
        </svg>
        <span>${escapeHtml(comment.target_content_snippet || '...')}</span>
      </div>
      <div class="ai-comment-history-content">
        ${renderMarkdown(comment.content)}
      </div>
      <div class="ai-comment-history-meta">${timeStr}</div>
    `;
    listEl.appendChild(item);
  });
}

export function openAiCommentsSidebar() {
  const sidebar = document.getElementById('ai-comments-sidebar');
  if (!sidebar) return;

  document.body.classList.add('ai-sidebar-open');

  setTimeout(() => {
    renderAiCommentsHistory();
  }, 200);
}

export function closeAiCommentsSidebar() {
  document.body.classList.remove('ai-sidebar-open');
}

function setupRightSidebarToggle() {
  const toggleBtn = document.getElementById('btn-toggle-right-sidebar');
  const headerToggleBtn = document.getElementById('btn-toggle-genai-header');
  const closeBtn = document.getElementById('btn-close-ai-comments-sidebar');

  const handleToggle = async () => {
    const settings = settingsStore.get();
    const isGenAIMode = settings.genai_mode_enabled;

    if (isGenAIMode) {
      const isCurrentlyOpen = document.body.classList.contains('genai-sidebar-open');
      const genaiModule = await import('./genai-panel.js');
      if (isCurrentlyOpen) {
        genaiModule.closeGenAIPanel();
        if (headerToggleBtn) headerToggleBtn.title = 'Open GenAI Assistant';
      } else {
        // Ensure comments are closed
        document.body.classList.remove('ai-sidebar-open');
        const commentsSidebar = document.getElementById('ai-comments-sidebar');
        if (commentsSidebar) commentsSidebar.classList.add('hidden');

        genaiModule.openGenAIPanel();
        if (headerToggleBtn) headerToggleBtn.title = 'Close GenAI Assistant';
      }
    } else {
      const isCurrentlyOpen = document.body.classList.contains('ai-sidebar-open');
      if (isCurrentlyOpen) {
        closeAiCommentsSidebar();
        if (headerToggleBtn) headerToggleBtn.title = 'Open Comments';
      } else {
        // Ensure genai is closed
        document.body.classList.remove('genai-sidebar-open');
        const genaiSidebar = document.getElementById('genai-sidebar');
        if (genaiSidebar) genaiSidebar.classList.add('hidden');

        openAiCommentsSidebar();
        if (headerToggleBtn) headerToggleBtn.title = 'Close Comments';
      }
    }
  };

  if (toggleBtn) {
    toggleBtn.addEventListener('click', handleToggle);
  }
  if (headerToggleBtn) {
    headerToggleBtn.addEventListener('click', handleToggle);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      closeAiCommentsSidebar();
      if (headerToggleBtn) headerToggleBtn.title = 'Open Comments';
    });
  }
}

async function triggerIndicatorUpdate(character, session, lastUserMsg, lastAssistantMsg) {
  if (!session?.indicators?.enabled || !session.indicators.list?.length) return;

  // Build a focused context for the update call
  // We use the character's core info but minimal history to keep it fast and focused
  const settings = settingsStore.get();
  const userName = settings.user_name || 'User';

  const context = [
    {
      role: 'system',
      content: `You are a character state analyzer. Your task is to update mood indicators based on the last interaction.\nCharacter: ${character.name}\nUser: ${userName}`
    }
  ];

  // Add last few messages for context
  const recentMsgs = session.messages.slice(-4);
  for (const m of recentMsgs) {
    context.push({ role: m.role, content: m.translated_content || m.content });
  }

  // Add the special command
  const statusStr = session.indicators.list.map(ind => `${ind.name}: ${ind.value}%`).join('\n');
  context.push({
    role: 'user',
    content: `[SYSTEM COMMAND] Analyze the character's response and update the indicators.
Current status:
${statusStr}

Instructions:
1. Return ONLY a JSON block.
2. Use relative changes (e.g. +10, -5, 0).
3. Be realistic based on the character's personality and the conversation.

Example: {"indicators": {"Trust": +5, "Fear": -10}}`
  });

  try {
    const response = await api.chatCompletion(context, { 
      max_tokens: 1024, 
      temperature: 0.1, 
      priority: 'background',
      reasoning_effort: 'none'
    });
    // More flexible JSON extraction (greedy to capture nested braces)
    const jsonMatch = response.match(/\{[\s\S]*"indicators"[\s\S]*\}/);
    if (jsonMatch) {
      const cleanedJson = jsonMatch[0].replace(/:\s*\+([0-9]+)/g, ': $1'); // Remove '+' signs before parsing
      try {
        const data = JSON.parse(cleanedJson);
        if (data.indicators) {
          let changed = false;
          for (const [name, change] of Object.entries(data.indicators)) {
            const ind = session.indicators.list.find(i => i.name.toLowerCase() === name.toLowerCase());
            if (ind) {
              const numericChange = parseInt(change);
              if (!isNaN(numericChange)) {
                ind.value = Math.max(0, Math.min(100, ind.value + numericChange));
                changed = true;
              }
            }
          }
          if (changed) {
            renderIndicators();
            chatStore.saveCurrentSession();
          }
        }
      } catch (parseErr) {
        console.warn('JSON parse error in indicators:', parseErr, cleanedJson);
      }
    }
  } catch (e) {
    console.warn('Indicator update failed:', e);
  }
}

function applyIndicatorUpdates(text, session) {
  // This is now redundant but keeping for backward compatibility if needed, 
  // though we'll remove calls to it.
  return text;
}

// ─── Character Mentions & JSON Cleaning Helpers ───

function cleanCharacterName(name) {
  if (!name) return '';
  return name.replace(/\{\{char:/g, '').replace(/\}\}/g, '').replace(/char:/g, '').trim();
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
      try {
        JSON.parse(candidate + (candidate.endsWith('}') ? '' : '}'));
        cleaned = cleaned.substring(0, lastCurly);
      } catch (e) {
        if (candidate.includes('":') && candidate.endsWith('}')) {
          cleaned = cleaned.substring(0, lastCurly);
        }
      }
    }
  }
  const lastSquare = cleaned.lastIndexOf('[');
  if (lastSquare !== -1) {
    const candidate = cleaned.substring(lastSquare).trim();
    if (candidate.startsWith('[{') && candidate.endsWith('}]')) {
      cleaned = cleaned.substring(0, lastSquare);
    }
  }

  return cleaned.trim();
}

function processCharacterMentions(text) {
  if (!text) return '';
  return text.replace(/\{\{char:([^|}]+)(?:\|([^}]+))?\}\}/g, (match, name, alias) => {
    const displayName = alias ? alias.trim() : name.trim();
    return `<span class="char-mention" data-char-name="${name.trim()}">${displayName}</span>`;
  });
}

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
  
  const shortDesc = char.short_description || char.description || 'No description available.';
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

// ─── Suggestions Explorer Modal Logic ───────────────────────────────

function openMoreSuggestionsModal(character, session, msgElement) {
  moreSuggestionsContext = { character, session, msgElement };
  generatedSuggestionsHistory = [];
  
  // Also collect the options already shown in the chat so we avoid them too!
  if (session && msgElement) {
    const msgId = msgElement.dataset.messageId;
    const msg = session.messages.find(m => m.id === msgId);
    if (msg && msg.options) {
      msg.options.forEach(opt => {
        if (opt.label) generatedSuggestionsHistory.push(opt.label);
      });
    }
  }
  
  const modal = document.getElementById('more-suggestions-modal');
  const welcome = document.getElementById('more-suggestions-welcome');
  const content = document.getElementById('more-suggestions-content');
  const topicInput = document.getElementById('more-suggestions-topic-input');
  
  if (welcome) welcome.classList.remove('hidden');
  if (content) {
    content.innerHTML = '';
    content.classList.add('hidden');
  }
  if (topicInput) topicInput.value = '';
  
  openWindow(modal);
  
  // Kick off automatic initial generation
  generateMoreSuggestions();
}

async function generateMoreSuggestions(customTopic = null) {
  const { character, session } = moreSuggestionsContext;
  if (!character || !session) return;
  
  // Abort previous generation if any
  abortMoreSuggestionsGeneration();
  
  const welcome = document.getElementById('more-suggestions-welcome');
  const content = document.getElementById('more-suggestions-content');
  const body = document.getElementById('more-suggestions-body');
  
  if (welcome) welcome.classList.add('hidden');
  if (content) {
    content.classList.remove('hidden');
    content.innerHTML = '<span class="streaming-cursor"></span>';
    content.classList.add('generating');
  }
  
  const controller = new AbortController();
  moreSuggestionsAbortController = controller;
  
  try {
    const messages = await buildApiMessages(character, session);
    if (messages.length === 0) return;
    
    const settings = settingsStore.get();
    const suggestionsLang = settings.suggestions_language || 'Russian';
    
    let systemInstruction = `Based on the conversation so far, generate several highly unique, engaging, and creative reply options for the user.
For each option:
1. Write a brief narrative description of the option's tone, style, and potential consequences (1-2 sentences).
2. Follow it with a JSON block representing the action/button.

Each JSON block must strictly follow this exact format:
\`\`\`json
{
  "label": "Button Name",
  "message": "Full hidden message to send to the chat"
}
\`\`\`

CRITICAL INSTRUCTIONS:
1. The description and the JSON "label" field (button name, max 4 words) MUST be strictly in ${suggestionsLang}.
2. The JSON "message" field (the actual prompt to send to chat) MUST be strictly in English.
3. You must generate at least 3-4 distinct and highly creative options.`;

    if (customTopic) {
      systemInstruction += `\n\nCRITICAL SPECIAL REQUEST: The user specifically requested that all options should fit this theme or topic: "${customTopic}". Make sure ALL generated choices match this theme!`;
    }

    if (generatedSuggestionsHistory.length > 0) {
      systemInstruction += `\n\nCRITICAL DIVERSITY INSTRUCTION: Avoid generating options that are similar to or duplicate these already generated choices: ${JSON.stringify(generatedSuggestionsHistory)}. Ensure the new reply choices are completely fresh, unique, and present different pathways!`;
    }
    
    messages.push({
      role: 'system',
      content: systemInstruction
    });
    
    let fullText = '';
    
    await api.streamChat(
      messages,
      controller.signal,
      (chunk) => {
        fullText += chunk;
        
        const rendered = renderSuggestionsHTML(fullText);
        content.innerHTML = rendered.html + '<span class="streaming-cursor"></span>';
        
        attachSuggestionButtonListeners(content, rendered.buttonsData);
        
        if (body) {
          body.scrollTop = body.scrollHeight;
        }
      },
      () => {
        moreSuggestionsAbortController = null;
        content.classList.remove('generating');
        
        const rendered = renderSuggestionsHTML(fullText);
        content.innerHTML = rendered.html;
        attachSuggestionButtonListeners(content, rendered.buttonsData);
        
        // Save the newly generated options into the avoid list/history
        if (rendered.buttonsData && rendered.buttonsData.length > 0) {
          rendered.buttonsData.forEach(btn => {
            if (btn.label && !generatedSuggestionsHistory.includes(btn.label)) {
              generatedSuggestionsHistory.push(btn.label);
            }
          });
        }
        
        if (body) {
          body.scrollTop = body.scrollHeight;
        }
      },
      (err) => {
        if (err.name === 'AbortError' || err.message?.includes('abort')) return;
        console.error('Failed to stream more suggestions:', err);
        content.innerHTML = `<p style="color: var(--error);">Error: ${escapeHtml(err.message)}</p>`;
        content.classList.remove('generating');
        moreSuggestionsAbortController = null;
      },
      {
        max_tokens: 1000,
        temperature: 0.85
      }
    );
  } catch (err) {
    console.error('generateMoreSuggestions error:', err);
    if (content) {
      content.innerHTML = `<p style="color: var(--error);">Error: ${escapeHtml(err.message)}</p>`;
      content.classList.remove('generating');
    }
    moreSuggestionsAbortController = null;
  }
}

function abortMoreSuggestionsGeneration() {
  if (moreSuggestionsAbortController) {
    moreSuggestionsAbortController.abort();
    moreSuggestionsAbortController = null;
  }
}

function renderSuggestionsHTML(rawText) {
  // Strip leading whitespace
  let displayContent = rawText.replace(/^[\s\n]+/, '');

  let processedText = displayContent;
  let showPreemptiveWorking = false;

  // Mathematically robust tick block tracking
  const tickCount = (displayContent.match(/```/g) || []).length;
  const isInsideUnclosedCodeBlock = (tickCount % 2 === 1);
  let isInsideUnclosedJsonCodeBlock = false;
  let unclosedTickIndex = -1;

  if (isInsideUnclosedCodeBlock) {
    unclosedTickIndex = displayContent.lastIndexOf('```');
    const afterTick = displayContent.substring(unclosedTickIndex).replace(/\s/g, '').toLowerCase();
    if (['', 'j', 'js', 'jso', 'json'].some(s => afterTick === '```' + s) || afterTick.startsWith('```json')) {
      isInsideUnclosedJsonCodeBlock = true;
    }
  }

  const braceIndex = displayContent.lastIndexOf('{');

  if (isInsideUnclosedJsonCodeBlock) {
    processedText = displayContent.substring(0, unclosedTickIndex);
    showPreemptiveWorking = true;
  } else {
    // If not already preemptively showing, check curly braces
    if (braceIndex !== -1) {
      const afterBrace = displayContent.substring(braceIndex);
      const normalized = afterBrace.replace(/\s/g, '').toLowerCase();

      // Check if it starts like a JSON block
      const isJsonBlock = normalized.startsWith('{"label') || 
                          normalized.startsWith('{"message') || 
                          normalized.startsWith('{"target') ||
                          normalized.includes('label') || 
                          normalized.includes('message');

      if (isJsonBlock || afterBrace.length < 25) {
        processedText = displayContent.substring(0, braceIndex);
        showPreemptiveWorking = true;
      }
    }
  }

  if (showPreemptiveWorking) {
    // Clean up any preceding code block markers so they don't leak either
    const precedingTick = processedText.lastIndexOf('```');
    if (precedingTick !== -1) {
      const afterPreceding = processedText.substring(precedingTick).replace(/\s/g, '').toLowerCase();
      if (['', 'j', 'js', 'jso', 'json'].some(s => afterPreceding === '```' + s)) {
        processedText = processedText.substring(0, precedingTick);
      }
    }
  }

  const blockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  const matches = [...processedText.matchAll(blockRegex)];
  const buttonsData = [];
  let buttonIndex = 0;
  
  matches.forEach(m => {
    const fullBlock = m[0];
    const innerContent = m[1].trim();
    try {
      const json = JSON.parse(innerContent);
      if (json && (json.label || json.message)) {
        const token = `__BUTTON_PLACEHOLDER_${buttonIndex}__`;
        processedText = processedText.replace(fullBlock, token);
        buttonsData.push({
          label: json.label || 'Select option',
          message: json.message || ''
        });
        buttonIndex++;
      }
    } catch (e) {
      // Ignore incomplete / invalid JSON
    }
  });
  
  let finalHtml = renderMarkdown(processedText);
  
  buttonsData.forEach((btnData, i) => {
    const placeholder = `__BUTTON_PLACEHOLDER_${i}__`;
    const btnHtml = `<div class="inline-suggestion-btn-container">
      <button class="continuation-option-btn inline-suggest-btn" data-btn-index="${i}">
        ${escapeHtml(btnData.label)}
      </button>
    </div>`;
    finalHtml = finalHtml.replace(placeholder, btnHtml);
  });

  if (showPreemptiveWorking) {
    finalHtml += `<div class="genai-inline-tool genai-tool-working" style="margin-top: 10px;"><span class="genai-working-text">Working...</span></div>`;
  }
  
  return { html: finalHtml, buttonsData };
}

function attachSuggestionButtonListeners(container, buttonsData) {
  const buttons = container.querySelectorAll('.inline-suggest-btn');
  buttons.forEach(btn => {
    if (btn._listenerBound) return;
    btn._listenerBound = true;
    
    const index = parseInt(btn.getAttribute('data-btn-index'));
    const data = buttonsData[index];
    if (!data) return;
    
    btn.addEventListener('click', () => {
      closeWindow('more-suggestions-modal');
      abortMoreSuggestionsGeneration();
      
      const { msgElement, session } = moreSuggestionsContext;
      if (msgElement) {
        const optionsEl = msgElement.querySelector('.continuation-options');
        if (optionsEl) optionsEl.remove();
        
        const msgId = msgElement.dataset.messageId;
        if (session) {
          const msg = session.messages.find(m => m.id === msgId);
          if (msg) {
            delete msg.options;
            chatStore.saveSession(session);
          }
        }
      }
      
      if (data.message) {
        messageInput.value = data.message;
        sendMessage();
      }
    });
  });
}

async function triggerAutomaticImageGeneration(character, session, assistantReply, targetMsg = null) {
  // 1. Find the target message to embed in
  const lastMsg = targetMsg || session.messages.slice().reverse().find(m => m.role === 'assistant');
  if (!lastMsg) return;

  // Start image generation state
  appState.isGenerating = true;
  appState.abortController = new AbortController();

  if (appState.currentCharacter?.id === character.id) {
    btnSend.classList.add('hidden');
    btnStop.classList.remove('hidden');
    headerCharStatus.textContent = 'Generating illustration...';
    headerCharStatus.classList.add('generating');
  }

  // Preserve the original text of the message so we can restore/append cleanly
  if (!lastMsg.original_text) {
    lastMsg.original_text = lastMsg.content;
  }

  // Set initial loading state while the LLM is writing the prompt
  lastMsg.content = lastMsg.original_text + '\n\n[[loader:Drafting the scene description...]]';
  loadChat(session); // re-render instantly to show the loader

  // Build a complete history context up to settings.prompt_token_limit
  const settings = settingsStore.get();
  const userName = session.user_name || settings.user_name || 'User';

  const historyLines = session.messages
    .filter(m => m.role !== 'system' && (m.content || m.original_text))
    .map(m => {
      const name = m.role === 'user' ? userName : character.name;
      const text = m.role === 'user' ? (m.translated_content || m.content) : (m.original_text || m.content);
      return `${name}: ${text}`;
    });

  const tokenLimit = Math.max(settings.prompt_token_limit || 4096, 2048);
  const charLimit = tokenLimit * 4;

  const charData = `Character: ${character.name}\nDescription: ${character.description || ''}\nPersonality: ${character.personality || ''}\nScenario: ${character.scenario || ''}`;
  const mandatoryTags = (character.image_tags && character.image_tags.trim() !== '') 
    ? `\n\nMANDATORY IMAGE TAGS: ${character.image_tags}\nYou MUST include these exact tags in your final Stable Diffusion prompt.` 
    : '';

  // Base overhead length estimation (prompts, instruction template)
  const baseOverheadLen = charData.length + mandatoryTags.length + 1500;

  let selectedLines = [];
  let currentLen = baseOverheadLen;

  for (let i = historyLines.length - 1; i >= 0; i--) {
    const line = historyLines[i];
    if (currentLen + line.length + 1 > charLimit) {
      break;
    }
    selectedLines.unshift(line);
    currentLen += line.length + 1;
  }

  const formattedHistory = selectedLines.join('\n');

  // Extract previous image prompts for visual consistency
  const previousImagePrompts = [];
  session.messages.forEach(m => {
    if (m.content) {
      const matches = m.content.matchAll(/!\[(.*?)\]\((.*?)\)/g);
      for (const match of matches) {
        const prompt = match[1];
        if (prompt && !prompt.includes('loader:')) {
          previousImagePrompts.push(prompt);
        }
      }
    }
  });

  let contextText = `${charData}\n\nCONVERSATION HISTORY:\n${formattedHistory}`;
  if (previousImagePrompts.length > 0) {
    contextText += `\n\nPREVIOUSLY GENERATED ILLUSTRATION PROMPTS (Use these to maintain visual consistency, clothing, characters, style, and setting across images):\n` + 
      previousImagePrompts.map((p, idx) => `Illustration ${idx + 1}: ${p}`).join('\n');
  }
  if (character.image_tags && character.image_tags.trim() !== '') {
    contextText += mandatoryTags;
  }
  
  let systemPromptContent = `You are an expert prompt engineer and scenic narrator for AI image generators.
Analyze the character profile and the entire conversation history context carefully.
CRITICAL DIRECTIVE: You MUST pay close attention to all visual and narrative context clues, details, and progression in the conversation history (such as the character's attire/clothing, physical pose, emotions, facial expressions, weapons or objects held, background environment, lighting, time of day, and active setting). Do NOT miss or ignore these details! Your generated Stable Diffusion prompt must accurately reflect the CURRENT state and context of the scene.

CRITICAL DIRECTIVE ON VISUAL CONSISTENCY: If the context contains 'PREVIOUSLY GENERATED ILLUSTRATION PROMPTS', analyze them to maintain visual consistency across generations. You should carry over persistent features (such as clothing style/color, hairstyle, hair color, facial features, or key items) from the previous illustration prompts unless the scene/action specifies a clear change (e.g., character changed clothes, it is now night, or they moved to a new room).

You must generate two things:
1. An array of 3 creative loading status messages in English describing the drawing process (e.g. "Sketching the forest outline...", "Detailing character clothing...", "Adding volumetric lighting..."). Be very short (3-5 words each).
2. A detailed, highly descriptive illustration prompt for Stable Diffusion (Anima model) in English that incorporates all mandatory tags and the full visual context.

You MUST respond strictly in the following JSON format. Output ONLY raw JSON, do not include markdown codeblocks or conversational text:
{
  "statuses": ["creative message 1", "creative message 2", "creative message 3"],
  "prompt": "detailed stable diffusion keywords in English"
}`;

  const isBetterPromptsActive = !!settings.comfyui_better_prompts;
  console.log('[Main Chat ImageGen] Generating prompt. Better prompts:', isBetterPromptsActive);
  if (isBetterPromptsActive) {
    systemPromptContent += '\n\n' + ANIMA_BETTER_PROMPT_TEXT;
  }

  const messages = [
    {
      role: 'system',
      content: systemPromptContent
    },
    {
      role: 'user',
      content: `Create an image prompt and status messages for this scene:\n\n${contextText}`
    }
  ];

  let parsed = null;
  try {
    if (appState.abortController.signal.aborted) throw new Error('Stopped by user');
    const rawResponse = await api.chatCompletion(messages, { 
      temperature: 0.7, 
      max_tokens: 4096,
      reasoning_effort: settings.comfyui_reasoning_effort || 'none'
    });
    let cleanText = rawResponse.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json/m, '').replace(/```$/m, '').trim();
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```/m, '').replace(/```$/m, '').trim();
    }
    parsed = JSON.parse(cleanText);
    
    // Strictly enforce tags by prepending them to the generated prompt
    if (parsed.prompt && character.image_tags && character.image_tags.trim() !== '') {
      // Ensure we don't duplicate if the LLM already included them at the start
      if (!parsed.prompt.toLowerCase().includes(character.image_tags.trim().toLowerCase())) {
        parsed.prompt = `${character.image_tags.trim()}, ${parsed.prompt}`;
      }
    }
  } catch (e) {
    console.warn('Failed to parse LLM prompt generation JSON:', e);
    parsed = {
      statuses: ['Generating illustration...', 'Rendering details...', 'Adding final touches...'],
      prompt: `anime illustration, detailed, ${character.name}, ${lastMsg.original_text.substring(0, 150)}`
    };
  }

  if (appState.abortController?.signal?.aborted) {
    cleanupState();
    return;
  }

  // Update loader with the custom neural-network selected status messages
  const statusesStr = Array.isArray(parsed.statuses) ? parsed.statuses.join('|') : (parsed.status || 'Generating...');
  lastMsg.content = lastMsg.original_text + `\n\n[[loader:${statusesStr}]]`;
  chatStore.saveCurrentSession();
  loadChat(session); // re-render instantly to show the custom status message

  function cleanupState() {
    if (appState.currentCharacter?.id === character.id) {
      appState.isGenerating = false;
      appState.abortController = null;
      btnSend.classList.remove('hidden');
      btnStop.classList.add('hidden');
      headerCharStatus.textContent = 'Ready';
      headerCharStatus.classList.remove('generating');
      updateRegenerateVisibility();
      scrollToBottom();
    } else {
      appState.isGenerating = false;
      appState.abortController = null;
    }
  }

  try {
    // 2. Generate the image via ComfyUI service with Abort Signal
    const blobUrl = await generateImageComfyUI(
      parsed.prompt, 
      null, 
      appState.abortController.signal,
      (status) => {
        const activeLoaderText = document.querySelector('.chat-message:last-child .genai-working-text');
        if (activeLoaderText) {
          activeLoaderText.textContent = status;
        }
      },
      (previewUrl) => {
        const container = document.querySelector('.chat-message:last-child .live-preview-container');
        const img = document.querySelector('.chat-message:last-child .live-preview-img');
        if (container && img) {
          container.classList.remove('hidden');
          img.src = previewUrl;
        }
      }
    );

    if (appState.abortController?.signal?.aborted) {
      cleanupState();
      return;
    }

    // Smooth transition from blur
    const activePreviewImg = document.querySelector('.chat-message:last-child .live-preview-img');
    if (activePreviewImg && activePreviewImg.src) {
      activePreviewImg.style.filter = 'blur(0px)';
      activePreviewImg.src = blobUrl;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 3. Replace loading message with the final image markdown
    lastMsg.content = lastMsg.original_text + `\n\n![${parsed.prompt}](${blobUrl})`;
    chatStore.saveCurrentSession();
    cleanupState();
    loadChat(session); // re-render to display the image!
  } catch (err) {
    console.error('Auto image generation failed:', err);
    
    if (appState.abortController?.signal?.aborted) {
      cleanupState();
      return;
    }

    // Replace loader with the error block
    lastMsg.content = lastMsg.original_text + `\n\n❌ **Ошибка генерации:** ${err.message}`;
    chatStore.saveCurrentSession();
    cleanupState();
    loadChat(session); // re-render to show the error
  }
}

// ─── Auto-Suggest Image Generation ───

async function triggerImageGenerationSuggestion(character, session, assistantReply, msgElement) {
  // Check if a suggestion popup is already active or generation is in progress
  if (appState.isGenerating || !document.getElementById('image-suggestion-wrapper').classList.contains('hidden')) {
    return;
  }

  const contextText = `Character: ${character.name} (${character.description || character.personality || ''})\n\nScene/Action: ${assistantReply}`;
  
  const messages = [
    {
      role: 'system',
      content: 'You are an AI assistant that analyzes a roleplay scene to decide if an image illustration should be generated. If the scene contains strong visual elements, action, or a distinct setting, you should recommend generating an image. If it is just dialogue or internal thoughts with no visual substance, decline.\n\nRespond strictly in the following JSON format:\n{\n  "should_generate": true/false,\n  "suggestion_text": "A very short, 1-sentence prompt suggestion describing what you envision (e.g. \\\'A cozy fireplace scene with the character reading a book\\\')"\n}'
    },
    {
      role: 'user',
      content: `Analyze this scene:\n\n${contextText}`
    }
  ];

  try {
    const rawResponse = await api.chatCompletion(messages, { 
      temperature: 0.5, 
      max_tokens: 1024, 
      priority: 'background',
      reasoning_effort: 'none'
    });
    let cleanText = rawResponse.trim();
    if (cleanText.startsWith('```json')) cleanText = cleanText.replace(/^```json/m, '').replace(/```$/m, '').trim();
    else if (cleanText.startsWith('```')) cleanText = cleanText.replace(/^```/m, '').replace(/```$/m, '').trim();
    
    let parsed = null;
    try {
      parsed = JSON.parse(cleanText);
    } catch (e) {
      console.warn('Failed to parse LLM image suggestion JSON directly, attempting recovery:', e);
      
      const shouldGenerateMatch = cleanText.match(/"should_generate"\s*:\s*(true|false)/i);
      if (shouldGenerateMatch) {
        const shouldGenerate = shouldGenerateMatch[1].toLowerCase() === 'true';
        let suggestionText = '';
        const suggestionTextMatch = cleanText.match(/"suggestion_text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
        if (suggestionTextMatch) {
          suggestionText = suggestionTextMatch[1].replace(/\\"/g, '"');
        } else {
          const truncatedMatch = cleanText.match(/"suggestion_text"\s*:\s*"([^"]*)$/);
          if (truncatedMatch) {
            suggestionText = truncatedMatch[1].replace(/\\"/g, '"').trim();
          }
        }
        parsed = {
          should_generate: shouldGenerate,
          suggestion_text: suggestionText
        };
      }
    }
    
    if (parsed && parsed.should_generate) {
      const suggestion = (parsed.suggestion_text && parsed.suggestion_text.trim()) 
        ? parsed.suggestion_text 
        : `Anime illustration of ${character.name}`;
      showImageSuggestionPopup(character, session, suggestion);
    }
  } catch (e) {
    console.warn('Failed to parse LLM image suggestion JSON:', e);
  }
}

function showImageSuggestionPopup(character, session, suggestionText) {
  const wrapper = document.getElementById('image-suggestion-wrapper');
  const textEl = document.getElementById('image-suggestion-text');
  const btnDecline = document.getElementById('btn-suggestion-decline');
  const btnGenerate = document.getElementById('btn-suggestion-generate');

  if (!wrapper || !textEl) return;

  textEl.textContent = suggestionText;
  wrapper.classList.remove('hidden');

  // Clear previous listeners
  const newBtnDecline = btnDecline.cloneNode(true);
  const newBtnGenerate = btnGenerate.cloneNode(true);
  btnDecline.replaceWith(newBtnDecline);
  btnGenerate.replaceWith(newBtnGenerate);

  newBtnDecline.addEventListener('click', () => {
    wrapper.classList.add('hidden');
  });

  newBtnGenerate.addEventListener('click', () => {
    wrapper.classList.add('hidden');
    // Find the last assistant message
    const lastMsg = session.messages.slice().reverse().find(m => m.role === 'assistant');
    if (!lastMsg) return;

    // Trigger standard automatic generation flow
    triggerAutomaticImageGeneration(character, session, lastMsg.content);
  });
}

async function triggerAutomaticImageGenerationWithPrompt(character, session, msg, prompt) {
  appState.isGenerating = true;
  appState.abortController = new AbortController();

  if (appState.currentCharacter?.id === character.id) {
    btnSend.classList.add('hidden');
    btnStop.classList.remove('hidden');
    headerCharStatus.textContent = 'Generating illustration...';
    headerCharStatus.classList.add('generating');
  }

  if (!msg.original_text) msg.original_text = msg.content;
  msg.content = msg.original_text + '\n\n[[loader:Generating suggested illustration...|Rendering details...|Adding final touches...]]';
  loadChat(session);

  function cleanupState() {
    if (appState.currentCharacter?.id === character.id) {
      appState.isGenerating = false;
      appState.abortController = null;
      btnSend.classList.remove('hidden');
      btnStop.classList.add('hidden');
      headerCharStatus.textContent = 'Ready';
      headerCharStatus.classList.remove('generating');
      updateRegenerateVisibility();
      scrollToBottom();
    } else {
      appState.isGenerating = false;
      appState.abortController = null;
    }
  }

  try {
    const blobUrl = await generateImageComfyUI(
      prompt, 
      null, 
      appState.abortController.signal,
      (status) => {
        const activeLoaderText = document.querySelector('.chat-message:last-child .genai-working-text');
        if (activeLoaderText) {
          activeLoaderText.textContent = status;
        }
      },
      (previewUrl) => {
        const container = document.querySelector('.chat-message:last-child .live-preview-container');
        const img = document.querySelector('.chat-message:last-child .live-preview-img');
        if (container && img) {
          container.classList.remove('hidden');
          img.src = previewUrl;
        }
      }
    );
    if (appState.abortController?.signal?.aborted) { cleanupState(); return; }

    // Smooth transition from blur
    const activePreviewImg = document.querySelector('.chat-message:last-child .live-preview-img');
    if (activePreviewImg && activePreviewImg.src) {
      activePreviewImg.style.filter = 'blur(0px)';
      activePreviewImg.src = blobUrl;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    msg.content = msg.original_text + `\n\n![${prompt}](${blobUrl})`;
    chatStore.saveCurrentSession();
    cleanupState();
    loadChat(session);
  } catch (err) {
    console.error('Auto image generation failed:', err);
    if (appState.abortController?.signal?.aborted) { cleanupState(); return; }

    msg.content = msg.original_text + `\n\n❌ **Ошибка генерации:** ${err.message}`;
    chatStore.saveCurrentSession();
    cleanupState();
    loadChat(session);
  }
}

// Global function to initialize status rotation
window.initStatusRotation = function(container) {
  if (!container || container.dataset.rotatorInited) return;
  container.dataset.rotatorInited = '1';

  const statuses = container.querySelectorAll('.chat-image-loader-status');
  if (statuses.length <= 1) return;

  let currentIndex = 0;

  // Random interval between 4s and 6s
  const getRandomInterval = () => Math.floor(Math.random() * 2000) + 4000;

  const rotate = () => {
    // If element is no longer in DOM, stop rotation
    if (!container.isConnected) return;

    const currentStatus = statuses[currentIndex];
    const nextIndex = (currentIndex + 1) % statuses.length;
    const nextStatus = statuses[nextIndex];

    currentStatus.classList.remove('active');
    currentStatus.classList.add('exit');

    nextStatus.classList.remove('exit');
    nextStatus.classList.add('active');

    currentIndex = nextIndex;

    setTimeout(rotate, getRandomInterval());
  };

  setTimeout(rotate, getRandomInterval());
};

// ─── Update Context Indicator ────────────────────────────────────────

function getContextSignature(character, session, settings) {
  const userName = session.user_name || settings.user_name || 'User';
  const personaId = session.persona_id || settings.active_persona_id || 'default';
  const activePersona = (settings.personas || []).find(p => p.id === personaId);

  const charData = {
    description: character.description || '',
    personality: character.personality ? `Personality: ${character.personality}` : '',
    scenario: character.scenario ? `Scenario: ${character.scenario}` : ''
  };
  const charText = [charData.description, charData.personality, charData.scenario].filter(Boolean).join('\n\n') || `You are ${character.name}.`;

  const memoryText = memoryService.getMemoryContext(character.id) || '';
  
  let systemBasePure = '';
  if (character.system_prompt) {
    systemBasePure = character.system_prompt;
    systemBasePure = systemBasePure.replace(/\{\{description\}\}/gi, '');
    systemBasePure = systemBasePure.replace(/\{\{personality\}\}/gi, '');
    systemBasePure = systemBasePure.replace(/\{\{scenario\}\}/gi, '');
  } else {
    const activePresetId = settings.active_system_prompt_preset_id;
    const presets = settings.system_prompt_presets || [];
    const activePreset = presets.find(p => p.id === activePresetId);
    if (activePreset) {
      systemBasePure = activePreset.content;
      systemBasePure = systemBasePure.replace(/\{\{description\}\}/gi, '');
      systemBasePure = systemBasePure.replace(/\{\{personality\}\}/gi, '');
      systemBasePure = systemBasePure.replace(/\{\{scenario\}\}/gi, '');
    }
  }

  const exMode = settings.example_messages_mode || 'chat';
  let exampleSystemText = '';

  if (character.message_examples && character.message_examples.trim() && exMode !== 'off') {
    const parsedEx = parseMessageExamples(character.message_examples, userName, character.name);
    if (exMode === 'system') {
      exampleSystemText = parsedEx.formattedSystemText;
    }
  }

  if (exampleSystemText) {
    systemBasePure += `\n\n${exampleSystemText}`;
  }

  systemBasePure = systemBasePure.replace(/\{\{user\}\}/gi, userName);
  systemBasePure = systemBasePure.replace(/\{\{char\}\}/gi, character.name);

  let systemContentPure = systemBasePure;
  if (activePersona && activePersona.description) {
    let personaStr = activePersona.description.replace(/\{\{user\}\}/gi, userName).replace(/\{\{char\}\}/gi, character.name);
    systemContentPure += `\n\n[USER PERSONA]\nThe user's persona is as follows. Treat the user as this persona:\n${personaStr}`;
  }

  const formattingInstructions = [];
  if (settings.response_length === 'short') {
    formattingInstructions.push("Write extremely short, brief, and concise responses. Limit yourself to 1-2 sentences maximum. No fluff.");
  } else if (settings.response_length === 'medium') {
    formattingInstructions.push("Write balanced, moderately detailed responses. Strictly limit your response to about 650 characters (letters and spaces) maximum.");
  } else if (settings.response_length === 'long') {
    formattingInstructions.push("Write very long, detailed, and expansive responses. Elaborate on everything and be as verbose as possible.");
  }

  if (settings.description_depth > 0) {
    const depthPrompts = [
      "",
      "Add brief descriptions of the scene.",
      "Include vivid and clear descriptions of the environment and atmosphere.",
      "Provide highly detailed and immersive scene descriptions with sensory details.",
      "Describe every scene with extreme detail and atmosphere, focusing on deep sensory information, textures, sounds, and intense character introspection. Be extremely descriptive."
    ];
    formattingInstructions.push(depthPrompts[settings.description_depth]);
  }

  if (formattingInstructions.length > 0) {
    systemContentPure += `\n\n[MANDATORY FORMATTING RULES]\n${formattingInstructions.join("\n")}`;
  }

  if (session.indicators?.enabled && session.indicators.list?.length > 0) {
    const statusStr = session.indicators.list.map(ind => `${ind.name}: ${ind.value}%`).join('\n');
    systemContentPure += `\n\n[CURRENT MOOD STATUS]\n${statusStr}`;
  }

  // Use summaryChunks total text length as part of signature
  const chunksText = (session.summaryChunks || []).map(c => c.text).join('');

  const messagesToCount = session.messages || [];
  const msgsSig = messagesToCount.map(m => {
    const contentText = m.role === 'user' ? (m.translated_content || m.content) : (m.original_text || m.content);
    return `${m.id}:${contentText ? contentText.length : 0}`;
  }).join(',');

  return `${charText.length}_${memoryText.length}_${systemContentPure.length}_${chunksText.length}_[${msgsSig}]`;
}

export async function updateContextIndicator(debounce = false, forceRecalculate = false) {
  const character = appState.currentCharacter;
  const session = appState.currentChat;

  if (!character || !session) {
    if (contextIndicator) contextIndicator.classList.add('hidden');
    return;
  }

  if (contextIndicator) contextIndicator.classList.remove('hidden');

  const settings = settingsStore.get();
  const currentSignature = getContextSignature(character, session, settings);

  // If we already have a saved breakdown with matching signature, we can restore from it
  if (!forceRecalculate && session._contextBreakdown && session._contextBreakdown.signature === currentSignature) {
    // Populate sessionBaseTokensCache if missing (e.g. after restart)
    if (!sessionBaseTokensCache.has(session.id)) {
      sessionBaseTokensCache.set(session.id, {
        baseTokens: session._contextBreakdown.baseTokens || (session._contextBreakdown.totalUsed - session._contextBreakdown.inputTokens),
        maxContext: session._contextBreakdown.maxContext,
        precise: session._contextBreakdown.precise
      });
    }
    
    // Update UI instantly using the saved breakdown
    const currentInputText = messageInput ? messageInput.value.trim() : '';
    let inputTokens = 0;
    if (currentInputText) {
      inputTokens = Math.ceil(currentInputText.length / (/[а-яА-ЯёЁ]/.test(currentInputText) ? 2.3 : 3.3));
    }
    
    const baseTokens = session._contextBreakdown.baseTokens || (session._contextBreakdown.totalUsed - session._contextBreakdown.inputTokens);
    const totalUsed = baseTokens + inputTokens;
    const usedPercent = Math.min(100, Math.max(0, (totalUsed / session._contextBreakdown.maxContext) * 100));
    const freePercent = Math.max(0, 100 - usedPercent);
    const freePercentRounded = Math.round(freePercent);

    if (donutSegment) {
      donutSegment.setAttribute('stroke-dasharray', `${usedPercent} 100`);
    }
    if (contextIndicator) {
      contextIndicator.setAttribute('data-tooltip', `${freePercentRounded}% free context`);

      contextIndicator.classList.remove('state-normal', 'state-warning', 'state-danger');
      if (freePercent < 5) {
        contextIndicator.classList.add('state-danger');
      } else if (freePercent < 20) {
        contextIndicator.classList.add('state-warning');
      } else {
        contextIndicator.classList.add('state-normal');
      }
    }

    session._contextBreakdown.inputTokens = inputTokens;
    session._contextBreakdown.inputText = currentInputText;
    session._contextBreakdown.totalUsed = totalUsed;
    return;
  }

  // Safety check: if currently generating, do not request token counting from the LLM backend
  // to avoid overloading/crashing KoboldCpp. Update UI instantly using cache if available.
  if (appState.isGenerating) {
    const cached = sessionBaseTokensCache.get(session.id);
    if (cached) {
      const currentInputText = messageInput ? messageInput.value.trim() : '';
      let inputTokens = 0;
      if (currentInputText) {
        inputTokens = Math.ceil(currentInputText.length / (/[а-яА-ЯёЁ]/.test(currentInputText) ? 2.3 : 3.3));
      }

      const totalUsed = cached.baseTokens + inputTokens;
      const usedPercent = Math.min(100, Math.max(0, (totalUsed / cached.maxContext) * 100));
      const freePercent = Math.max(0, 100 - usedPercent);
      const freePercentRounded = Math.round(freePercent);

      if (donutSegment) {
        donutSegment.setAttribute('stroke-dasharray', `${usedPercent} 100`);
      }
      if (contextIndicator) {
        contextIndicator.setAttribute('data-tooltip', `${freePercentRounded}% free context`);

        contextIndicator.classList.remove('state-normal', 'state-warning', 'state-danger');
        if (freePercent < 5) {
          contextIndicator.classList.add('state-danger');
        } else if (freePercent < 20) {
          contextIndicator.classList.add('state-warning');
        } else {
          contextIndicator.classList.add('state-normal');
        }
      }

      if (session._contextBreakdown) {
        session._contextBreakdown.inputTokens = inputTokens;
        session._contextBreakdown.inputText = currentInputText;
        session._contextBreakdown.totalUsed = totalUsed;
        session._contextBreakdown.precise = false; // Mark as approximate during active generation
      }
    }
    return;
  }

  // Handle typing mode (instantly update donut based on cached base context tokens)
  if (debounce) {
    const cached = sessionBaseTokensCache.get(session.id);
    if (cached) {
      const currentInputText = messageInput ? messageInput.value.trim() : '';
      let inputTokens = 0;
      if (currentInputText) {
        inputTokens = Math.ceil(currentInputText.length / (/[а-яА-ЯёЁ]/.test(currentInputText) ? 2.3 : 3.3));
      }

      const totalUsed = cached.baseTokens + inputTokens;
      const usedPercent = Math.min(100, Math.max(0, (totalUsed / cached.maxContext) * 100));
      const freePercent = Math.max(0, 100 - usedPercent);
      const freePercentRounded = Math.round(freePercent);

      if (donutSegment) {
        donutSegment.setAttribute('stroke-dasharray', `${usedPercent} 100`);
      }
      if (contextIndicator) {
        contextIndicator.setAttribute('data-tooltip', `${freePercentRounded}% free context`);

        contextIndicator.classList.remove('state-normal', 'state-warning', 'state-danger');
        if (freePercent < 5) {
          contextIndicator.classList.add('state-danger');
        } else if (freePercent < 20) {
          contextIndicator.classList.add('state-warning');
        } else {
          contextIndicator.classList.add('state-normal');
        }
      }

      if (session._contextBreakdown) {
        session._contextBreakdown.inputTokens = inputTokens;
        session._contextBreakdown.inputText = currentInputText;
        session._contextBreakdown.totalUsed = totalUsed;
        session._contextBreakdown.precise = cached.precise;
      }
      return;
    }
    
    // If no cache is found, debounce the full recalculation to avoid spamming the API on every keypress
    if (contextDebounceTimer) clearTimeout(contextDebounceTimer);
    contextDebounceTimer = setTimeout(() => {
      contextDebounceTimer = null;
      updateContextIndicator(false, forceRecalculate);
    }, 1000);
    return;
  }

  // Clear debounce timer if a full recalculation is run directly
  if (contextDebounceTimer) {
    clearTimeout(contextDebounceTimer);
    contextDebounceTimer = null;
  }

  if (forceRecalculate) {
    sessionBaseTokensCache.delete(session.id);
    tokenCountCache.clear();
  }

  // Abort any previous calculations that are still running!
  if (activeContextCalculationController) {
    activeContextCalculationController.abort();
  }
  activeContextCalculationController = new AbortController();
  const signal = activeContextCalculationController.signal;

  currentIndicatorCalcId++;
  const myCalcId = currentIndicatorCalcId;

  // Call the helper to do sliding window calculation and get accurate tokens
  const result = await computeContextAndTrimHistory(character, session, signal);
  if (myCalcId !== currentIndicatorCalcId) return;

  // Live input tokens
  const currentInputText = messageInput ? messageInput.value.trim() : '';
  let inputTokens = 0;
  if (currentInputText) {
    inputTokens = Math.ceil(currentInputText.length / (/[а-яА-ЯёЁ]/.test(currentInputText) ? 2.3 : 3.3));
  }

  // Save base tokens in memory cache
  sessionBaseTokensCache.set(session.id, {
    baseTokens: result.baseTokens,
    maxContext: result.maxContext,
    precise: result.precise
  });

  // Total Used and Free percentage
  const totalUsed = result.baseTokens + inputTokens;
  const usedPercent = Math.min(100, Math.max(0, (totalUsed / result.maxContext) * 100));
  const freePercent = Math.max(0, 100 - usedPercent);
  const freePercentRounded = Math.round(freePercent);

  // Update UI Elements
  if (donutSegment) {
    donutSegment.setAttribute('stroke-dasharray', `${usedPercent} 100`);
  }
  if (contextIndicator) {
    contextIndicator.setAttribute('data-tooltip', `${freePercentRounded}% free context`);

    contextIndicator.classList.remove('state-normal', 'state-warning', 'state-danger');
    if (freePercent < 5) {
      contextIndicator.classList.add('state-danger');
    } else if (freePercent < 20) {
      contextIndicator.classList.add('state-warning');
    } else {
      contextIndicator.classList.add('state-normal');
    }
  }

  // Update Recommendation Banner Visibility
  const recBanner = document.getElementById('auto-summary-recommendation');
  if (recBanner) {
    const hasSummary = session.summaryChunks && session.summaryChunks.length > 0;
    if (freePercent < 10 && !hasSummary && !session._autoSummaryDismissed && session.messages.length > 0) {
      recBanner.classList.remove('hidden');
    } else {
      recBanner.classList.add('hidden');
    }
  }

  // Cache breakdown details for the popup modal
  session._contextBreakdown = {
    maxContext: result.maxContext,
    charTokens: result.charTokens,
    charText: result.charText,
    systemTokens: result.systemTokens,
    systemText: result.systemText,
    memoryTokens: result.memoryTokens,
    memoryText: result.memoryText,
    summaryTokens: result.summaryTokens,
    summaryChunks: result.summaryChunks,
    fullHistoryTokens: result.fullHistoryTokens,
    fullContextTokens: result.fullContextTokens,
    historyTokens: result.historyTokens,
    historyItems: result.historyItems,
    unsummarizedMessages: result.unsummarizedMessages,
    inputTokens,
    inputText: currentInputText,
    totalUsed,
    precise: result.precise,
    signature: currentSignature,
    baseTokens: result.baseTokens
  };
}

export async function populateContextDetailsModal(session) {
  if (!session || !session._contextBreakdown) return;

  const breakdown = session._contextBreakdown;

  // Update accuracy badge status
  const accuracyBadge = document.getElementById('context-accuracy-badge');
  if (accuracyBadge) {
    if (breakdown.precise) {
      accuracyBadge.textContent = 'Precise';
      accuracyBadge.style.background = 'rgba(16, 185, 129, 0.15)';
      accuracyBadge.style.color = '#10b981';
      accuracyBadge.style.border = '1px solid rgba(16, 185, 129, 0.3)';
    } else {
      accuracyBadge.textContent = 'Approximate';
      accuracyBadge.style.background = 'rgba(245, 158, 11, 0.15)';
      accuracyBadge.style.color = '#f59e0b';
      accuracyBadge.style.border = '1px solid rgba(245, 158, 11, 0.3)';
    }
  }

  // 1. Populate summary totals
  if (contextTotalInfo) {
    if (breakdown.fullContextTokens && breakdown.fullContextTokens > breakdown.baseTokens) {
      const fullPct = Math.round((breakdown.fullContextTokens / breakdown.maxContext) * 100);
      contextTotalInfo.textContent = `${breakdown.baseTokens.toLocaleString()} / ${breakdown.maxContext.toLocaleString()} in window (${fullPct}% total chat history)`;
    } else {
      contextTotalInfo.textContent = `${breakdown.totalUsed.toLocaleString()} / ${breakdown.maxContext.toLocaleString()} tokens used`;
    }
  }
  const activePercent = breakdown.fullContextTokens || breakdown.totalUsed;
  const freePercent = Math.max(0, 100 - (activePercent / breakdown.maxContext) * 100);
  if (contextFreeInfo) {
    contextFreeInfo.textContent = `${Math.round(freePercent)}% free`;
    contextFreeInfo.style.color = freePercent < 5 ? 'var(--error)' : (freePercent < 20 ? 'var(--warning)' : 'var(--success)');
  }

  // 2. Set bar widths
  const getPercent = (val) => `${(val / breakdown.maxContext) * 100}%`;
  if (barCharCard) barCharCard.style.width = getPercent(breakdown.charTokens);
  if (barSystemPrompt) barSystemPrompt.style.width = getPercent(breakdown.systemTokens);
  if (barMemoryContext) barMemoryContext.style.width = getPercent(breakdown.memoryTokens);
  if (barAutoSummary) barAutoSummary.style.width = getPercent(breakdown.summaryTokens || 0);
  if (barChatHistory) barChatHistory.style.width = getPercent(breakdown.historyTokens);

  // 3. Update legend values
  if (legendCharCard) legendCharCard.textContent = `${breakdown.charTokens}t`;
  if (legendSystemPrompt) legendSystemPrompt.textContent = `${breakdown.systemTokens}t`;
  if (legendMemoryContext) legendMemoryContext.textContent = `${breakdown.memoryTokens}t`;
  if (legendAutoSummary) legendAutoSummary.textContent = `${breakdown.summaryTokens || 0}t`;
  if (legendChatHistory) legendChatHistory.textContent = `${breakdown.fullHistoryTokens || breakdown.historyTokens}t`;

  // 4. Update accordion badges
  if (badgeDetailsChar) badgeDetailsChar.textContent = `${breakdown.charTokens} tokens`;
  if (badgeDetailsSystem) badgeDetailsSystem.textContent = `${breakdown.systemTokens} tokens`;
  if (badgeDetailsMemory) badgeDetailsMemory.textContent = `${breakdown.memoryTokens} tokens`;
  if (badgeDetailsSummary) badgeDetailsSummary.textContent = `${breakdown.summaryTokens || 0} tokens`;
  if (badgeDetailsHistory) {
    if (breakdown.fullHistoryTokens && breakdown.fullHistoryTokens > breakdown.historyTokens) {
      badgeDetailsHistory.textContent = `${breakdown.fullHistoryTokens} tokens total (${breakdown.historyTokens} in window)`;
    } else {
      badgeDetailsHistory.textContent = `${breakdown.historyTokens} tokens`;
    }
  }

  // Update Auto Summary Settings & Indicator
  const settings = settingsStore.get();
  if (chkSummaryThinking) {
    chkSummaryThinking.checked = settings.summary_thinking_enabled ?? false;
  }
  if (selectSummaryLength) {
    selectSummaryLength.value = settings.summary_length || 'default';
  }
  if (selectSummaryMode) {
    selectSummaryMode.value = settings.summary_injection_mode || 'system';
  }

  if (btnAutoSummarizeAll) {
    const maxCtx = breakdown.maxContext || settings.context_window || 8192;
    const fullTokens = breakdown.fullContextTokens || breakdown.baseTokens || 0;
    const unsummarizedMsgs = breakdown.unsummarizedMessages || [];
    const needs = calculateSummaryNeeds(session, maxCtx, fullTokens, unsummarizedMsgs);

    btnAutoSummarizeAll.textContent = `${needs.doneCount}/${needs.totalNeeded}`;
    if (needs.needsMore) {
      const usedPct = Math.round((fullTokens / maxCtx) * 100);
      btnAutoSummarizeAll.title = `Full chat context usage is ${usedPct}% (exceeds 70% threshold). ${needs.totalNeeded - needs.doneCount} summary chunk(s) needed to bring history below 70%. Click to auto-generate.`;
      btnAutoSummarizeAll.style.borderColor = 'rgba(56, 189, 248, 0.5)';
      btnAutoSummarizeAll.style.color = '#38bdf8';
      btnAutoSummarizeAll.style.background = 'rgba(56, 189, 248, 0.15)';
    } else {
      const usedPct = Math.round((fullTokens / maxCtx) * 100);
      btnAutoSummarizeAll.title = `Full chat context usage is ${usedPct}% (below 70% threshold). No additional summaries needed (${needs.doneCount}/${needs.totalNeeded}).`;
      btnAutoSummarizeAll.style.borderColor = 'var(--border-light)';
      btnAutoSummarizeAll.style.color = 'var(--text-secondary)';
      btnAutoSummarizeAll.style.background = 'var(--bg-tertiary)';
    }
  }

  // Update Revert button visibility
  if (btnRevertAutoSummary) {
    const hasChunks = session.summaryChunks && session.summaryChunks.length > 0;
    btnRevertAutoSummary.style.display = hasChunks ? 'inline-block' : 'none';
  }

  // 5. Update content texts
  if (contentDetailsChar) contentDetailsChar.textContent = breakdown.charText || '(No character description fields configured)';
  if (contentDetailsSystem) contentDetailsSystem.textContent = breakdown.systemText || '(No system prompt or rules configured)';
  if (contentDetailsMemory) contentDetailsMemory.textContent = breakdown.memoryText || '(No memory context active)';

  // 6. Render summary chunks list
  const chunksList = document.getElementById('summary-chunks-list');
  if (chunksList) {
    chunksList.innerHTML = '';
    const chunks = breakdown.summaryChunks || [];
    if (chunks.length === 0) {
      chunksList.innerHTML = '<div style="padding:12px; color:var(--text-tertiary); font-size:var(--text-xs); text-align:center;">No summary chunks yet. Click [+] to create one.</div>';
    } else {
      chunks.forEach((chunk, idx) => {
        const card = document.createElement('div');
        card.style.cssText = 'border:1px solid var(--border-light); border-radius:6px; overflow:hidden; background:rgba(255,255,255,0.03);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:8px 10px; cursor:pointer; user-select:none;';

        const titleEl = document.createElement('span');
        titleEl.style.cssText = 'font-size:12px; color:var(--text-secondary); font-weight:500;';
        titleEl.textContent = `Chunk #${idx + 1}`;

        const rightEl = document.createElement('div');
        rightEl.style.cssText = 'display:flex; align-items:center; gap:8px;';

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '✕';
        deleteBtn.title = 'Delete this chunk';
        deleteBtn.style.cssText = 'background:transparent; border:none; color:var(--text-tertiary); cursor:pointer; font-size:11px; padding:2px 4px; border-radius:3px;';
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const currentSession = appState.currentChat;
          if (!currentSession) return;
          currentSession.summaryChunks = (currentSession.summaryChunks || []).filter(c => c.id !== chunk.id);
          await chatStore.saveSession(currentSession);
          showToast('Summary chunk deleted.', 'info');
          await updateContextIndicator(false, true);
          populateContextDetailsModal(currentSession);
        });

        const expandIcon = document.createElement('span');
        expandIcon.style.cssText = 'font-size:10px; color:var(--text-tertiary); transition:transform 0.2s;';
        expandIcon.textContent = '▶';

        rightEl.appendChild(deleteBtn);
        rightEl.appendChild(expandIcon);
        header.appendChild(titleEl);
        header.appendChild(rightEl);

        const body = document.createElement('div');
        body.style.cssText = 'padding:10px; border-top:1px solid var(--border-light); font-size:12px; color:var(--text-secondary); line-height:1.5; white-space:pre-wrap; font-family:var(--font-sans); display:none;';
        body.textContent = chunk.text;

        header.addEventListener('click', () => {
          const isOpen = body.style.display !== 'none';
          body.style.display = isOpen ? 'none' : 'block';
          expandIcon.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
        });

        card.appendChild(header);
        card.appendChild(body);
        chunksList.appendChild(card);
      });
    }
  }

  // 6. Populate history messages list
  if (contentDetailsHistory) {
    contentDetailsHistory.innerHTML = '';
    if (breakdown.historyItems.length === 0) {
      contentDetailsHistory.innerHTML = '<div style="padding:12px; color:var(--text-tertiary); font-size:var(--text-xs); text-align:center;">No chat messages yet</div>';
    } else {
      breakdown.historyItems.forEach((item, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = `context-history-item role-${item.role}`;
        let displayVal = item.text;

        itemEl.innerHTML = `
          <div class="context-history-item-header">
            <span>#${index + 1} · ${item.role}</span>
            <span>${item.tokens} tokens</span>
          </div>
          <div class="context-history-item-body">${escapeHtml(displayVal)}</div>
        `;
        contentDetailsHistory.appendChild(itemEl);
      });
    }
  }

  // 7. Populate Lorebooks list (Max potential budget)
  const contentDetailsLorebooks = document.getElementById('content-details-lorebooks');
  const badgeDetailsLorebooks = document.getElementById('badge-details-lorebooks');
  
  if (contentDetailsLorebooks && badgeDetailsLorebooks) {
    const activeSessionId = session.id || 'default';
    let activeState = {};
    try {
      const savedState = await idbGet(`llmchat_active_lorebooks_${activeSessionId}`);
      if (savedState) activeState = JSON.parse(savedState);
    } catch (e) {
      console.warn("Failed to get active lorebooks for context modal", e);
    }
    
    const allBooks = typeof lorebookStore !== 'undefined' ? lorebookStore.getAll() : [];
    const activeBooks = allBooks.filter(b => activeState[b.id]);
    
    contentDetailsLorebooks.innerHTML = '';
    
    if (activeBooks.length === 0) {
      contentDetailsLorebooks.innerHTML = '<div style="padding:12px; color:var(--text-tertiary); font-size:var(--text-xs); text-align:center;">No active Lorebooks</div>';
      badgeDetailsLorebooks.textContent = '0 max tokens';
    } else {
      let totalMaxTokens = 0;
      
      activeBooks.forEach((book, index) => {
        let bookMaxTokens = 0;
        if (book.entries) {
          book.entries.forEach(entry => {
            if (!entry.enabled) return;
            const text = entry.content || '';
            const estimatedTokens = Math.ceil(text.length / (/[а-яА-ЯёЁ]/.test(text) ? 2.3 : 3.3));
            bookMaxTokens += estimatedTokens;
          });
        }
        totalMaxTokens += bookMaxTokens;
        
        const card = document.createElement('div');
        card.style.cssText = 'border:1px solid var(--border-light); border-radius:6px; overflow:hidden; background:rgba(255,255,255,0.03);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:8px 10px; cursor:pointer; user-select:none;';

        const titleEl = document.createElement('span');
        titleEl.style.cssText = 'font-size:12px; color:var(--text-secondary); font-weight:500;';
        titleEl.textContent = book.name;

        const rightEl = document.createElement('div');
        rightEl.style.cssText = 'display:flex; align-items:center; gap:8px;';

        const badgeEl = document.createElement('span');
        badgeEl.style.cssText = 'font-size:11px; color:var(--text-tertiary); background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px;';
        badgeEl.textContent = `~${bookMaxTokens} max tokens`;

        const expandIcon = document.createElement('span');
        expandIcon.style.cssText = 'font-size:10px; color:var(--text-tertiary); transition:transform 0.2s;';
        expandIcon.textContent = '▶';

        rightEl.appendChild(badgeEl);
        rightEl.appendChild(expandIcon);
        header.appendChild(titleEl);
        header.appendChild(rightEl);

        const body = document.createElement('div');
        body.style.cssText = 'padding:10px; border-top:1px solid var(--border-light); font-size:12px; color:var(--text-secondary); line-height:1.5; white-space:pre-wrap; font-family:var(--font-sans); display:none;';
        body.textContent = `${book.entries?.length || 0} entries loaded.`;

        header.addEventListener('click', () => {
          const isOpen = body.style.display !== 'none';
          body.style.display = isOpen ? 'none' : 'block';
          expandIcon.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
        });

        card.appendChild(header);
        card.appendChild(body);
        contentDetailsLorebooks.appendChild(card);
      });
      
      badgeDetailsLorebooks.textContent = `~${totalMaxTokens} max tokens`;
    }
  }
}

window.updateContextIndicator = updateContextIndicator;


