/* ════════════════════════════════════════════════════════════════════
   GenAI Panel — Universal In-App Assistant
   ════════════════════════════════════════════════════════════════════ */

import { api } from '../services/api.js';
import { settingsStore } from '../services/settings-store.js';
import { characterStore } from '../services/character-store.js';
import { chatStore } from '../services/chat-store.js';
import { appState } from '../state.js';
import { renderMarkdown, autoResizeTextarea, formatTime, injectCursor } from '../utils/helpers.js';

// ─── State ──────────────────────────────────────────────────────────
const STORAGE_KEY = 'vibechat_genai_history';
let genaiHistory = [];   // {role, content, badges?:[]}
let isGenerating = false;
let abortController = null;
let vibeMode = null;     // {goal, iterations, maxIterations, aborted}

// ─── DOM refs ───────────────────────────────────────────────────────
let messagesEl, inputEl, sendBtn, clearBtn, closeBtn;

// ─── System Prompt ──────────────────────────────────────────────────
const BASE_SYSTEM_PROMPT = `You are GenAI — a personal assistant with no gender identity - built into VibeChatting, an AI roleplay chat app.
You have deep access to all app data and settings. Be warm, friendly like a best friend. Use emojis, especially the "😄", "😏". Also use "👉" for bullet lists, don't use this pointing finger emoji for anything else. Be concise.
In the start of the chat you should subtly hint to the user's open chat with a character if there is one. If some name was mentioned by user, first you MUST get information about the character and then reply. 
before you send the JSON request you MUST inform the user. (for example: user: "you know about Lena?" -> GenAI: "Alright, let me check... {json}")

What you can't do: generate pictures, write and review books in this app. You should say that this is in the work right now and will be available in the future.

FUNCTION CALLS: You can call app functions by emitting a single-line JSON object. After emitting a function call JSON, STOP generating immediately — do not write anything after it. Wait for the result to be injected.

FORMAT (one line, nothing else on that line):
{"genai_action":"<name>",...params}

AVAILABLE ACTIONS (described in [APP CONTEXT] below).`;

// ─── Settings metadata ──────────────────────────────────────────────
const SETTING_META = {
  ai_comments_enabled: { label: 'AI Comments', type: 'bool' },
  suggestions_enabled: { label: 'AI Suggestions', type: 'bool' },
  auto_translate: { label: 'Auto Translation', type: 'bool' },
  translate_user_messages: { label: 'Translate User Input', type: 'bool' },
  memory_enabled: { label: 'Auto Memory', type: 'bool' },
  italic_asterisks: { label: 'Italicize Actions (*)', type: 'bool' },
  target_language: { label: 'AI Output Language', type: 'string' },
  outgoing_target_language: { label: 'User Input Target Lang', type: 'string' },
  suggestions_language: { label: 'Suggestions Language', type: 'string' },
  ai_comments_language: { label: 'AI Comment Language', type: 'string' },
  user_name: { label: "User's Name", type: 'string' },
  font_size: { label: 'Font Size (px)', type: 'number' },
  response_length: { label: 'Response Length', type: 'enum', values: ['auto', 'short', 'medium', 'long'] },
  max_tokens: { label: 'Max Tokens', type: 'number' },
  temperature: { label: 'Temperature', type: 'number' },
};

function buildContext(trimActiveChat = false) {
  const settings = settingsStore.get();
  const characters = characterStore.getAll();
  const session = chatStore.getCurrentSession();
  const parts = [];

  // Characters list
  parts.push('## Characters:');
  characters.forEach(c => {
    const ago = c.last_chat_at ? `last chat ${formatTime(c.last_chat_at)}` : 'no chats';
    parts.push(`- "${c.name}" (id: ${c.id}) — ${ago}`);
  });

  // Active chat
  if (session && appState.currentCharacter) {
    parts.push(`\n## Active Chat — Character: ${appState.currentCharacter.name}`);
    if (trimActiveChat) {
      parts.push(`  (Chat history omitted due to token limit)`);
    } else {
      const recent = session.messages.slice(-6);
      recent.forEach(m => {
        const who = m.role === 'user' ? (settings.user_name || 'User') : appState.currentCharacter.name;
        const text = (m.content || '').substring(0, 120).replace(/\n/g, ' ');
        parts.push(`  ${who}: ${text}`);
      });
      if (session.ai_comments?.length) {
        parts.push(`  (${session.ai_comments.length} AI comments in this session)`);
      }
    }
  } else {
    parts.push('\n## Active Chat: none');
  }

  // Settings
  parts.push('\n## App Settings (current values):');
  for (const [key, meta] of Object.entries(SETTING_META)) {
    const val = settings[key];
    const display = typeof val === 'boolean' ? (val ? 'ON' : 'OFF') : String(val ?? '');
    parts.push(`- ${meta.label} [key: ${key}] = ${display}`);
  }

  // Actions
  parts.push(`\n## Available Function Calls:
1. get_character — Get full character card
   {"genai_action":"get_character","id":"<character_id>"}

2. get_chat_history — Get messages from a character's chat
   {"genai_action":"get_chat_history","character_id":"<id>"}

3. get_ai_comments — Get AI comment history for active session
   {"genai_action":"get_ai_comments"}

4. set_setting — Change an app setting
   {"genai_action":"set_setting","key":"<setting_key>","value":<value>}

5. send_chat_message — Write a message to the active chat AS the user (for plot mode)
   {"genai_action":"send_chat_message","content":"<message>"}

6. check_vibe_goal — Check if a goal is achieved given recent chat messages
   {"genai_action":"check_vibe_goal","goal":"<goal>","context":"<recent messages>"}

IMPORTANT: After ANY function call JSON, stop generating. The result will be appended and you will be asked to continue.`);

  return '[APP CONTEXT]\n' + parts.join('\n');
}

// ─── Build API Messages ─────────────────────────────────────────────
function buildApiMessages() {
  const settings = settingsStore.get();
  const charLimit = (settings.prompt_token_limit || 4096) * 4;

  let context = buildContext(false);
  let systemContent = BASE_SYSTEM_PROMPT + '\n\n' + context;
  let historyMsgs = genaiHistory.map(e => ({ role: e.role, content: e.content }));

  let totalLen = systemContent.length + historyMsgs.reduce((sum, m) => sum + (m.content || '').length, 0);

  // 1. Truncate active chat history if over limit
  if (totalLen > charLimit) {
    context = buildContext(true);
    systemContent = BASE_SYSTEM_PROMPT + '\n\n' + context;
    totalLen = systemContent.length + historyMsgs.reduce((sum, m) => sum + (m.content || '').length, 0);
  }

  // 2. Truncate GenAI history if still over limit
  if (totalLen > charLimit) {
    // Keep at least the last 2 messages (user's latest query)
    while (totalLen > charLimit && historyMsgs.length > 2) {
      const removed = historyMsgs.shift();
      totalLen -= (removed.content || '').length;
    }
  }

  return [{ role: 'system', content: systemContent }, ...historyMsgs];
}

// ─── Tool Executor ──────────────────────────────────────────────────
async function executeTool(action) {
  const { genai_action: name } = action;

  if (name === 'get_character') {
    const char = characterStore.getById(action.id);
    if (!char) return { error: `Character with id "${action.id}" not found.` };
    return {
      name: char.name,
      description: char.description,
      personality: char.personality,
      scenario: char.scenario,
      system_prompt: char.system_prompt,
      first_message: char.first_message?.substring(0, 300),
      alternate_greetings_count: (char.alternate_greetings || []).length,
    };
  }

  if (name === 'get_chat_history') {
    const sessions = chatStore.getSessions(action.character_id);
    if (!sessions.length) return { error: 'No chat sessions found for this character.' };
    const s = sessions[0];
    return {
      session_id: s.id,
      created_at: s.created_at,
      message_count: s.messages.length,
      messages: s.messages.map(m => ({
        role: m.role,
        content: (m.content || '').substring(0, 200),
      })),
      ai_comments: (s.ai_comments || []).map(c => ({
        snippet: c.target_content_snippet,
        comment: c.content.substring(0, 150),
      })),
    };
  }

  if (name === 'get_ai_comments') {
    const session = chatStore.getCurrentSession();
    if (!session || !session.ai_comments?.length) return { comments: [] };
    return {
      comments: session.ai_comments.map(c => ({
        snippet: c.target_content_snippet,
        comment: c.content,
        time: c.timestamp,
      }))
    };
  }

  if (name === 'set_setting') {
    const { key, value } = action;
    if (!SETTING_META[key]) return { error: `Unknown setting key: "${key}"` };
    const current = settingsStore.get();
    await settingsStore.save({ ...current, [key]: value });
    // Apply side effects
    if (key === 'italic_asterisks') document.body.classList.toggle('settings-italic-asterisks', !!value);
    if (key === 'ai_comments_enabled') document.body.classList.toggle('ai-comments-enabled', !!value);
    if (key === 'font_size') document.documentElement.style.setProperty('--text-base', `${value / 16}rem`);
    return { success: true, key, new_value: value };
  }

  if (name === 'send_chat_message') {
    const { content } = action;
    if (!appState.currentCharacter) return { error: 'No active character selected.' };
    if (!content) return { error: 'Message content is empty.' };
    // Dispatch to chat — programmatic send
    window.dispatchEvent(new CustomEvent('genai-send-chat-message', { detail: { content } }));
    return { success: true, sent: content };
  }

  if (name === 'check_vibe_goal') {
    const { goal, context } = action;
    // Ask the model to evaluate
    const evalMsgs = [
      { role: 'system', content: 'You are a goal checker. Given a goal and recent chat context, respond with ONLY "ACHIEVED" or "NOT_ACHIEVED".' },
      { role: 'user', content: `Goal: ${goal}\n\nRecent chat:\n${context}` }
    ];
    try {
      const result = await api.chatCompletion(evalMsgs, { max_tokens: 10, temperature: 0 });
      const achieved = result.trim().includes('ACHIEVED') && !result.trim().includes('NOT_ACHIEVED');
      return { goal_achieved: achieved, evaluation: result.trim() };
    } catch (e) {
      return { error: e.message };
    }
  }

  return { error: `Unknown action: ${name}` };
}

// ─── Action Badge HTML ───────────────────────────────────────────────
function actionBadgeHtml(type, icon, text) {
  return `<div class="genai-action-badge ${type}"><span class="genai-action-badge-icon">${icon}</span><span class="genai-action-badge-text">${text}</span></div>`;
}

function workingBadgeHtml() {
  return `<div class="genai-action-badge working" id="genai-working-badge"><span class="genai-action-badge-icon">⚙️</span><span>Working...</span><div class="genai-working-dots"><span></span><span></span><span></span></div></div>`;
}

function resultBadgeForAction(action, result) {
  const name = action.genai_action;
  if (name === 'get_character') return actionBadgeHtml('result-data', '📖', `Loaded character: ${result.name || action.id}`);
  if (name === 'get_chat_history') return actionBadgeHtml('result-data', '💬', `Loaded ${result.message_count || 0} messages from chat`);
  if (name === 'get_ai_comments') return actionBadgeHtml('result-data', '🗨️', `Loaded ${(result.comments || []).length} AI comments`);
  if (name === 'set_setting') {
    const meta = SETTING_META[result.key];
    const label = meta ? meta.label : result.key;
    const val = typeof result.new_value === 'boolean' ? (result.new_value ? 'ON' : 'OFF') : String(result.new_value);
    return actionBadgeHtml('result-setting', '✅', `${label} → ${val}`);
  }
  if (name === 'send_chat_message') return actionBadgeHtml('result-message', '✉️', `Sent: "${(action.content || '').substring(0, 50)}"`);
  if (name === 'check_vibe_goal') {
    return result.goal_achieved
      ? actionBadgeHtml('result-goal-met', '🏆', 'Goal achieved!')
      : actionBadgeHtml('result-goal-pending', '⏳', 'Goal not yet achieved, continuing...');
  }
  return actionBadgeHtml('result-data', '🔧', 'Action completed');
}

// ─── Message Rendering ───────────────────────────────────────────────
function renderMessages() {
  if (!messagesEl) return;
  messagesEl.innerHTML = '';

  if (genaiHistory.length === 0) {
    messagesEl.innerHTML = `
      <div class="genai-empty-state">
        <div class="genai-empty-icon">✨</div>
        <p>Hi! I'm GenAI—your virtual friend🤖<br>I can tell you about characters, change settings, and even chat on your behalf!</p>
      </div>`;
    return;
  }

  for (const entry of genaiHistory) {
    if (entry.role === 'system') continue; // skip injected tool results
    appendMsgEl(entry);
  }
  scrollToBottom();
}

function appendMsgEl(entry) {
  if (entry.role === 'system') return;
  const isUser = entry.role === 'user';
  const el = document.createElement('div');
  el.className = `genai-msg ${isUser ? 'genai-user' : 'genai-assistant'}`;

  const avatarHtml = isUser
    ? `<div class="genai-msg-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg></div>`
    : `<div class="genai-msg-avatar">✨</div>`;

  const badgesHtml = (entry.badges || []).map(b => b).join('');

  el.innerHTML = `
    ${avatarHtml}
    <div class="genai-msg-body">
      <div class="genai-msg-bubble">${badgesHtml}${renderMarkdown(entry.content || '')}</div>
      <div class="genai-msg-time">${formatTime(entry.timestamp || new Date().toISOString())}</div>
    </div>`;
  messagesEl.appendChild(el);
  return el;
}

function scrollToBottom() {
  requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
}

// ─── Streaming with tool detection ──────────────────────────────────
const JSON_ACTION_RE = /\{"genai_action"\s*:\s*"[^"]+?"[^}]*\}/;

async function streamGenAI(extraUserInstruction = null) {
  if (isGenerating) return;
  isGenerating = true;
  sendBtn.disabled = true;

  abortController = new AbortController();
  const apiMessages = buildApiMessages();
  if (extraUserInstruction) {
    apiMessages.push({ role: 'user', content: extraUserInstruction });
  }

  // Add placeholder entry for the assistant
  const assistantEntry = { role: 'assistant', content: '', badges: [], timestamp: new Date().toISOString() };
  genaiHistory.push(assistantEntry);

  // Render placeholder bubble
  const empty = messagesEl.querySelector('.genai-empty-state');
  if (empty) empty.remove();
  const msgEl = appendMsgEl(assistantEntry);
  const bubbleEl = msgEl?.querySelector('.genai-msg-bubble');
  const bodyEl = msgEl?.querySelector('.genai-msg-body');
  scrollToBottom();

  let fullText = '';
  let actionDetected = null;

  try {
    await api.streamChat(
      apiMessages,
      abortController.signal,
      (chunk) => {
        fullText += chunk;

        // Detect JSON action mid-stream
        const match = fullText.match(JSON_ACTION_RE);
        if (match && !actionDetected) {
          actionDetected = match[0];
          // Show only the text before the JSON
          const before = fullText.substring(0, fullText.indexOf(actionDetected)).trim();
          assistantEntry.content = before;
          if (bubbleEl) {
            const badgesHtml = (assistantEntry.badges || []).join('');
            bubbleEl.innerHTML = badgesHtml + injectCursor(renderMarkdown(before));
          }
          // Abort the stream — we have what we need
          abortController.abort();
          return;
        }

        let displayContent = fullText;
        let showWorking = false;
        const braceIndex = fullText.lastIndexOf('{');
        // Check if the { is at the start or after a newline, and looks like our action
        if (braceIndex !== -1 && (braceIndex === 0 || fullText[braceIndex - 1] === '\n')) {
          const afterBrace = fullText.substring(braceIndex);
          if ('{"genai_action"'.startsWith(afterBrace) || afterBrace.startsWith('{"genai_action"')) {
            displayContent = fullText.substring(0, braceIndex).trim();
            showWorking = true;
          }
        }

        if (!actionDetected) {
          // Normal streaming update
          assistantEntry.content = displayContent;
          if (bubbleEl) {
            const badgesHtml = (assistantEntry.badges || []).join('');
            const wBadge = showWorking ? workingBadgeHtml() : '';
            bubbleEl.innerHTML = badgesHtml + wBadge + injectCursor(renderMarkdown(displayContent));
          }
          scrollToBottom();
        }
      },
      async () => {
        // onDone
        if (actionDetected) {
          await handleActionDetected(actionDetected, assistantEntry, bodyEl, bubbleEl);
        } else {
          // Normal finish
          assistantEntry.content = fullText;
          if (bubbleEl) {
            const badgesHtml = (assistantEntry.badges || []).join('');
            bubbleEl.innerHTML = badgesHtml + renderMarkdown(fullText);
          }
          saveHistory();
        }
        finishGeneration();
      },
      (err) => {
        if (err.name === 'AbortError' && actionDetected) {
          // Expected abort due to action detection — handled in onDone via the abort path
          handleActionDetected(actionDetected, assistantEntry, bodyEl, bubbleEl).then(finishGeneration);
        } else if (err.name !== 'AbortError') {
          if (bubbleEl) bubbleEl.innerHTML = `<span style="color:var(--error)">Error: ${err.message}</span>`;
          finishGeneration();
        } else {
          finishGeneration();
        }
      }
    );
  } catch (e) {
    finishGeneration();
  }
}

async function handleActionDetected(actionStr, assistantEntry, bodyEl, bubbleEl) {
  let action;
  try { action = JSON.parse(actionStr); } catch { return; }

  // Show working badge during execution
  if (bubbleEl) {
    const badgesHtml = (assistantEntry.badges || []).join('');
    bubbleEl.innerHTML = badgesHtml + workingBadgeHtml() + injectCursor(renderMarkdown(assistantEntry.content));
  }
  scrollToBottom();

  // Execute tool
  const result = await executeTool(action);

  // Insert result badge
  const badgeHtml = resultBadgeForAction(action, result);
  assistantEntry.badges = assistantEntry.badges || [];
  assistantEntry.badges.push(badgeHtml);

  // Update bubble with new badge
  if (bubbleEl) {
    const badgesHtml = assistantEntry.badges.join('');
    bubbleEl.innerHTML = badgesHtml + injectCursor(renderMarkdown(assistantEntry.content));
  }

  // Inject tool result into history as system message (hidden)
  const resultStr = JSON.stringify(result, null, 2);
  genaiHistory.push({
    role: 'system',
    content: `[TOOL RESULT for ${action.genai_action}]\n${resultStr}`
  });

  saveHistory();

  // Check vibe mode goal result
  if (action.genai_action === 'check_vibe_goal' && vibeMode) {
    if (result.goal_achieved) {
      vibeMode = null;
      removeVibeBanner();
      // Continue response — goal met
      isGenerating = false;
      await streamGenAI('The goal has been achieved! Tell the user about the success in a celebratory way. 🎉');
      return;
    } else if (vibeMode.iterations < vibeMode.maxIterations && !vibeMode.aborted) {
      vibeMode.iterations++;
      isGenerating = false;
      await streamGenAI('The goal is not yet achieved. Continue the plot — send the next appropriate chat message using send_chat_message. Be strategic.');
      return;
    } else {
      vibeMode = null;
      removeVibeBanner();
      isGenerating = false;
      await streamGenAI('The maximum number of iterations was reached without achieving the goal. Inform the user.');
      return;
    }
  }

  // Continue response after tool result
  isGenerating = false;
  abortController = new AbortController();
  await continueAfterTool(assistantEntry, bubbleEl);
}

async function continueAfterTool(assistantEntry, bubbleEl) {
  if (isGenerating) return;
  isGenerating = true;

  abortController = new AbortController();
  const apiMessages = buildApiMessages();
  apiMessages.push({ role: 'user', content: 'Continue your response naturally based on the tool result.' });

  let continuationText = '';
  let newActionDetected = null;

  try {
    await api.streamChat(
      apiMessages,
      abortController.signal,
      (chunk) => {
        continuationText += chunk;
        const match = continuationText.match(JSON_ACTION_RE);
        if (match && !newActionDetected) {
          newActionDetected = match[0];
          abortController.abort();
          return;
        }
        const combined = (assistantEntry.content ? assistantEntry.content + '\n\n' : '') + continuationText;
        if (bubbleEl) {
          const badgesHtml = (assistantEntry.badges || []).join('');
          bubbleEl.innerHTML = badgesHtml + injectCursor(renderMarkdown(combined));
        }
        scrollToBottom();
      },
      async () => {
        const combined = (assistantEntry.content ? assistantEntry.content + '\n\n' : '') + continuationText;
        assistantEntry.content = combined;
        if (bubbleEl) {
          const badgesHtml = (assistantEntry.badges || []).join('');
          bubbleEl.innerHTML = badgesHtml + renderMarkdown(combined);
        }

        if (newActionDetected) {
          // Another tool call chained
          genaiHistory.push({ role: 'assistant', content: combined, badges: [], timestamp: new Date().toISOString() });
          const newEntry = genaiHistory[genaiHistory.length - 1];
          await handleActionDetected(newActionDetected, newEntry, bubbleEl?.closest('.genai-msg-body'), bubbleEl);
        } else {
          saveHistory();
        }
        finishGeneration();
      },
      (err) => {
        if (err.name === 'AbortError' && newActionDetected) {
          const combined = (assistantEntry.content ? assistantEntry.content + '\n\n' : '') + continuationText;
          assistantEntry.content = combined;
          genaiHistory.push({ role: 'assistant', content: combined, badges: [], timestamp: new Date().toISOString() });
          const newEntry = genaiHistory[genaiHistory.length - 1];
          handleActionDetected(newActionDetected, newEntry, null, null).then(finishGeneration);
        } else {
          finishGeneration();
        }
      }
    );
  } catch { finishGeneration(); }
}

function finishGeneration() {
  isGenerating = false;
  abortController = null;
  if (sendBtn) sendBtn.disabled = false;
}

// ─── Vibe Mode Banner ────────────────────────────────────────────────
function showVibeBanner(goal) {
  removeVibeBanner();
  const banner = document.createElement('div');
  banner.id = 'genai-vibe-banner';
  banner.className = 'genai-vibe-mode-banner';
  banner.innerHTML = `<div class="genai-vibe-spinner"></div><span>🎭 Playing out: <em>${goal}</em></span><button id="btn-genai-stop-vibe">Stop</button>`;
  messagesEl.appendChild(banner);
  banner.querySelector('#btn-genai-stop-vibe').addEventListener('click', () => {
    if (vibeMode) vibeMode.aborted = true;
    if (abortController) abortController.abort();
    vibeMode = null;
    removeVibeBanner();
  });
  scrollToBottom();
}

function removeVibeBanner() {
  document.getElementById('genai-vibe-banner')?.remove();
}

// ─── History persistence ─────────────────────────────────────────────
function saveHistory() {
  try {
    // Only save user/assistant entries (not system tool results)
    const toSave = genaiHistory.filter(e => e.role !== 'system');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) { }
}

function loadHistory() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) genaiHistory = JSON.parse(saved);
  } catch (e) { genaiHistory = []; }
}

// ─── Send User Message ───────────────────────────────────────────────
async function sendUserMessage() {
  const text = inputEl.value.trim();
  if (!text || isGenerating) return;

  inputEl.value = '';
  autoResizeTextarea(inputEl);

  // Remove empty state
  messagesEl.querySelector('.genai-empty-state')?.remove();

  // Add user entry
  const userEntry = { role: 'user', content: text, timestamp: new Date().toISOString() };
  genaiHistory.push(userEntry);
  appendMsgEl(userEntry);
  scrollToBottom();

  await streamGenAI();
}

// ─── Init ────────────────────────────────────────────────────────────
export function initGenAIPanel() {
  messagesEl = document.getElementById('genai-messages');
  inputEl = document.getElementById('genai-input');
  sendBtn = document.getElementById('btn-genai-send');
  clearBtn = document.getElementById('btn-genai-clear');
  closeBtn = document.getElementById('btn-close-genai');

  if (!messagesEl || !inputEl) return;

  loadHistory();
  renderMessages();

  sendBtn.addEventListener('click', sendUserMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendUserMessage(); }
  });
  inputEl.addEventListener('input', () => autoResizeTextarea(inputEl));

  clearBtn?.addEventListener('click', () => {
    genaiHistory = [];
    saveHistory();
    renderMessages();
  });

  closeBtn?.addEventListener('click', () => {
    document.body.classList.remove('genai-sidebar-open');
  });

  // Listen for chat message responses (from send_chat_message tool)
  window.addEventListener('genai-chat-response-ready', async (e) => {
    if (!vibeMode || vibeMode.aborted) return;
    const { response, characterName } = e.detail;
    // After chat responds, check goal
    const session = chatStore.getCurrentSession();
    const recent = session?.messages.slice(-6).map(m => {
      const who = m.role === 'user' ? (settingsStore.get().user_name || 'User') : (characterName || 'Character');
      return `${who}: ${(m.content || '').substring(0, 200)}`;
    }).join('\n') || '';

    if (!isGenerating) {
      genaiHistory.push({ role: 'user', content: `[VIBE CHECK] Goal: ${vibeMode.goal}\nRecent chat:\n${recent}`, timestamp: new Date().toISOString() });
      await streamGenAI(`Check if the vibe goal has been achieved using check_vibe_goal. Goal: "${vibeMode.goal}". Context:\n${recent}`);
    }
  });
}

// ─── Open / Close helpers (called from main.js) ───────────────────────
export function openGenAIPanel() {
  const mainContent = document.getElementById('main-content');
  const sidebar = document.getElementById('genai-sidebar');
  if (sidebar) {
    sidebar.classList.remove('hidden');
    sidebar.classList.remove('panel-bounce');
    void sidebar.offsetWidth;
    sidebar.classList.add('panel-bounce');
  }
  if (mainContent) mainContent.classList.add('is-animating');

  document.body.classList.add('genai-sidebar-open');
  renderMessages();

  setTimeout(() => {
    if (mainContent) mainContent.classList.remove('is-animating');
  }, 600);
}

export function closeGenAIPanel() {
  const mainContent = document.getElementById('main-content');
  if (mainContent) mainContent.classList.add('is-animating');

  document.body.classList.remove('genai-sidebar-open');

  setTimeout(() => {
    if (mainContent) mainContent.classList.remove('is-animating');
    const sidebar = document.getElementById('genai-sidebar');
    if (sidebar) sidebar.classList.add('hidden');
  }, 600);
}

// ─── Used by chat.js to notify GenAI that a vibe response arrived ─────
export function notifyGenAIResponse(response, characterName) {
  if (!vibeMode || vibeMode.aborted) return;
  window.dispatchEvent(new CustomEvent('genai-chat-response-ready', {
    detail: { response, characterName }
  }));
}

// ─── Start vibe mode (called externally if needed) ────────────────────
export function startVibeMode(goal) {
  vibeMode = { goal, iterations: 0, maxIterations: 10, aborted: false };
  showVibeBanner(goal);
}
