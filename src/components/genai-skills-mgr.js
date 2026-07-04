/* ════════════════════════════════════════════════════════════════════
   GenAI Skills Manager — View and manage GenAI skills
   ════════════════════════════════════════════════════════════════════ */

import { skillsStore } from '../services/skills-store.js';
import { showToast, showConfirm, openWindow, closeWindow } from '../main.js';
import { escapeHtml } from '../utils/helpers.js';

let expandedFilename = null;

export function initGenAISkillsMgr() {
  const btnOpen = document.getElementById('btn-open-genai-skills');
  const btnClose = document.getElementById('btn-close-genai-skills');
  const modal = document.getElementById('modal-genai-skills');
  const backdrop = modal ? modal.querySelector('.modal-backdrop') : null;
  const btnImport = document.getElementById('btn-import-genai-skill');
  const inputImport = document.getElementById('input-import-genai-skill');
  const btnOpenFolder = document.getElementById('btn-open-skills-folder');

  if (!modal) {
    console.error('modal-genai-skills element not found');
    return;
  }

  // Open modal
  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      expandedFilename = null;
      openWindow(modal);
      renderSkills();
    });
  }

  // Close modal via X button
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      closeWindow(modal);
    });
  }

  // Close modal via backdrop click
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      closeWindow(modal);
    });
  }

  // Import button triggers file input
  if (btnImport && inputImport) {
    btnImport.addEventListener('click', () => {
      inputImport.click();
    });

    inputImport.addEventListener('change', handleFileImport);
  }

  // Open skills folder
  if (btnOpenFolder) {
    btnOpenFolder.addEventListener('click', async () => {
      try {
        if (window.__TAURI_INTERNALS__) {
          await window.__TAURI_INTERNALS__.invoke('open_skills_folder');
        } else {
          showToast('Not running in Tauri environment', 'error');
        }
      } catch (err) {
        showToast(`Failed to open folder: ${err.message || err}`, 'error');
      }
    });
  }
}

async function handleFileImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const content = event.target.result;
      const filename = file.name;
      
      // Basic check
      if (!filename.endsWith('.txt') && !filename.endsWith('.json')) {
        showToast('Only .txt or .json files are supported', 'error');
        return;
      }

      await skillsStore.saveSkill(filename, content);
      showToast(`Skill "${filename}" imported successfully`);
      renderSkills();
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error');
    }
  };

  reader.onerror = () => {
    showToast('Failed to read file', 'error');
  };

  reader.readAsText(file);
  
  // Clear input value so same file can be selected again
  e.target.value = '';
}

export async function renderSkills() {
  const container = document.getElementById('genai-skills-list-container');
  const countEl = document.getElementById('genai-skills-count');
  if (!container) return;

  const skills = await skillsStore.getSkills();

  if (countEl) {
    countEl.textContent = skills.length;
  }

  if (skills.length === 0) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--space-6) 0; color: var(--text-tertiary); text-align: center; gap: 8px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 32px; height: 32px; color: var(--text-tertiary); opacity: 0.6;">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
        <div style="font-size: var(--text-sm); font-weight: 500;">No skills found</div>
        <div style="font-size: var(--text-xs); opacity: 0.8;">Click Import to load custom text or json skills.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = skills.map(entry => {
    const isExpanded = entry.filename === expandedFilename;
    const isDefault = !!entry.is_default;

    return `
      <div class="memory-entry skill-entry ${isExpanded ? 'expanded' : ''}" data-filename="${entry.filename}" style="cursor: pointer; transition: all 0.2s ease;">
        <div class="memory-entry-icon" style="display: flex; align-items: center; gap: 8px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 14px; height: 14px; color: var(--text-accent); display: block;">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div class="memory-entry-body" style="flex: 1; padding: 0 4px; overflow: hidden;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="memory-entry-content" style="font-weight: 600; color: var(--text-primary); font-size: var(--text-sm);">${escapeHtml(entry.name)}</span>
            ${isDefault ? `
              <span style="font-size: 10px; background: rgba(14, 165, 233, 0.15); color: var(--text-accent); padding: 2px 6px; border-radius: 20px; font-weight: 600; letter-spacing: 0.02em;">Default</span>
            ` : ''}
          </div>
          <div class="memory-entry-meta" style="font-size: 11px; color: var(--text-tertiary); margin-top: 2px;">
            ${escapeHtml(entry.filename)}
          </div>
          
          ${isExpanded ? `
            <div class="skill-content-view" style="margin-top: 10px; padding: 10px; background: var(--bg-primary); border: 1px solid var(--border-light); border-radius: var(--radius-md); font-family: monospace; font-size: 12px; max-height: 150px; overflow-y: auto; color: var(--text-secondary); white-space: pre-wrap; cursor: text;">${escapeHtml(entry.content)}</div>
          ` : ''}
        </div>
        
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="skill-entry-toggle btn-icon small" data-filename="${entry.filename}" title="${isExpanded ? 'Collapse' : 'Expand'}" style="background: none; border: none; cursor: pointer;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; transform: ${isExpanded ? 'rotate(180deg)' : 'none'}; transition: transform 0.2s;">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          
          ${!isDefault ? `
            <button class="skill-entry-edit" data-filename="${entry.filename}" data-content="${escapeHtml(entry.content)}" title="Edit in Skill Creator">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Edit
            </button>
            <button class="skill-entry-delete btn-icon small" data-filename="${entry.filename}" title="Delete skill" style="background: none; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px; color: var(--text-tertiary);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          ` : ''}

          <button class="skill-entry-activate" data-filename="${entry.filename}" title="Toggle activate" style="background: none; border: none; cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; width: 44px; height: 24px; flex-shrink: 0;">
            <label class="toggle-switch small" style="pointer-events: none; flex-shrink: 0; margin: 0;">
              <input type="checkbox" ${(() => {
                try {
                  const active = window.getGenAiActiveSkills ? window.getGenAiActiveSkills() : [];
                  const fname = entry.filename;
                  const isAct = active.includes(fname);
                  return isAct ? 'checked' : '';
                } catch (e) { return ''; }
              })()} />
              <span class="toggle-slider"></span>
            </label>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Click on row toggles expansion (unless clicking delete button)
  container.querySelectorAll('.skill-entry').forEach(row => {
    row.addEventListener('click', (e) => {
      // Ignore click if it's on a delete/edit button, inside content view, or inside an input/button
      if (e.target.closest('.skill-entry-delete') || e.target.closest('.skill-content-view') || e.target.closest('.skill-entry-toggle') || e.target.closest('.skill-entry-activate') || e.target.closest('.skill-entry-edit')) {
        return;
      }
      
      const filename = row.dataset.filename;
      expandedFilename = expandedFilename === filename ? null : filename;
      renderSkills();
    });
  });

  // Expand toggle buttons
  container.querySelectorAll('.skill-entry-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const filename = btn.dataset.filename;
      expandedFilename = expandedFilename === filename ? null : filename;
      renderSkills();
    });
  });

  // Activate toggle buttons
  container.querySelectorAll('.skill-entry-activate').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const filename = btn.dataset.filename;
      try {
        if (window.toggleGenAiSkill) {
          // Map filename to id 'nhentai' / 'gelbooru' with case-insensitivity when applicable
          const lowerFname = filename.toLowerCase().trim();
          const id = (lowerFname === 'nhentai' || lowerFname === 'nhentai.txt') ? 'nhentai' :
                     (lowerFname === 'gelbooru' || lowerFname === 'gelbooru.txt') ? 'gelbooru' : filename;
          await window.toggleGenAiSkill(id, btn);
          await renderSkills();
        } else {
          showToast('Skill activation not available', 'error');
        }
      } catch (err) {
        showToast('Failed to toggle skill', 'error');
      }
    });
  });

  // Handle delete click
  container.querySelectorAll('.skill-entry-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const filename = btn.dataset.filename;
      const confirmed = await showConfirm(
        'Delete Skill',
        `Are you sure you want to delete the skill "${filename}"?`
      );
      if (confirmed) {
        try {
          await skillsStore.deleteSkill(filename);
          showToast(`Skill deleted successfully`);
          if (expandedFilename === filename) expandedFilename = null;
          renderSkills();
        } catch (err) {
          showToast(`Failed to delete skill: ${err.message}`, 'error');
        }
      }
    });
  });

  // Handle edit click — open in Skill Creator
  container.querySelectorAll('.skill-entry-edit').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const filename = btn.dataset.filename;
      // Fetch fresh content from store (data-content may be truncated by escapeHtml)
      const skill = await skillsStore.getSkill(filename);
      if (!skill) {
        showToast('Skill not found', 'error');
        return;
      }

      if (window.openSkillCreatorFromManager) {
        window.openSkillCreatorFromManager(skill.content, skill.filename);
      } else {
        showToast('Skill Creator not available', 'error');
      }
    });
  });
}

// Bind globally
window.renderSkills = renderSkills;
