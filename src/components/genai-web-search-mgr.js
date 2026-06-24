/* ════════════════════════════════════════════════════════════════════
   Web Search Settings Manager — Configuration for search providers
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from '../services/settings-store.js';
import { openWindow, closeWindow } from '../main.js';

export function initWebSearchSettingsMgr() {
  const btnOpen = document.getElementById('btn-open-web-search-settings');
  const btnClose = document.getElementById('btn-close-web-search-settings');
  const modal = document.getElementById('modal-web-search-settings');
  const backdrop = modal ? modal.querySelector('.modal-backdrop') : null;

  const selectProvider = document.getElementById('setting-web-search-provider');
  const inputSearxUrl = document.getElementById('setting-web-search-searxng-url');
  const inputTavilyKey = document.getElementById('setting-web-search-tavily-key');
  const toggleClean = document.getElementById('setting-web-search-clean-pages');
  const toggleAutoApprove = document.getElementById('setting-web-search-auto-approve');

  const groupSearxUrl = document.getElementById('group-web-search-searxng-url');
  const groupTavilyKey = document.getElementById('group-web-search-tavily-key');

  if (!modal) {
    console.error('modal-web-search-settings element not found');
    return;
  }

  // Open modal
  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      openWindow(modal);
      syncUIFromSettings();
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

  // Save changes on input changes
  if (selectProvider) {
    selectProvider.addEventListener('change', async (e) => {
      const val = e.target.value;
      const current = settingsStore.get();
      await settingsStore.save({ ...current, web_search_provider: val });
      updateFieldsVisibility(val);
    });
  }

  if (inputSearxUrl) {
    inputSearxUrl.addEventListener('change', async (e) => {
      const val = e.target.value.trim();
      const current = settingsStore.get();
      await settingsStore.save({ ...current, web_search_searxng_url: val || 'http://localhost:8080' });
    });
  }

  if (inputTavilyKey) {
    inputTavilyKey.addEventListener('change', async (e) => {
      const val = e.target.value.trim();
      const current = settingsStore.get();
      await settingsStore.save({ ...current, web_search_tavily_key: val });
    });
  }

  if (toggleClean) {
    toggleClean.addEventListener('change', async (e) => {
      const checked = e.target.checked;
      const current = settingsStore.get();
      await settingsStore.save({ ...current, web_search_clean_pages: checked });
    });
  }

  if (toggleAutoApprove) {
    toggleAutoApprove.addEventListener('change', async (e) => {
      const checked = e.target.checked;
      const current = settingsStore.get();
      await settingsStore.save({ ...current, web_search_auto_approve: checked });
    });
  }

  function syncUIFromSettings() {
    const settings = settingsStore.get();
    const provider = settings.web_search_provider || 'ddg';

    // Provider dropdown
    syncDropdownUI('dropdown-web-search-provider', provider);

    // Text inputs
    if (inputSearxUrl) inputSearxUrl.value = settings.web_search_searxng_url || 'http://localhost:8080';
    if (inputTavilyKey) inputTavilyKey.value = settings.web_search_tavily_key || '';

    // Toggles
    if (toggleClean) toggleClean.checked = !!settings.web_search_clean_pages;
    if (toggleAutoApprove) toggleAutoApprove.checked = !!settings.web_search_auto_approve;

    updateFieldsVisibility(provider);
  }

  function updateFieldsVisibility(provider) {
    if (groupSearxUrl) {
      groupSearxUrl.classList.toggle('hidden', provider !== 'searxng_custom');
    }
    if (groupTavilyKey) {
      groupTavilyKey.classList.toggle('hidden', provider !== 'tavily');
    }
  }

  function syncDropdownUI(dropdownId, value) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    const trigger = dropdown.querySelector('.vibe-dropdown-trigger');
    const hiddenSelect = dropdown.querySelector('select');
    if (trigger && hiddenSelect) {
      hiddenSelect.value = value;
      const matchingItem = Array.from(dropdown.querySelectorAll('.vibe-dropdown-item'))
        .find(i => i.dataset.value === value);
      if (matchingItem) {
        trigger.textContent = matchingItem.textContent;
        trigger.dataset.value = value;
        dropdown.querySelectorAll('.vibe-dropdown-item').forEach(i => {
          i.classList.toggle('selected', i === matchingItem);
        });
      }
    }
  }
}
