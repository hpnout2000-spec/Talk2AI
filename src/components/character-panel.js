/* ════════════════════════════════════════════════════════════════════
   Character Panel — Character management UI
   ════════════════════════════════════════════════════════════════════ */

import { characterStore } from '../services/character-store.js';
import { showToast, showConfirm, closeModal, openWindow, closeWindow } from '../main.js';
import { appState } from '../state.js';
import { selectCharacter, updateChatHistory } from './chat.js';
import { escapeHtml, readFileAsDataURL } from '../utils/helpers.js';
import ExifReader from '../vendor/exifreader.js';
import { api } from '../services/api.js';

let editingCharacterId = null;

export function initCharacterPanel() {
  renderCharacterList();

  // Add character button
  document.getElementById('btn-add-character').addEventListener('click', () => {
    openCharacterEditor();
  });

  // Modal controls
  document.querySelector('.btn-close-modal').addEventListener('click', closeCharacterEditor);
  document.getElementById('btn-cancel-character').addEventListener('click', closeCharacterEditor);
  document.getElementById('btn-save-character').addEventListener('click', saveCharacter);

  // Avatar upload
  document.getElementById('btn-upload-avatar').addEventListener('click', () => {
    document.getElementById('avatar-input').click();
  });

  document.getElementById('avatar-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataURL(file);
      const preview = document.getElementById('avatar-preview');
      preview.innerHTML = `<img src="${dataUrl}" alt="Avatar">`;
      preview.dataset.avatarData = dataUrl;
    } catch (err) {
      showToast('Failed to load image', 'error');
    }
  });

  // Import character card
  document.getElementById('btn-import-character').addEventListener('click', () => {
    document.getElementById('import-input').click();
  });

  document.getElementById('import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      if (file.name.toLowerCase().endsWith('.png')) {
        const tags = await ExifReader.load(file);
        let charDataRaw = null;
        if (tags['chara']) {
          charDataRaw = tags['chara'].description;
        } else if (tags['ccv3']) {
          charDataRaw = tags['ccv3'].description;
        }

        if (charDataRaw) {
          // Fix base64 padding issues
          const b64 = charDataRaw.padEnd(charDataRaw.length + (4 - charDataRaw.length % 4) % 4, '=');
          // UTF-8 decoding for base64
          const jsonStr = new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
          const charData = JSON.parse(jsonStr);
          const parsedChar = charData.data || charData;
          
          openCharacterEditor({
            name: parsedChar.name || '',
            description: parsedChar.description || '',
            personality: parsedChar.personality || '',
            scenario: parsedChar.scenario || '',
            system_prompt: parsedChar.system_prompt || '',
            first_message: parsedChar.first_mes || parsedChar.first_message || '',
            avatar: await readFileAsDataURL(file)
          });
          showToast('Character loaded from card');
        } else {
          showToast('No character data found in this PNG', 'error');
        }
      } else if (file.name.toLowerCase().endsWith('.json')) {
        const text = await file.text();
        const charData = JSON.parse(text);
        const parsedChar = charData.data || charData;
        openCharacterEditor({
          name: parsedChar.name || '',
          description: parsedChar.description || '',
          personality: parsedChar.personality || '',
          scenario: parsedChar.scenario || '',
          system_prompt: parsedChar.system_prompt || '',
          first_message: parsedChar.first_mes || parsedChar.first_message || '',
        });
        showToast('Character loaded from JSON');
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to import character', 'error');
    }
    // reset input
    e.target.value = '';
  });

  // Close modal on backdrop click
  document.querySelector('.modal-backdrop')?.addEventListener('click', closeCharacterEditor);

  // AI Character Generation
  document.getElementById('btn-ai-generate').addEventListener('click', async () => {
    const promptInput = document.getElementById('ai-help-prompt').value.trim();
    if (!promptInput) {
      showToast('Please describe the character you want to create', 'error');
      return;
    }

    const btn = document.getElementById('btn-ai-generate');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Generating...';
    btn.disabled = true;

    try {
      const messages = [
        {
          role: 'system',
          content: `You are a master character designer and world-builder. Your task is to create an exceptionally deep, multi-dimensional character persona based on the user's input.
The description should be vivid and detailed, covering physical appearance, clothing, and presence. The personality must be comprehensive, including nuances, core motivations, secret fears, and behavioral quirks. The scenario should set a rich, atmospheric stage. The system prompt should be an extensive set of instructions that perfectly captures the character's unique voice, vocabulary, and mannerisms.
Each field must be as expansive, descriptive, and rich as possible to provide a high-quality roleplaying experience.
Return ONLY a valid JSON object with the following structure:
{
  "name": "Full name and titles",
  "description": "Extensive physical description, attire, and general role",
  "personality": "Comprehensive breakdown of traits, inner motivations, fears, and quirks",
  "scenario": "Richly detailed current situation and environment",
  "system_prompt": "A lengthy, precise set of roleplay instructions including speaking style, core beliefs, and how they interact with others.",
  "first_message": "An atmospheric, immersive, and engaging opening line that reflects the character's personality"
}
Do not include any Markdown formatting like \`\`\`json or any other text. Return strictly the raw JSON object.`
        },
        { role: 'user', content: promptInput }
      ];

      const response = await api.chatCompletion(messages, { max_tokens: 4000, temperature: 0.7 });
      
      // Strip any thinking blocks
      const cleanResponse = response.replace(/(?:<\|?think\|?>|<reasoning>)([\s\S]*?)(?:<\|?\/think\|?>|<\/reasoning>)/g, '');
      
      const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const charData = JSON.parse(jsonMatch[0]);
        document.getElementById('char-name').value = charData.name || '';
        document.getElementById('char-description').value = charData.description || '';
        document.getElementById('char-personality').value = charData.personality || '';
        document.getElementById('char-scenario').value = charData.scenario || '';
        document.getElementById('char-system-prompt').value = charData.system_prompt || '';
        document.getElementById('char-first-message').value = charData.first_message || '';
        showToast('Character generated successfully!');
      } else {
        throw new Error('No valid JSON found in response');
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to generate character', 'error');
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  });

  // Gallery controls
  document.getElementById('btn-show-all-characters').addEventListener('click', openCharacterGallery);
  document.querySelector('.btn-close-gallery').addEventListener('click', closeCharacterGallery);
  document.getElementById('gallery-search').addEventListener('input', renderGalleryGrid);
  document.getElementById('gallery-sort').addEventListener('change', renderGalleryGrid);
}

// ─── Render Character List ──────────────────────────────────────────

export function renderCharacterList() {
  const list = document.getElementById('character-list');
  const btnShowAll = document.getElementById('btn-show-all-characters');
  const allCharacters = characterStore.getAll();
  
  // Sort by last_chat_at descending
  const sorted = [...allCharacters].sort((a, b) => 
    new Date(b.last_chat_at || 0) - new Date(a.last_chat_at || 0)
  );

  const characters = sorted.slice(0, 10);
  const activeId = appState.currentCharacter?.id;

  if (allCharacters.length > 10) {
    btnShowAll.style.display = 'block';
  } else {
    btnShowAll.style.display = 'none';
  }

  if (characters.length === 0) {
    list.innerHTML = `<div class="empty-state small"><p>No characters yet</p></div>`;
    return;
  }

  list.innerHTML = characters.map(char => {
    const isActive = char.id === activeId;
    const avatarHtml = char.avatar
      ? `<img src="${char.avatar}" alt="${escapeHtml(char.name)}">`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
           <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
         </svg>`;

    return `
      <div class="character-item ${isActive ? 'active' : ''}" data-char-id="${char.id}">
        <div class="character-item-avatar">${avatarHtml}</div>
        <div class="character-item-info">
          <div class="character-item-name">${escapeHtml(char.name)}</div>
          <div class="character-item-desc">${escapeHtml(char.personality || char.description || '').substring(0, 50)}</div>
        </div>
        <div class="character-item-actions">
          <button class="edit" data-edit-char="${char.id}" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="delete" data-delete-char="${char.id}" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Click handlers — select character
  list.querySelectorAll('.character-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.character-item-actions')) return;
      const id = item.dataset.charId;
      const character = characterStore.getById(id);
      if (character) {
        selectCharacter(character);
        renderCharacterList();
      }
    });
  });

  // Edit handlers
  list.querySelectorAll('[data-edit-char]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.editChar;
      const character = characterStore.getById(id);
      if (character) openCharacterEditor(character);
    });
  });

  // Delete handlers
  list.querySelectorAll('[data-delete-char]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteChar;
      const confirmed = await showConfirm('Delete Character', 'Are you sure you want to delete this character and all their chats?');
      if (confirmed) {
        await characterStore.delete(id);
        if (appState.currentCharacter?.id === id) {
          appState.currentCharacter = null;
          appState.currentChat = null;
          document.getElementById('header-char-name').textContent = 'Select a character';
        }
        renderCharacterList();
        showToast('Character deleted');
      }
    });
  });
}

// ─── Character Editor Modal ─────────────────────────────────────────

function openCharacterEditor(character = null) {
  editingCharacterId = character?.id || null;
  const modal = document.getElementById('character-modal');
  const title = document.getElementById('modal-title');

  title.textContent = character ? 'Edit Character' : 'Create Character';

  // Fill form
  document.getElementById('char-name').value = character?.name || '';
  document.getElementById('char-description').value = character?.description || '';
  document.getElementById('char-personality').value = character?.personality || '';
  document.getElementById('char-scenario').value = character?.scenario || '';
  document.getElementById('char-system-prompt').value = character?.system_prompt || '';
  document.getElementById('char-first-message').value = character?.first_message || '';

  const preview = document.getElementById('avatar-preview');
  if (character?.avatar) {
    preview.innerHTML = `<img src="${character.avatar}" alt="Avatar">`;
    preview.dataset.avatarData = character.avatar;
  } else {
    preview.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
    </svg>`;
    preview.dataset.avatarData = '';
  }

  openWindow(modal);
}

function closeCharacterEditor() {
  closeModal('character-modal');
  editingCharacterId = null;
}

async function saveCharacter() {
  const name = document.getElementById('char-name').value.trim();
  if (!name) {
    showToast('Character name is required', 'error');
    return;
  }

  const preview = document.getElementById('avatar-preview');
  const characterData = {
    id: editingCharacterId || undefined,
    name,
    avatar: preview.dataset.avatarData || '',
    description: document.getElementById('char-description').value,
    personality: document.getElementById('char-personality').value,
    scenario: document.getElementById('char-scenario').value,
    system_prompt: document.getElementById('char-system-prompt').value,
    first_message: document.getElementById('char-first-message').value,
  };

  if (editingCharacterId) {
    const existing = characterStore.getById(editingCharacterId);
    if (existing) characterData.created_at = existing.created_at;
  }

  const saved = await characterStore.save(characterData);
  closeCharacterEditor();
  renderCharacterList();

  // Auto-select the saved character
  selectCharacter(saved);
  renderCharacterList();

  showToast(editingCharacterId ? 'Character updated' : 'Character created');
}

// ─── Character Gallery ──────────────────────────────────────────────

function openCharacterGallery() {
  openWindow('character-gallery-modal');
  renderGalleryGrid();
}

function closeCharacterGallery() {
  closeModal('character-gallery-modal');
}

function renderGalleryGrid() {
  const grid = document.getElementById('gallery-grid');
  const search = document.getElementById('gallery-search').value.toLowerCase();
  const sortBy = document.getElementById('gallery-sort').value;
  
  let characters = characterStore.getAll();

  // Search
  if (search) {
    characters = characters.filter(c => 
      c.name.toLowerCase().includes(search) || 
      (c.description || '').toLowerCase().includes(search) ||
      (c.personality || '').toLowerCase().includes(search)
    );
  }

  // Sort
  characters.sort((a, b) => {
    if (sortBy === 'last_chat') {
      return new Date(b.last_chat_at || 0) - new Date(a.last_chat_at || 0);
    } else if (sortBy === 'name') {
      return a.name.localeCompare(b.name);
    } else if (sortBy === 'created') {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    }
    return 0;
  });

  grid.innerHTML = characters.map(char => {
    const avatarHtml = char.avatar
      ? `<img src="${char.avatar}" alt="${escapeHtml(char.name)}">`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
           <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
         </svg>`;

    return `
      <div class="character-card" data-char-id="${char.id}">
        <div class="character-card-avatar">${avatarHtml}</div>
        <div class="character-card-actions">
           <button class="btn-icon small edit" data-edit-char="${char.id}" title="Edit">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
               <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
             </svg>
           </button>
           <button class="btn-icon small delete" data-delete-char="${char.id}" title="Delete">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
               <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
             </svg>
           </button>
        </div>
        <div class="character-card-info">
          <div class="character-card-name">${escapeHtml(char.name)}</div>
          <div class="character-card-desc">${escapeHtml(char.personality || char.description || '')}</div>
        </div>
      </div>
    `;
  }).join('');

  // Handlers
  grid.querySelectorAll('.character-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.character-card-actions')) return;
      const id = card.dataset.charId;
      const character = characterStore.getById(id);
      if (character) {
        selectCharacter(character);
        closeCharacterGallery();
        renderCharacterList();
      }
    });
  });

  grid.querySelectorAll('[data-edit-char]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.editChar;
      const character = characterStore.getById(id);
      if (character) openCharacterEditor(character);
    });
  });

  grid.querySelectorAll('[data-delete-char]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteChar;
      const confirmed = await showConfirm('Delete Character', 'Are you sure you want to delete this character and all their chats?');
      if (confirmed) {
        await characterStore.delete(id);
        if (appState.currentCharacter?.id === id) {
          appState.currentCharacter = null;
          appState.currentChat = null;
          document.getElementById('header-char-name').textContent = 'Select a character';
        }
        renderCharacterList();
        renderGalleryGrid();
        showToast('Character deleted');
      }
    });
  });
}
