import { lorebookStore } from '../services/lorebook-store.js';

let currentBookId = null;
let currentRenderedBook = null;

// Ensure this runs when the modal is opened
export function initLorebookButtons() {
  bindGlobalSettings();
  const btnNew = document.getElementById('btn-lorebook-new');
  const btnImport = document.getElementById('btn-lorebook-import');
  
  if (btnNew) {
    btnNew.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const book = await lorebookStore.save({ name: 'New Lorebook', entries: [] });
        currentBookId = book.id;
        renderLorebookEditorList();
      } catch (err) {
        if (window.showToast) window.showToast('Error: ' + err.message, 'error');
      }
    };
  }

  if (btnImport) {
    btnImport.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (evt) => {
        const file = evt.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const data = JSON.parse(event.target.result);
            let name = data.name || file.name.replace('.json', '');
            let entries = [];

            const mapSTEntry = (ent, index) => {
              let keys = ent.keys || ent.key || ent.extensions?.keys || ent.extensions?.key || [];
              if (typeof keys === 'string') keys = keys.split(',').map(s => s.trim()).filter(Boolean);
              if (!Array.isArray(keys)) keys = [];
              
              let filter = ent.secondary_keys || ent.secondaryKeys || ent.keysecondary || ent.filter || ent.extensions?.secondary_keys || ent.extensions?.keysecondary || ent.extensions?.filter || [];
              if (typeof filter === 'string') filter = filter.split(',').map(s => s.trim()).filter(Boolean);
              if (!Array.isArray(filter)) filter = [];

              const rawPos = ent.position ?? ent.extensions?.position;
              let position = 'Before Char';
              if (rawPos === 1 || rawPos === '1' || rawPos === 'after_char' || rawPos === 'After Char') position = 'After Char';
              else if (rawPos === 2 || rawPos === '2' || rawPos === 'top' || rawPos === 'an_top' || rawPos === 'Top') position = 'Top';
              else if (rawPos === 3 || rawPos === '3' || rawPos === 'bottom' || rawPos === 'an_bottom' || rawPos === 'Bottom') position = 'Bottom';

              const rawLogic = 
                ent.selectiveLogic ?? 
                ent.selective_logic ?? 
                ent.logic ?? 
                ent.extensions?.selectiveLogic ?? 
                ent.extensions?.selective_logic ?? 
                ent.extensions?.logic;
              let logic = 'AND ANY';
              if (rawLogic === 1 || rawLogic === '1' || rawLogic === 'NOT ALL' || rawLogic === 'NOT_ALL') logic = 'NOT ALL';
              else if (rawLogic === 2 || rawLogic === '2' || rawLogic === 'AND ALL' || rawLogic === 'AND_ALL') logic = 'AND ALL';
              else if (rawLogic === 3 || rawLogic === '3' || rawLogic === 'NOT ANY' || rawLogic === 'NOT_ANY') logic = 'NOT ANY';
              else if (rawLogic === 0 || rawLogic === '0' || rawLogic === 'AND ANY' || rawLogic === 'AND_ANY') logic = 'AND ANY';

              // Order / insertion_order (higher order = closer to context end, higher priority)
              const rawOrder = 
                ent.insertion_order ?? 
                ent.order ?? 
                ent.priority ?? 
                ent.insertionOrder ?? 
                ent.extensions?.insertion_order ?? 
                ent.extensions?.order ?? 
                ent.extensions?.priority ?? 
                ent.displayIndex ?? 
                ent.display_index ?? 
                100;
              const numOrder = Number(rawOrder);
              const order = !isNaN(numOrder) ? numOrder : 100;

              // Probability / Trigger %
              let triggerPercent = 100;
              const useProb = 
                ent.useProbability ?? 
                ent.use_probability ?? 
                ent.extensions?.useProbability ?? 
                ent.extensions?.use_probability;
              if (useProb === false) {
                triggerPercent = 100;
              } else {
                const rawProb = 
                  ent.probability ?? 
                  ent.extensions?.probability ?? 
                  ent.chance ?? 
                  ent.extensions?.chance ?? 
                  ent.triggerPercent ?? 
                  ent.trigger_percent ?? 
                  ent.trigger ?? 
                  ent.extensions?.trigger;
                if (rawProb !== undefined && rawProb !== null && rawProb !== '') {
                  const numProb = Number(rawProb);
                  triggerPercent = !isNaN(numProb) ? Math.max(0, Math.min(100, numProb)) : 100;
                }
              }

              const isConstant = !!(ent.constant || ent.extensions?.constant || ent.strategy === 'constant' || ent.selective === false);

              return {
                ...lorebookStore.createEntry(),
                id: ent.uid != null ? String(ent.uid) : String(Date.now() + index),
                keys,
                filter,
                content: ent.content || ent.text || ent.extensions?.content || '',
                enabled: ent.enabled !== false && ent.disable !== true && ent.disabled !== true,
                memo: ent.comment || ent.name || ent.memo || ent.extensions?.comment || ent.extensions?.name || '',
                strategy: isConstant ? 'constant' : 'selective',
                constant: isConstant,
                position,
                logic,
                inclusionGroup: ent.group || ent.inclusionGroup || ent.extensions?.group || ent.extensions?.inclusionGroup || '',
                groupWeight: Number(ent.groupWeight ?? ent.group_weight ?? ent.weight ?? ent.extensions?.groupWeight ?? ent.extensions?.group_weight ?? 100) || 100,
                sticky: Number(ent.sticky ?? ent.extensions?.sticky ?? 0) || 0,
                cooldown: Number(ent.cooldown ?? ent.extensions?.cooldown ?? 0) || 0,
                delay: Number(ent.delay ?? ent.extensions?.delay ?? 0) || 0,
                depth: Number(ent.depth ?? ent.extensions?.depth ?? 4) || 4,
                triggerPercent,
                order
              };
            };

            let entriesData = [];
            if (data.character_book?.entries) {
              entriesData = Array.isArray(data.character_book.entries) ? data.character_book.entries : Object.values(data.character_book.entries);
              if (data.character_book.name) name = data.character_book.name;
            } else if (data.data?.character_book?.entries) {
              entriesData = Array.isArray(data.data.character_book.entries) ? data.data.character_book.entries : Object.values(data.data.character_book.entries);
              if (data.data.character_book.name) name = data.data.character_book.name;
            } else if (data.world_info?.entries) {
              entriesData = Array.isArray(data.world_info.entries) ? data.world_info.entries : Object.values(data.world_info.entries);
              if (data.world_info.name) name = data.world_info.name;
            } else if (data.data?.entries) {
              entriesData = Array.isArray(data.data.entries) ? data.data.entries : Object.values(data.data.entries);
              if (data.data.name) name = data.data.name;
            } else if (data.entries) {
              entriesData = Array.isArray(data.entries) ? data.entries : Object.values(data.entries);
            } else if (Array.isArray(data)) {
              entriesData = data;
            }

            entriesData.forEach((ent, index) => entries.push(mapSTEntry(ent, index)));

            const book = await lorebookStore.save({ name, entries, favorite: false });
            currentBookId = book.id;
            renderLorebookEditorList();
            if (window.showToast) window.showToast('Imported: ' + name);
          } catch (err) {
            console.error('Lorebook import error:', err);
            if (window.showToast) window.showToast('Failed to import JSON', 'error');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    };
  }

  const editName = document.getElementById('lorebook-edit-name');
  if (editName) {
    editName.onchange = async (e) => {
      if (!currentRenderedBook) return;
      currentRenderedBook.name = e.target.value;
      await lorebookStore.save(currentRenderedBook);
      renderLorebookEditorList();
    };
  }

  const editFav = document.getElementById('lorebook-edit-favorite');
  if (editFav) {
    editFav.onchange = async (e) => {
      if (!currentRenderedBook) return;
      currentRenderedBook.favorite = e.target.checked;
      await lorebookStore.save(currentRenderedBook);
      renderLorebookEditorList();
      if (window.renderChatLorebooksList) window.renderChatLorebooksList();
    };
  }
};

function bindGlobalSettings() {
  const settings = lorebookStore.getSettings();
  
  const binds = [
    { id: 'wi-global-scan', key: 'scanDepth', valId: 'wi-global-scan-val' },
    { id: 'wi-global-budget', key: 'budgetCap', valId: 'wi-global-budget-val' },
    { id: 'wi-global-maxdepth', key: 'maxDepth', valId: 'wi-global-maxdepth-val' },
    { id: 'wi-global-context', key: 'contextPercent', valId: 'wi-global-context-val' },
    { id: 'wi-global-min', key: 'minActivations', valId: 'wi-global-min-val' },
    { id: 'wi-global-recurse', key: 'maxRecursionSteps', valId: 'wi-global-recurse-val' }
  ];

  binds.forEach(b => {
    const el = document.getElementById(b.id);
    const valEl = document.getElementById(b.valId);
    if (!el) return;
    el.value = settings[b.key] || 0;
    if (valEl) valEl.textContent = el.value;
    
    el.oninput = (e) => {
      if (valEl) valEl.textContent = e.target.value;
    };
    el.onchange = async (e) => {
      await lorebookStore.saveSettings({ [b.key]: Number(e.target.value) });
    };
  });

  const select = document.getElementById('wi-global-strategy');
  if (select) {
    select.value = settings.insertionStrategy || 'Character Lore First';
    select.onchange = async (e) => {
      await lorebookStore.saveSettings({ insertionStrategy: e.target.value });
    };
  }

  const toggles = [
    { id: 'wi-global-names', key: 'includeNames' },
    { id: 'wi-global-recursive', key: 'recursiveScan' },
    { id: 'wi-global-case', key: 'caseSensitive' },
    { id: 'wi-global-words', key: 'matchWholeWords' },
    { id: 'wi-global-groups', key: 'useGroupScoring' },
    { id: 'wi-global-overflow', key: 'alertOnOverflow' }
  ];

  toggles.forEach(t => {
    const el = document.getElementById(t.id);
    if (!el) return;
    el.checked = !!settings[t.key];
    el.onchange = async (e) => {
      await lorebookStore.saveSettings({ [t.key]: e.target.checked });
    };
  });
}

export async function renderLorebookEditorList() {
  const container = document.getElementById('lorebook-list');
  if (!container) return;

  const allBooks = await lorebookStore.load();
  container.innerHTML = '';

  if (allBooks.length === 0) {
    currentBookId = null;
    renderEditorPanel(null);
    return;
  }

  allBooks.forEach(book => {
    const el = document.createElement('div');
    const isSelected = currentBookId === book.id;
    el.style.cssText = `
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: ${isSelected ? 'var(--bg-primary)' : 'transparent'};
      border: 1px solid ${isSelected ? 'var(--border-light)' : 'transparent'};
      font-size: 13px;
      color: var(--text-primary);
    `;

    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    nameSpan.textContent = book.name || 'Untitled';
    if (book.favorite) {
      nameSpan.innerHTML += ' <span style="color:var(--text-accent);font-size:10px;">★</span>';
    }

    const delBtn = document.createElement('button');
    delBtn.innerHTML = '×';
    delBtn.style.cssText = 'background: none; border: none; color: var(--text-tertiary); cursor: pointer; font-size: 16px; margin-left: 8px; flex-shrink: 0;';
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (confirm(`Delete lorebook "${book.name}"?`)) {
        await lorebookStore.delete(book.id);
        if (currentBookId === book.id) { currentBookId = null; currentRenderedBook = null; }
        renderLorebookEditorList();
        if (window.renderChatLorebooksList) window.renderChatLorebooksList();
        if (window.syncLorebookIndicators) window.syncLorebookIndicators();
      }
    };

    el.appendChild(nameSpan);
    el.appendChild(delBtn);

    el.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      currentBookId = book.id;
      renderLorebookEditorList();
    };

    container.appendChild(el);
  });

  if (currentBookId) {
    const activeBook = lorebookStore.get(currentBookId);
    renderEditorPanel(activeBook || null);
  } else {
    renderEditorPanel(null);
  }
};

function renderEditorPanel(book) {
  currentRenderedBook = book;
  const emptyView = document.getElementById('lorebook-editor-empty');
  const contentView = document.getElementById('lorebook-editor-content');
  const editName = document.getElementById('lorebook-edit-name');
  const editFav = document.getElementById('lorebook-edit-favorite');
  const entriesList = document.getElementById('lorebook-entries-list');

  if (!book) {
    if (emptyView) emptyView.style.display = 'flex';
    if (contentView) contentView.style.display = 'none';
    return;
  }

  if (emptyView) emptyView.style.display = 'none';
  if (contentView) contentView.style.display = 'flex';

  if (editName) {
    editName.value = book.name || '';
    editName.onchange = async (e) => {
      if (!currentRenderedBook) return;
      currentRenderedBook.name = e.target.value;
      await lorebookStore.save(currentRenderedBook);
      renderLorebookEditorList();
      if (window.renderChatLorebooksList) window.renderChatLorebooksList();
    };
  }

  if (editFav) {
    editFav.checked = !!book.favorite;
    editFav.onchange = async (e) => {
      if (!currentRenderedBook) return;
      currentRenderedBook.favorite = e.target.checked;
      await lorebookStore.save(currentRenderedBook);
      renderLorebookEditorList();
      if (window.renderChatLorebooksList) window.renderChatLorebooksList();
    };
  }

  // Make sure add entry button is bound
  const btnAddEntry = document.getElementById('btn-lorebook-add-entry');
  if (btnAddEntry) {
    btnAddEntry.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!currentRenderedBook) return;
      if (!currentRenderedBook.entries) currentRenderedBook.entries = [];
      currentRenderedBook.entries.unshift(lorebookStore.createEntry());
      await lorebookStore.save(currentRenderedBook);
      renderEditorPanel(currentRenderedBook);
    };
  }

  if (!entriesList) return;
  entriesList.innerHTML = '';

  const entries = book.entries || [];
  if (entries.length === 0) {
    entriesList.innerHTML = '<div style="color: var(--text-tertiary); text-align: center; padding: 20px;">No entries yet. Click + Add Entry.</div>';
    return;
  }

  entries.forEach((ent, index) => {
    // Fill missing fields to ensure compatibility
    const eProps = { ...lorebookStore.createEntry(), ...ent };
    
    const wrap = document.createElement('div');
    wrap.className = 'lorebook-entry-card';

    wrap.innerHTML = `
      <!-- Top Row: Enable, Name/Memo, Settings -->
      <div style="display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap;">
        <div style="display: flex; gap: 8px; align-items: center; flex: 1; min-width: 200px;">
          <label class="toggle-switch small" style="flex-shrink: 0;">
            <input type="checkbox" class="ent-enabled" ${eProps.enabled ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
          <input type="text" class="ent-memo input-field" placeholder="Entry Title/Memo" value="${(eProps.memo || '').replace(/"/g, '&quot;')}" style="flex: 1; min-width: 120px;" />
        </div>
        
        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          <select class="ent-strategy premium-select" style="min-width: 90px;">
            <option value="selective" ${eProps.strategy !== 'constant' ? 'selected' : ''}>Selective</option>
            <option value="constant" ${eProps.strategy === 'constant' ? 'selected' : ''}>Constant</option>
          </select>
          
          <select class="ent-position premium-select" style="min-width: 80px;">
            <option value="Before Char" ${eProps.position === 'Before Char' ? 'selected' : ''}>↑Char</option>
            <option value="After Char" ${eProps.position === 'After Char' ? 'selected' : ''}>↓Char</option>
            <option value="Top" ${eProps.position === 'Top' ? 'selected' : ''}>Top</option>
            <option value="Bottom" ${eProps.position === 'Bottom' ? 'selected' : ''}>Bottom</option>
          </select>
          
          <label style="color: #94a3b8; font-size: 11px; white-space: nowrap; display: flex; align-items: center; gap: 4px;">
            Order: <input type="number" class="ent-order input-field" value="${eProps.order}" style="width: 55px;" />
          </label>
          <label style="color: #94a3b8; font-size: 11px; white-space: nowrap; display: flex; align-items: center; gap: 4px;">
            Trig%: <input type="number" class="ent-trigger input-field" value="${eProps.triggerPercent}" style="width: 55px;" />
          </label>
          
          <button class="btn-ent-delete" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; transition: all 0.2s;" title="Delete entry">✕</button>
        </div>
      </div>

      <!-- Logic Row -->
      <div style="display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap;">
        <div style="flex: 1.5; min-width: 150px; display: flex; flex-direction: column; gap: 4px;">
          <label style="color: #94a3b8; font-size: 11px; font-weight: 500;">Primary Keywords</label>
          <input type="text" class="ent-keys input-field" placeholder="Comma separated list" value="${(eProps.keys || []).join(', ').replace(/"/g, '&quot;')}" style="width: 100%;" />
        </div>
        <div style="flex: 1; min-width: 110px; display: flex; flex-direction: column; gap: 4px;">
          <label style="color: #94a3b8; font-size: 11px; font-weight: 500;">Logic</label>
          <select class="ent-logic premium-select" style="width: 100%;">
            <option value="AND ANY" ${eProps.logic === 'AND ANY' ? 'selected' : ''}>AND ANY</option>
            <option value="AND ALL" ${eProps.logic === 'AND ALL' ? 'selected' : ''}>AND ALL</option>
            <option value="NOT ANY" ${eProps.logic === 'NOT ANY' ? 'selected' : ''}>NOT ANY</option>
            <option value="NOT ALL" ${eProps.logic === 'NOT ALL' ? 'selected' : ''}>NOT ALL</option>
          </select>
        </div>
        <div style="flex: 1.5; min-width: 150px; display: flex; flex-direction: column; gap: 4px;">
          <label style="color: #94a3b8; font-size: 11px; font-weight: 500;">Optional Filter</label>
          <input type="text" class="ent-filter input-field" placeholder="Comma separated list" value="${(eProps.filter || []).join(', ').replace(/"/g, '&quot;')}" style="width: 100%;" />
        </div>
      </div>

      <!-- Content -->
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label style="color: #94a3b8; font-size: 11px; font-weight: 500;">Content</label>
        <textarea class="ent-content input-field" placeholder="What this keyword should mean to the AI..." style="width: 100%; min-height: 80px; resize: vertical; box-sizing: border-box; font-family: monospace; font-size: 12px; line-height: 1.4;">${eProps.content.replace(/</g, '&lt;')}</textarea>
      </div>
      
      <!-- Advanced row -->
      <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 2px; padding-top: 8px; border-top: 1px solid #334155; font-size: 11px;">
        <label style="color: #94a3b8; display: flex; align-items: center; gap: 4px;">Group: <input type="text" class="ent-ingroup input-field" value="${eProps.inclusionGroup || ''}" placeholder="(None)" style="width: 85px;" /></label>
        <label style="color: #94a3b8; display: flex; align-items: center; gap: 4px;">Weight: <input type="number" class="ent-weight input-field" value="${eProps.groupWeight}" style="width: 55px;" /></label>
        <label style="color: #94a3b8; display: flex; align-items: center; gap: 4px;">Sticky: <input type="number" class="ent-sticky input-field" value="${eProps.sticky}" style="width: 55px;" /></label>
        <label style="color: #94a3b8; display: flex; align-items: center; gap: 4px;">Cooldown: <input type="number" class="ent-cooldown input-field" value="${eProps.cooldown}" style="width: 55px;" /></label>
        <label style="color: #94a3b8; display: flex; align-items: center; gap: 4px;">Delay: <input type="number" class="ent-delay input-field" value="${eProps.delay}" style="width: 55px;" /></label>
      </div>
    `;

    // Bind events
    const update = async () => {
      book.entries[index] = eProps;
      await lorebookStore.save(currentRenderedBook);
    };

    wrap.querySelector('.ent-enabled').onchange = (e) => { eProps.enabled = e.target.checked; update(); };
    wrap.querySelector('.ent-memo').onchange = (e) => { eProps.memo = e.target.value; update(); };
    wrap.querySelector('.ent-strategy').onchange = (e) => { eProps.strategy = e.target.value; update(); };
    wrap.querySelector('.ent-position').onchange = (e) => { eProps.position = e.target.value; update(); };
    wrap.querySelector('.ent-order').onchange = (e) => { eProps.order = Number(e.target.value); update(); };
    wrap.querySelector('.ent-trigger').onchange = (e) => { eProps.triggerPercent = Number(e.target.value); update(); };
    
    wrap.querySelector('.ent-keys').onchange = (e) => { 
      eProps.keys = e.target.value.split(',').map(s => s.trim()).filter(Boolean); 
      update(); 
    };
    wrap.querySelector('.ent-logic').onchange = (e) => { eProps.logic = e.target.value; update(); };
    wrap.querySelector('.ent-filter').onchange = (e) => { 
      eProps.filter = e.target.value.split(',').map(s => s.trim()).filter(Boolean); 
      update(); 
    };

    wrap.querySelector('.ent-content').onchange = (e) => { eProps.content = e.target.value; update(); };
    
    wrap.querySelector('.ent-ingroup').onchange = (e) => { eProps.inclusionGroup = e.target.value; update(); };
    wrap.querySelector('.ent-weight').onchange = (e) => { eProps.groupWeight = Number(e.target.value); update(); };
    wrap.querySelector('.ent-sticky').onchange = (e) => { eProps.sticky = Number(e.target.value); update(); };
    wrap.querySelector('.ent-cooldown').onchange = (e) => { eProps.cooldown = Number(e.target.value); update(); };
    wrap.querySelector('.ent-delay').onchange = (e) => { eProps.delay = Number(e.target.value); update(); };

    wrap.querySelector('.btn-ent-delete').onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (confirm('Delete this entry?')) {
        book.entries.splice(index, 1);
        await lorebookStore.save(currentRenderedBook);
        renderEditorPanel(book);
      }
    };

    entriesList.appendChild(wrap);
  });
}
