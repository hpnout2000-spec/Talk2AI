# VibeChatting — Architecture & Project Context

> **For AI Assistants:** Read this file at the start of any new session/conversation to gain an immediate, 100% complete understanding of the codebase structure, design system, UI mechanics, and state management.

---

## 1. Application Overview
**VibeChatting** is a desktop LLM frontend built with **Vanilla HTML/CSS/JavaScript (ES Modules)** and packaged with **Tauri**. It provides a glassmorphic dark-theme UI with real-time token streaming, multi-agent AI features, RPG game engine, book co-writer, and a universal assistant (*GenAI*).

---

## 2. Directory & Component Map

### `src/`
- **`index.html`** — Single Page Application shell containing:
  - Left collapsible sidebar (`#sidebar.sidebar`)
  - Main chat area (`#main-content.main-content`) with absolute floating liquid glass header (`.chat-header`)
  - Right sliding panels (`#genai-sidebar`, `#ai-comments-sidebar`)
  - Modals (Settings, Personas, Character Creator, Advanced Settings, GenAI Skills, Lightbox)
- **`main.js`** — Main entry point:
  - Initializes all modules, stores, window controls (Tauri), and settings.
  - Controls **Left Sidebar** collapse/expand (`toggleLeftSidebar()`, persistent via `localStorage`).
  - Controls **User Persona Morphing Container** (`#user-name-morph-container`).
  - Manages Personas modal & settings synchronization.

### `src/components/`
- **`chat.js`** — Core chat engine:
  - Message rendering, real-time streaming parser, swipe actions, branch navigation.
  - Avatar rendering, quick action tooltips, AI commenter, suggester.
  - Right sidebar header toggle button listener (`#btn-toggle-genai-header`).
- **`character-panel.js`** — Character management:
  - Character cards, SillyTavern JSON/PNG card import/export, alternate greetings, token counters.
- **`genai-panel.js`** — GenAI assistant panel:
  - Universal assistant, tool executor, web search integration (SearXNG/Tavily), active skill manager, memory queries.
  - Fullscreen expansion (`#btn-genai-fullscreen`, `body.genai-fullscreen`).
  - Slide-in panel lifecycle (`openGenAIPanel()`, `closeGenAIPanel()`).
- **`group-chat-view.js`** — Multi-character group chat orchestration & auto-turn sequencing.
- **`game-view.js`** — Interactive RPG text-adventure engine with dynamic stat sheets and choices.
- **`cowriter-view.js` / `cowriter-panel.js`** — Novel & book authoring workbench.
- **`advanced-settings.js`** — Presets manager (`#btn-add-preset`), system prompt templates, sampler params.

### `src/services/`
- **`api.js`** — LLM API client supporting Kobold.cpp, OpenAI, OpenRouter, Claude, Ollama with real-time SSE streaming.
- **`chat-store.js`, `character-store.js`, `settings-store.js`, `group-chat-store.js`, `game-store.js`** — Reactive persistent state stores backed by `localStorage` and `IndexedDB`.
- **`memory-service.js`** — Facts, vector memory storage, and automatic memory injection.
- **`translation-service.js`** — Bidirectional real-time translation for user inputs and AI outputs.

### `src/styles/`
- **`index.css`** — Design system root:
  - CSS variables (colors, `--bg-primary`, `--accent-primary`, radius tokens, typography).
  - Base layout (`#app` flex container with `padding: 12px; gap: 12px;`).
  - Global button tokens: `.btn-primary`, `.btn-secondary`, `.btn-icon`, `.btn-icon-text`, `.toggle-switch`.
- **`chat.css`** — Chat UI & Liquid Glass Header:
  - Floating transparent `.chat-header` (`position: absolute; pointer-events: none;`).
  - Circular 44x44px liquid glass buttons (`#btn-toggle-sidebar`, `#btn-toggle-genai-header`).
  - Floating Character Capsule (`.current-character-info`).
  - Dynamic Island / Apple Morphing Container (`#user-name-morph-container`) — morphs from pill into user persona settings card.
  - Sticky bottom input area (`.chat-input-area`) with no footer (`.input-footer { display: none !important; }`).
  - Right sidebar base transitions & open states (`.right-sidebar`, `body.genai-sidebar-open`).
- **`characters.css`** — Left sidebar layout:
  - Fixed-width sliding & scaling transitions (`.sidebar`, `body.sidebar-collapsed`).
- **`genai.css`** — GenAI assistant styles:
  - Slide-in/slide-out animations and Fullscreen mode (`body.genai-fullscreen`).
- **`animations.css`** — Modal stacking depth engine (`.modal.ui-stacked .modal-content`), lightbox animations.
- **`groups.css`, `game.css`, `settings.css`, `advanced-settings.css`** — Module-specific stylesheets.

### `src/utils/`
- **`ui-manager.js`** — Window stacking engine:
  - Dynamic depth layers, backdrop blur calculation, and z-index ordering for open dialogs.
- **`helpers.js`** — Formatting, escaping, markdown rendering, debouncing utilities.

---

## 3. Key Design Patterns & UI Rules

1. **Floating Liquid Glass Header (Top of Chat):**
   - Header is `position: absolute; top: 0; left: 0; right: 0; pointer-events: none;` with soft dark vignette gradient.
   - Left side: Circular 44px toggle button (`#btn-toggle-sidebar`) + Character Capsule (`.current-character-info`).
   - Right side: User Persona Morph Container (`#user-name-morph-container`) + Circular 44px GenAI button (`#btn-toggle-genai-header`).
   - Messages scroll smoothly underneath the floating capsules (`padding-top: 72px`).

2. **Panel Animations (Apple Spring Curve):**
   - **No Width Squishing:** Both `.sidebar` and `.right-sidebar` maintain fixed widths (`min-width: 280px` and `min-width: 320px`), so text and buttons inside NEVER squeeze or wrap awkwardly.
   - Left panel slides out to left (`margin-left: -292px; transform: translateX(-40px) scale(0.94); opacity: 0;`).
   - Right panel slides out to right (`margin-right: -332px; transform: translateX(40px) scale(0.94); opacity: 0;`).
   - Timing: `0.42s cubic-bezier(0.16, 1, 0.3, 1)` without artificial bounce keyframes.

3. **User Persona Morph Container:**
   - Unified single container for button and expanded popover.
   - Smoothly morphs between states (44px height = pill with `border-radius: 22px`; 196px height = rounded card with `border-radius: 20px`) with `cubic-bezier(0.25, 1, 0.35, 1)` easing.
   - Width is dynamically computed from name length via `--morph-collapsed-width`.

4. **Window Depth & Stacking Engine:**
   - Multiple opened modals automatically get stacked with scale and blur depth filters via `ui-manager.js`.

---

## 4. Helpful Tips for Future Tasks
- Always preserve global button classes (`.btn-icon-text`, `.btn-secondary`, `.btn-primary`) in `index.css`.
- Avoid adding `.hidden` (`display: none`) to sliding sidebars so CSS GPU transition history is maintained from frame 0.
- When modifying `#app`, maintain `padding: 12px; gap: 12px;` so symmetrical border distances are kept.
