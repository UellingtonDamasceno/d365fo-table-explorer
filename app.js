'use strict';

/* ===================================================================
   D365FO Table Explorer – app.js
   =================================================================== */

// ── STATE ──────────────────────────────────────────────────────────
let ALL_TABLES  = [];          // Array de objetos de tabela
let tableIndex  = {};          // name → objeto tabela (lookup O(1))
let relIndex    = {};          // name → Set<string> de tabelas relacionadas (para BFS)
let inboundRelIndex = {};      // name → relações de entrada (para BFS bidirecional)
let cy          = null;        // Instância Cytoscape
let currentDetail  = null;     // Tabela atualmente no painel de detalhes
let detailHistory  = [];       // Histórico de navegação no painel de detalhes
let queryPath      = [];       // Caminho de tabelas para gerar query
let expansionMode  = 'full';   // Modo de expansão: 'full' | 'filtered' | 'manual'
let shiftPath      = [];       // Nós enfileirados por Shift+Click para pathfinding
let pathWaypoints = [];
let sortOrder = 'asc';
let undoStack = [];
let bubbleAnimEnabled = false;
let bubblePhases = {};
let bubbleRaf = null;
let autoZoomFontEnabled = true;
let selectedFieldsByTable = {};
let whileSelectMode = false;
let lastImportInfo = null;

const DEFAULT_CONFIG = window.D365State?.DEFAULT_CONFIG || {
  layout: 'cose',
  nodeRepulsion: 8000,
  idealEdgeLength: 120,
  autoZoomFont: true,
  showRelationName: true,
  showMultiplicity: false,
  bubbleMode: false,
  directionalHighlight: false,
  strictDirection: false,
  maxDepth: 8,
  dashboardUseSidebarFilter: true,
  defaultIterative: false,
  includeSystemFields: false,
};
let appConfig = window.D365State?.loadConfig?.() || { ...DEFAULT_CONFIG };

// ── TableGroup → cor ───────────────────────────────────────────────
const GROUP_COLORS = {
  'Main':              { bg: '#1d4ed8', border: '#3b82f6', tag: 'tag-blue'   },
  'Transaction':       { bg: '#b45309', border: '#f59e0b', tag: 'tag-orange' },
  'TransactionHeader': { bg: '#92400e', border: '#d97706', tag: 'tag-orange' },
  'TransactionLine':   { bg: '#7c3aed', border: '#a78bfa', tag: 'tag-purple' },
  'Group':             { bg: '#15803d', border: '#22c55e', tag: 'tag-green'  },
  'WorksheetHeader':   { bg: '#6d28d9', border: '#8b5cf6', tag: 'tag-purple' },
  'WorksheetLine':     { bg: '#0e7490', border: '#06b6d4', tag: 'tag-teal'   },
  'Staging':           { bg: '#374151', border: '#6b7280', tag: 'tag-gray'   },
  'Parameter':         { bg: '#065f46', border: '#10b981', tag: 'tag-green'  },
  'Framework':         { bg: '#1f2937', border: '#4b5563', tag: 'tag-gray'   },
  'Reference':         { bg: '#78350f', border: '#d97706', tag: 'tag-yellow' },
  'None':              { bg: '#1e2130', border: '#3d4468', tag: 'tag-gray'   },
};

function groupColor(group) {
  return GROUP_COLORS[group] || GROUP_COLORS['None'];
}

// ── VIRTUAL SCROLL ─────────────────────────────────────────────────
const VS_H     = 40;   // altura de cada item em px
let vsFiltered = [];   // array de tabelas filtradas
let vsContainer, vsInner, vsViewport = { start: 0, end: 0 };

// ── STARTUP ────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Directory import
  document.getElementById('pick-directory-btn').addEventListener('click', importFromDirectory);
  document.getElementById('import-directory-btn').addEventListener('click', importFromDirectory);
  if (!window.D365Ingestion?.supportsDirectoryImport?.()) {
    const btns = [
      document.getElementById('pick-directory-btn'),
      document.getElementById('import-directory-btn'),
    ];
    btns.forEach(btn => {
      if (!btn) return;
      btn.disabled = true;
      btn.title = 'Importação por pasta requer Chromium recente (File System Access API).';
    });
  }
  document.getElementById('header-menu-toggle').addEventListener('click', e => {
    e.stopPropagation();
    document.querySelector('.header')?.classList.toggle('menu-open');
  });
  document.addEventListener('click', e => {
    const header = document.querySelector('.header');
    if (!header?.classList.contains('menu-open')) return;
    if (!header.contains(e.target)) header.classList.remove('menu-open');
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) document.querySelector('.header')?.classList.remove('menu-open');
    cy?.resize();
  });

  // Search
  document.getElementById('search-input').addEventListener('input', onSearch);
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const raw = document.getElementById('search-input').value.trim();
    // O(1) exact match first, then case-insensitive fallback
    let match = tableIndex[raw];
    if (!match) {
      const lower = raw.toLowerCase();
      match = ALL_TABLES.find(t => t.name.toLowerCase() === lower);
    }
    if (match) {
      addTableToGraph(match.name);
      showDetail(match, true);
      clearSearch();
    }
  });
  document.getElementById('clear-btn').addEventListener('click', clearSearch);
  document.getElementById('group-filter').addEventListener('change', onSearch);

  // Graph controls
  document.getElementById('clear-graph-btn').addEventListener('click', clearGraph);
  document.getElementById('fit-graph-btn').addEventListener('click', fitGraph);
  document.getElementById('toggle-labels-btn').addEventListener('click', toggleLabels);
  document.getElementById('layout-select').addEventListener('change', () => applyLayout());
  document.getElementById('zoom-in-btn').addEventListener('click',  () => cy?.zoom({ level: cy.zoom() * 1.25, renderedPosition: graphCenter() }));
  document.getElementById('zoom-out-btn').addEventListener('click', () => cy?.zoom({ level: cy.zoom() * 0.8,  renderedPosition: graphCenter() }));
  document.getElementById('fit-btn2').addEventListener('click', fitGraph);
  document.getElementById('toggle-sidebar-btn').addEventListener('click', toggleSidebarCollapse);
  document.getElementById('toggle-detail-btn').addEventListener('click', toggleDetailCollapse);
  document.getElementById('strict-direction-inline').addEventListener('change', e => {
    appConfig.strictDirection = e.target.checked;
    const cfgCb = document.getElementById('cfg-strict-direction');
    if (cfgCb) cfgCb.checked = appConfig.strictDirection;
    saveAppConfig();
  });

  // Detail panel
  document.getElementById('close-detail-btn').addEventListener('click', closeDetail);
  document.getElementById('expand-node-btn').addEventListener('click', () => {
    if (currentDetail) expandTableInGraph(currentDetail.name, true);
  });
  document.getElementById('gen-simple-query-btn').addEventListener('click', genSimpleQuery);
  document.getElementById('toggle-while-select-btn').addEventListener('click', () => {
    whileSelectMode = !whileSelectMode;
    const btn = document.getElementById('toggle-while-select-btn');
    btn.classList.toggle('btn-primary', whileSelectMode);
    if (queryPath?.length > 1) renderQueryAccordion(queryPath);
  });

  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab, true)));

  // Field/relation filters
  document.getElementById('fields-filter').addEventListener('input', filterFields);
  document.getElementById('rels-filter').addEventListener('input', filterRelations);

  // Pathfinding
  document.getElementById('find-path-btn').addEventListener('click', findPath);

  // Virtual scroll listener
  vsContainer = document.getElementById('vscroll-container');
  vsInner     = document.getElementById('vscroll-inner');
  vsContainer.addEventListener('scroll', () => renderVS(), { passive: true });

  // Back button (US 2.2)
  document.getElementById('back-detail-btn').addEventListener('click', navigateBack);

  // Expansion mode buttons (US 3.1)
  document.querySelectorAll('.exp-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      expansionMode = btn.dataset.mode;
      document.querySelectorAll('.exp-btn').forEach(b => b.classList.toggle('active', b === btn));
    }));

  // Expansion dialog buttons (US 3.1)
  document.getElementById('expansion-confirm-btn').addEventListener('click', confirmExpansion);
  document.getElementById('expansion-cancel-btn').addEventListener('click', () =>
    document.getElementById('expansion-dialog').classList.add('hidden'));

  // Expansion dialog filter (P3 US 1.3)
  document.getElementById('expansion-dialog-filter').addEventListener('input', () => {
    const q = document.getElementById('expansion-dialog-filter').value.toLowerCase();
    document.querySelectorAll('#expansion-dialog-list .exp-dialog-item').forEach(item => {
      item.style.display = (q && !item.textContent.toLowerCase().includes(q)) ? 'none' : '';
    });
  });

  // Shift path clear button (US 3.3)
  document.getElementById('clear-shift-path-btn').addEventListener('click', clearShiftPath);

  // Export/Import graph (US 4.1)
  document.getElementById('export-graph-btn').addEventListener('click', exportGraph);
  document.getElementById('import-graph-btn').addEventListener('click', () =>
    document.getElementById('import-graph-input').click());
  document.getElementById('import-graph-input').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) importGraph(file);
    e.target.value = '';
  });

  // Sort toggle (US 2.1)
  document.getElementById('sort-toggle').addEventListener('click', () => {
    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    document.getElementById('sort-toggle').textContent = sortOrder === 'asc' ? 'A→Z' : 'Z→A';
    onSearch();
  });

  // Waypoints (US 1.2)
  document.getElementById('add-waypoint-btn').addEventListener('click', () => {
    const container = document.getElementById('waypoints-container');
    const row = document.createElement('div');
    row.className = 'waypoint-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'path-input';
    input.placeholder = 'Via...';
    input.autocomplete = 'off';
    input.setAttribute('list', 'waypoints-datalist');
    const removeBtn = document.createElement('button');
    removeBtn.className = 'waypoint-remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => row.remove());
    row.appendChild(input);
    row.appendChild(removeBtn);
    container.appendChild(row);
  });

  // Alt routes (US 1.3)
  document.getElementById('find-alt-routes-btn').addEventListener('click', () => {
    const from = document.getElementById('path-from').value.trim();
    const to = document.getElementById('path-to').value.trim();
    if (from && to) renderAltRoutes(from, to);
  });

  // Undo (US 3.2)
  document.getElementById('undo-btn').addEventListener('click', undoAction);

  // Shortcuts modal (US 3.1)
  document.getElementById('shortcuts-help-btn').addEventListener('click', () => {
    hideTooltip();
    document.getElementById('shortcuts-modal').classList.remove('hidden');
  });
  document.getElementById('shortcuts-modal-close-btn').addEventListener('click', () =>
    document.getElementById('shortcuts-modal').classList.add('hidden'));
  document.getElementById('shortcuts-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('shortcuts-modal'))
      document.getElementById('shortcuts-modal').classList.add('hidden');
  });

  // Settings modal
  document.getElementById('open-settings-btn').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('hidden');
  });
  document.getElementById('settings-modal-close-btn').addEventListener('click', () =>
    document.getElementById('settings-modal').classList.add('hidden'));
  document.getElementById('settings-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('settings-modal')) {
      document.getElementById('settings-modal').classList.add('hidden');
    }
  });
  wireSettingsInputs();

  // Metadata dashboard
  document.getElementById('open-dashboard-btn').addEventListener('click', openMetadataDashboard);
  document.getElementById('dash-use-sidebar-filter').addEventListener('change', e => {
    appConfig.dashboardUseSidebarFilter = e.target.checked;
    const cfg = document.getElementById('cfg-dashboard-filter');
    if (cfg) cfg.checked = e.target.checked;
    saveAppConfig();
    renderMetadataDashboard();
  });
  document.getElementById('dashboard-close-btn').addEventListener('click', () =>
    document.getElementById('dashboard-modal').classList.add('hidden'));
  document.getElementById('dashboard-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('dashboard-modal')) {
      document.getElementById('dashboard-modal').classList.add('hidden');
    }
  });
  document.getElementById('dashboard-modal').addEventListener('click', e => {
    const link = e.target.closest('.dash-link');
    if (!link) return;
    focusTableFromDashboard(link.dataset.table);
  });

  // Expansion dialog bulk actions (US 3.3)
  document.getElementById('exp-select-all-btn').addEventListener('click', () =>
    document.querySelectorAll('#expansion-dialog-list input[type="checkbox"]').forEach(cb => cb.checked = true));
  document.getElementById('exp-deselect-all-btn').addEventListener('click', () =>
    document.querySelectorAll('#expansion-dialog-list input[type="checkbox"]').forEach(cb => cb.checked = false));

  // Breadcrumbs event delegation (US 2.2)
  document.getElementById('detail-breadcrumbs').addEventListener('click', e => {
    if (e.target.classList.contains('breadcrumb-item')) {
      const idx = parseInt(e.target.dataset.idx);
      const target = detailHistory[idx];
      detailHistory = detailHistory.slice(0, idx);
      showDetail(target, true);
    } else if (e.target.id === 'add-trail-to-graph-btn') {
      [...detailHistory, currentDetail].forEach(t => { if (t) addTableToGraph(t.name); });
    }
  });

  // Keyboard shortcuts (US 3.1)
  document.addEventListener('keydown', e => {
    const cancelNative = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    const inInput = window.D365Shortcuts?.isInputElement
      ? window.D365Shortcuts.isInputElement(document.activeElement)
      : (() => {
          const tag = (document.activeElement?.tagName || '').toLowerCase();
          return tag === 'input' || tag === 'textarea';
        })();
    if (e.ctrlKey && e.key === 'f') {
      cancelNative();
      const input = document.getElementById('canvas-search-input');
      input.value = '';
      input.classList.remove('not-found');
      document.getElementById('canvas-search-clear')?.classList.add('hidden');
      cy?.nodes().removeClass('canvas-highlighted');
      input.focus();
    }
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'l' && !inInput) { cancelNative(); applyLayout(); }
    if (e.ctrlKey && !e.altKey && e.key === 'l' && !inInput) { cancelNative(); clearGraph(); }
    if (e.ctrlKey && e.key === 'z' && !inInput) { cancelNative(); undoAction(); }
    if (e.key === 'Delete' && !inInput) {
      cancelNative();
      const selected = cy?.nodes(':selected') || [];
      selected.forEach(n => removeNodeFromGraph(n.id()));
    }
    if (e.ctrlKey && e.key === ',') {
      cancelNative();
      document.getElementById('settings-modal').classList.toggle('hidden');
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'b' && !inInput) {
      cancelNative();
      appConfig.bubbleMode = !appConfig.bubbleMode;
      applyConfigToRuntime();
      syncSettingsUI();
      saveAppConfig();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 's' && !inInput) {
      cancelNative();
      exportGraph();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'o' && !inInput) {
      cancelNative();
      document.getElementById('import-graph-input').click();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'n' && !inInput) {
      cancelNative();
      document.getElementById('reload-file-input').click();
    }
    if (e.key === 'Escape') {
      // 1. Close open modals/dialogs first (in order of priority)
      const dashboardModal   = document.getElementById('dashboard-modal');
      const settingsModal    = document.getElementById('settings-modal');
      const shortcutsModal   = document.getElementById('shortcuts-modal');
      const expansionDialog  = document.getElementById('expansion-dialog');
      if (dashboardModal && !dashboardModal.classList.contains('hidden')) {
        dashboardModal.classList.add('hidden'); return;
      }
      if (settingsModal && !settingsModal.classList.contains('hidden')) {
        settingsModal.classList.add('hidden'); return;
      }
      if (shortcutsModal && !shortcutsModal.classList.contains('hidden')) {
        shortcutsModal.classList.add('hidden'); return;
      }
      if (expansionDialog && !expansionDialog.classList.contains('hidden')) {
        expansionDialog.classList.add('hidden'); return;
      }
      // 2. Don't touch canvas if user is typing
      if (inInput) return;
      // 3. Clear all highlights, selections, paths on canvas
      cy?.elements().removeClass('highlighted path-selected');
      clearDirectionalHighlight();
      cy?.nodes().removeClass('shift-queued canvas-highlighted');
      shiftPath.forEach(name => cy?.getElementById(name).removeClass('shift-queued'));
      shiftPath = [];
      updateShiftPathDisplay();
      // 4. Clear path result panel
      const pathResult = document.getElementById('path-result');
      if (pathResult) { pathResult.innerHTML = ''; pathResult.classList.add('hidden'); }
      // 5. Clear canvas search
      const csInput = document.getElementById('canvas-search-input');
      if (csInput) { csInput.value = ''; csInput.classList.remove('not-found'); }
      document.getElementById('canvas-search-clear')?.classList.add('hidden');
    }
    // fallback export shortcut for browsers that still intercept Ctrl+S
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's' && !inInput) {
      cancelNative();
      exportGraph();
    }
  });

  // Bubble animation (US 4.2)
  document.getElementById('bubble-anim-btn').addEventListener('click', () => {
    appConfig.bubbleMode = !appConfig.bubbleMode;
    applyConfigToRuntime();
    syncSettingsUI();
    saveAppConfig();
  });

  // Canvas search (P3 US 1.2)
  document.getElementById('canvas-search-input').addEventListener('input', searchInCanvas);
  document.getElementById('canvas-search-clear').addEventListener('click', () => {
    document.getElementById('canvas-search-input').value = '';
    document.getElementById('canvas-search-clear').classList.add('hidden');
    cy?.nodes().removeClass('canvas-highlighted');
    document.getElementById('canvas-search-input').classList.remove('not-found');
  });

  // Start with IndexedDB
  initializeFromDB();
});

// ── LOAD METADATA ──────────────────────────────────────────────────
async function initializeFromDB() {
  showLoadingOverlay();
  document.getElementById('file-input-area').classList.add('hidden');
  resetIngestionProgress();

  if (window.D365MetadataDB?.isSupported?.()) {
    try {
      window.D365MetadataDB.init();
      const count = await window.D365MetadataDB.countTables();
      if (count > 0) {
        setLoading(`Carregando metadados locais (${count.toLocaleString()} tabelas)...`);
        const tables = await window.D365MetadataDB.getAllTables();
        lastImportInfo = await window.D365MetadataDB.getImportInfo();
        init({ tables });
        return;
      }
    } catch (err) {
      console.warn('Falha ao carregar IndexedDB local:', err);
    }
  }

  setLoading('Banco de dados vazio. Importe a pasta PackagesLocalDirectory para iniciar.');
  document.getElementById('file-input-area').classList.remove('hidden');
}

function setLoading(msg) {
  document.getElementById('loading-msg').textContent = msg;
}

function showLoadingOverlay() {
  const overlay = document.getElementById('loading-overlay');
  overlay.style.display = 'flex';
}

function hideOverlay() {
  const overlay = document.getElementById('loading-overlay');
  overlay.classList.add('hidden');
  overlay.style.display = 'none';
  document.getElementById('app').classList.remove('hidden');
}

function resetIngestionProgress() {
  const box = document.getElementById('ingestion-progress');
  const fill = document.getElementById('ingestion-progress-fill');
  const text = document.getElementById('ingestion-progress-text');
  if (box) box.classList.add('hidden');
  if (fill) fill.style.width = '0%';
  if (text) text.textContent = '';
}

function setIngestionProgress(state) {
  const box = document.getElementById('ingestion-progress');
  const fill = document.getElementById('ingestion-progress-fill');
  const text = document.getElementById('ingestion-progress-text');
  if (!box || !fill || !text) return;
  box.classList.remove('hidden');

  const phase = state?.phase || '';
  let percent = 0;
  let label = '';

  if (phase === 'scan') {
    label = `Varredura: ${Number(state?.matchedFiles || 0).toLocaleString()} XML válidos em ${Number(state?.scannedFiles || 0).toLocaleString()} arquivos`;
  } else if (phase === 'parse') {
    const processed = Number(state?.processed || 0);
    const total = Number(state?.total || 0);
    percent = total > 0 ? (processed / total) * 100 : 0;
    label = `Processamento: ${processed.toLocaleString()}/${total.toLocaleString()} arquivos | erros: ${Number(state?.errors || 0)} | workers: ${Number(state?.workersDone || 0)}/${Number(state?.workersTotal || 0)}`;
  } else if (phase === 'persist') {
    const processed = Number(state?.processed || 0);
    const total = Number(state?.total || 0);
    percent = total > 0 ? (processed / total) * 100 : 0;
    label = `Persistindo IndexedDB: ${processed.toLocaleString()}/${total.toLocaleString()} tabelas`;
  } else if (phase === 'done') {
    percent = 100;
    label = state?.message || 'Importação concluída.';
  } else if (phase === 'error') {
    label = state?.message || 'Falha durante a importação.';
  }

  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  text.textContent = label;
}

async function importFromDirectory() {
  if (!window.D365Ingestion?.supportsDirectoryImport?.()) {
    alert('Este navegador não suporta importação por pasta (showDirectoryPicker + Worker).');
    return;
  }

  const overlay = document.getElementById('loading-overlay');
  const overlayWasHidden = overlay.style.display === 'none';
  showLoadingOverlay();
  document.getElementById('file-input-area').classList.remove('hidden');
  resetIngestionProgress();

  try {
    setLoading('Solicitando acesso à pasta PackagesLocalDirectory...');
    if (window.D365MetadataDB?.isSupported?.()) {
      window.D365MetadataDB.init();
      await window.D365MetadataDB.ensureStoragePersistence();
    }

    const rootHandle = await window.showDirectoryPicker({ mode: 'read' });

    setLoading('Varrendo arquivos XML...');
    const scan = await window.D365Ingestion.collectXmlFiles(rootHandle, {
      onProgress: (p) => setIngestionProgress(p),
    });
    if (!scan.files.length) {
      setLoading('Nenhum XML de AxTable/AxTableExtension foi encontrado na pasta selecionada.');
      if (overlayWasHidden) {
        hideOverlay();
        alert('Nenhum XML de AxTable/AxTableExtension encontrado na pasta selecionada.');
      }
      return;
    }

    setLoading(`Processando ${scan.files.length.toLocaleString()} arquivos em paralelo...`);
    const parsed = await window.D365Ingestion.processFiles(scan.files, {
      onProgress: (p) => setIngestionProgress(p),
    });

    setLoading('Persistindo metadados no IndexedDB...');
    setIngestionProgress({ phase: 'persist', processed: 0, total: parsed.tables.length });
    if (window.D365MetadataDB?.isSupported?.()) {
      await window.D365MetadataDB.saveImport(parsed);
      lastImportInfo = await window.D365MetadataDB.getImportInfo();
    }
    setIngestionProgress({ phase: 'done', message: `Importação concluída: ${parsed.tables.length.toLocaleString()} tabelas` });
    init({ tables: parsed.tables });
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (overlayWasHidden) hideOverlay();
      else {
        setLoading('Importação cancelada pelo usuário.');
        resetIngestionProgress();
      }
      return;
    }
    console.error('Falha na importação local-first:', err);
    const errMsg = `Falha na importação: ${err?.message || err}`;
    setLoading(`❌ ${errMsg}`);
    setIngestionProgress({ phase: 'error', message: 'Falha ao processar XMLs. Verifique o console.' });
    document.getElementById('file-input-area').classList.remove('hidden');
    if (overlayWasHidden) {
      hideOverlay();
      alert(`❌ ${errMsg}`);
    }
  }
}

// ── INIT ───────────────────────────────────────────────────────────
function init(data) {
  if (bubbleRaf) cancelAnimationFrame(bubbleRaf);
  bubbleRaf = null;
  bubblePhases = {};
  bubbleAnimEnabled = false;
  if (cy) {
    try { cy.destroy(); } catch (_) {}
    cy = null;
  }
  currentDetail = null;
  detailHistory = [];
  queryPath = [];
  shiftPath = [];
  undoStack = [];

  // Suporte a formatos: { tables: [...] } ou [ ... ] diretamente
  ALL_TABLES = Array.isArray(data) ? data : (data.tables || []);
  selectedFieldsByTable = {};

  // Normaliza campos em branco
  ALL_TABLES.forEach(t => {
    if (!t.name)       t.name       = '(sem nome)';
    if (!t.tableGroup) t.tableGroup = 'None';
    if (!t.model) t.model = (Array.isArray(t.models) && t.models[0]) ? t.models[0] : 'Unknown';
    if (!Array.isArray(t.models) || !t.models.length) t.models = [t.model];
    t.models = [...new Set(t.models.map(m => String(m || '').trim()).filter(Boolean))];

    if (!Array.isArray(t.fields)) t.fields = [];
    t.fields = t.fields
      .map(f => ({
        name: String(f?.name || ''),
        type: String(f?.type || ''),
        extendedDataType: String(f?.extendedDataType || f?.edt || ''),
        enumType: String(f?.enumType || ''),
        sourceModels: Array.isArray(f?.sourceModels) ? [...new Set(f.sourceModels.map(x => String(x || '').trim()).filter(Boolean))] : [],
      }))
      .filter(f => f.name);

    if (!Array.isArray(t.relations)) t.relations = [];
    t.relations = t.relations
      .map(r => ({
        name: String(r?.name || ''),
        relatedTable: String(r?.relatedTable || ''),
        cardinality: String(r?.cardinality || ''),
        relatedTableCardinality: String(r?.relatedTableCardinality || ''),
        relationshipType: String(r?.relationshipType || ''),
        constraints: Array.isArray(r?.constraints)
          ? r.constraints
              .map(c => ({ field: String(c?.field || ''), relatedField: String(c?.relatedField || '') }))
              .filter(c => c.field && c.relatedField)
          : [],
        sourceModels: Array.isArray(r?.sourceModels) ? [...new Set(r.sourceModels.map(x => String(x || '').trim()).filter(Boolean))] : [],
      }))
      .filter(r => r.relatedTable && r.constraints.length);
  });

  // Filtra tabelas sem nome real
  ALL_TABLES = ALL_TABLES.filter(t => t.name && t.name !== '(sem nome)');

  // Índices
  tableIndex = {};
  relIndex   = {};
  inboundRelIndex = {};
  for (const t of ALL_TABLES) {
    tableIndex[t.name] = t;
    inboundRelIndex[t.name] = [];
  }
  for (const t of ALL_TABLES) {
    const set = new Set();
    for (const r of t.relations) {
      if (r.relatedTable && tableIndex[r.relatedTable]) {
        set.add(r.relatedTable);
        inboundRelIndex[r.relatedTable].push({ from: t.name, relation: r });
      }
    }
    relIndex[t.name] = set;
  }

  // UI
  document.getElementById('total-count').textContent = ALL_TABLES.length.toLocaleString();
  loadAppConfig();
  syncSettingsUI();

  populateGroupFilter();
  initVS();
  initCy();
  applyConfigToRuntime();
  buildLegend();
  hideOverlay();
}

// ── GROUP FILTER ───────────────────────────────────────────────────
function populateGroupFilter() {
  const groups = [...new Set(ALL_TABLES.map(t => t.tableGroup))].sort();
  const sel = document.getElementById('group-filter');
  sel.innerHTML = '<option value="">Todos os grupos</option>';
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = g;
    sel.appendChild(opt);
  });
}

// ── VIRTUAL SCROLL ─────────────────────────────────────────────────
function initVS() {
  vsFiltered = ALL_TABLES.slice().sort((a, b) => a.name.localeCompare(b.name));
  requestAnimationFrame(() => renderVS(true));
  updateListCount();
}

function onSearch() {
  const rawQ = document.getElementById('search-input').value.trim();
  const q = rawQ.toLowerCase();
  const group = document.getElementById('group-filter').value;
  const clearBtn = document.getElementById('clear-btn');

  clearBtn.classList.toggle('hidden', !rawQ);

  let regex = null;
  try { regex = rawQ ? new RegExp(rawQ, 'i') : null; } catch(e) { regex = null; }

  vsFiltered = ALL_TABLES.filter(t => {
    const matchQ = !rawQ || (regex ? regex.test(t.name) : t.name.toLowerCase().includes(q));
    const matchG = !group || t.tableGroup === group;
    return matchQ && matchG;
  });

  // Exact + prefix rank first for search, fallback to current sort order
  if (rawQ) {
    vsFiltered.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      if (aName === q) return -1;
      if (bName === q) return 1;
      if (aName.startsWith(q) && !bName.startsWith(q)) return -1;
      if (!aName.startsWith(q) && bName.startsWith(q)) return 1;
      return sortOrder === 'asc' ? aName.localeCompare(bName) : bName.localeCompare(aName);
    });
  } else {
    vsFiltered.sort((a, b) => sortOrder === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
  }

  const info = document.getElementById('search-info');
  info.textContent = rawQ
    ? `${vsFiltered.length.toLocaleString()} resultados para "${rawQ}"`
    : '';
  if (rawQ && vsFiltered.length === 0) info.textContent = `Nenhum resultado para "${rawQ}"`;

  vsContainer.scrollTop = 0;
  vsViewport = { start: -1, end: -1 };
  renderVS(true);
  updateListCount();
  if (!document.getElementById('dashboard-modal')?.classList.contains('hidden')) {
    renderMetadataDashboard();
  }
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  onSearch();
}

function updateListCount() {
  const rawQ = document.getElementById('search-input')?.value?.trim() || '';
  document.getElementById('list-count').textContent = vsFiltered.length.toLocaleString();
  document.getElementById('list-status').textContent = rawQ && vsFiltered.length === 0
      ? 'Nenhuma tabela encontrada. Revise filtros ou termo da busca.'
      : vsFiltered.length === ALL_TABLES.length
      ? `${ALL_TABLES.length.toLocaleString()} tabelas`
      : `${vsFiltered.length.toLocaleString()} de ${ALL_TABLES.length.toLocaleString()}`;
}

function renderVS(force = false) {
  const scrollTop     = vsContainer.scrollTop;
  const clientHeight  = vsContainer.clientHeight;
  const totalH        = vsFiltered.length * VS_H;
  vsInner.style.height = totalH + 'px';

  const start = Math.max(0, Math.floor(scrollTop / VS_H) - 2);
  const end   = Math.min(vsFiltered.length, Math.ceil((scrollTop + clientHeight) / VS_H) + 2);

  if (!force && start === vsViewport.start && end === vsViewport.end) return;
  vsViewport = { start, end };

  // Remove existing items
  vsInner.innerHTML = '';

  const inGraphNames = cy ? new Set(cy.nodes().map(n => n.id())) : new Set();
  const activeId     = currentDetail?.name;

  for (let i = start; i < end; i++) {
    const t   = vsFiltered[i];
    const col = groupColor(t.tableGroup);
    const div = document.createElement('div');
    div.className = 'table-item' +
      (inGraphNames.has(t.name) ? ' in-graph' : '') +
      (activeId === t.name      ? ' active'   : '');
    div.style.top = (i * VS_H) + 'px';
    div.dataset.name = t.name;
    div.innerHTML = `
      <span class="table-dot" style="background:${col.bg};border:1px solid ${col.border}"></span>
      <span class="table-name">${esc(t.name)}</span>
      <span class="table-group-tag">${esc(t.tableGroup)}</span>`;
    div.addEventListener('click', () => onTableClick(t));
    div.addEventListener('mouseenter', e => showTooltip(t, e.clientX, e.clientY));
    div.addEventListener('mouseleave', hideTooltip);
    div.addEventListener('mousemove',  e => updateTooltipPos(e.clientX, e.clientY));
    vsInner.appendChild(div);
  }
}

function onTableClick(t) {
  pushUndo();
  addTableToGraph(t.name);
  showDetail(t);
  renderVS(); // refresh active states
}

// ── CYTOSCAPE ──────────────────────────────────────────────────────
function initCy() {
  if (typeof cytoscape === 'undefined') {
    document.getElementById('graph-welcome').innerHTML =
      `<div class="welcome-icon">⚠️</div><h2 style="color:#f87171">Cytoscape.js não carregado</h2>
       <p>Esta ferramenta requer conexão com internet para carregar a biblioteca de grafos.<br/>
       Abra o arquivo via servidor local ou verifique sua conexão.</p>`;
    document.getElementById('graph-welcome').classList.remove('hidden');
    return;
  }
  cy = cytoscape({
    container: document.getElementById('cy'),
    elements: [],
    style: buildCyStyle(),
    layout: { name: 'preset' },
    minZoom: 0.1,
    maxZoom: 4,
    wheelSensitivity: 0.3,
  });
  cy.on('zoom', applyAutoFontScaling);
  applyAutoFontScaling();

  cy.on('tap', 'node', e => {
    const name = e.target.id();
    const t = tableIndex[name];
    // P3 US 3.2: canvas taps skip history (only relation navigation builds breadcrumbs)
    if (t) showDetail(t, true);
    if (appConfig.directionalHighlight) applyDirectionalHighlight(name);
  });

  cy.on('dblclick dbltap', 'node', e => {
    const name = e.target.id();
    expandTableInGraph(name, true);
  });

  // Shift+click enqueues node for multi-path (US 3.3)
  cy.on('tap', 'node', e => {
    if (e.originalEvent?.shiftKey) {
      const name = e.target.id();
      const idx = shiftPath.indexOf(name);
      if (idx >= 0) {
        shiftPath.splice(idx, 1);
        e.target.removeClass('shift-queued');
      } else {
        shiftPath.push(name);
        e.target.addClass('shift-queued');
      }
      updateShiftPathDisplay();
      if (shiftPath.length >= 2) {
        for (let i = 0; i < shiftPath.length - 1; i++) {
          const path = bfs(shiftPath[i], shiftPath[i + 1]);
          if (path) addPathToGraph(path);
        }
      }
      return;
    }
    // Ctrl+click selects nodes for query
    if (e.originalEvent?.ctrlKey || e.originalEvent?.metaKey) {
      e.target.toggleClass('path-selected');
      const selected = cy.nodes('.path-selected').map(n => n.id());
      if (selected.length === 2) {
        document.getElementById('path-from').value = selected[0];
        document.getElementById('path-to').value   = selected[1];
        cy.nodes('.path-selected').removeClass('path-selected');
        findPath();
      }
    }
  });

  // Tooltip on graph nodes (US 3.2)
  cy.on('mouseover', 'node', e => {
    const name = e.target.id();
    const t = tableIndex[name];
    if (!t) return;
    const pos = e.renderedPosition;
    const rect = document.getElementById('graph-container').getBoundingClientRect();
    showTooltip(t, rect.left + pos.x + 15, rect.top + pos.y + 10);
  });
  cy.on('mouseout', 'node', () => hideTooltip());
  cy.on('mousemove', 'node', e => {
    const pos = e.renderedPosition;
    const rect = document.getElementById('graph-container').getBoundingClientRect();
    updateTooltipPos(rect.left + pos.x + 15, rect.top + pos.y + 10);
  });

  cy.on('mousedown', 'node', e => {
    if (e.originalEvent?.button === 1) {
      e.originalEvent.preventDefault();
      e.originalEvent.stopPropagation();
      removeNodeFromGraph(e.target.id());
    }
  });

  // P3 US 2.2: update bubble origin when node is dragged
  cy.on('dragfree', 'node', e => {
    const id = e.target.id();
    if (bubblePhases[id]) {
      bubblePhases[id].ox = e.target.position('x');
      bubblePhases[id].oy = e.target.position('y');
      bubblePhases[id].t  = 0; // reset phase to avoid position jump
    }
  });

  // Set initial label button state (US 3.4)
  const labelsBtn = document.getElementById('toggle-labels-btn');
  if (labelsBtn) labelsBtn.classList.toggle('btn-primary', !!appConfig.showRelationName);
}

function buildCyStyle() {
  return [
    {
      selector: 'node',
      style: {
        'label':           'data(label)',
        'background-color': 'data(bgColor)',
        'border-color':    'data(borderColor)',
        'border-width':    2,
        'width':           'data(width)',
        'height':          34,
        'shape':           'roundrectangle',
        'font-size':       '10px',
        'color':           '#e5e7eb',
        'text-valign':     'center',
        'text-halign':     'center',
        'text-wrap':       'wrap',
        'text-max-width':  'data(labelWidth)',
        'min-zoomed-font-size': 6,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 3,
        'border-color': '#ffffff',
        'z-index': 20,
      },
    },
    {
      selector: 'node.highlighted',
      style: {
        'border-color': '#0078d4',
        'border-width': 4,
        'background-color': 'data(bgColorHL)',
      },
    },
    {
      selector: 'node.path-selected',
      style: {
        'border-color': '#f59e0b',
        'border-width': 3,
      },
    },
    {
      selector: 'node.shift-queued',
      style: {
        'border-color': '#22c55e',
        'border-width': 3,
      },
    },
    {
      selector: 'edge',
      style: {
        'width':                 1.5,
        'line-color':            '#374151',
        'target-arrow-color':    '#374151',
        'target-arrow-shape':    'triangle',
        'curve-style':           'bezier',
        'label':                 appConfig.showRelationName ? 'data(label)' : '',
        'source-label':          appConfig.showMultiplicity ? 'data(sourceCardinality)' : '',
        'target-label':          appConfig.showMultiplicity ? 'data(targetCardinality)' : '',
        'source-label-offset':   10,
        'target-label-offset':   10,
        'source-text-offset':    14,
        'target-text-offset':    14,
        'font-size':             '9px',
        'color':                 '#6b7280',
        'text-background-opacity': 0.85,
        'text-background-color':   '#13141f',
        'text-background-padding': '2px',
        'min-zoomed-font-size':  8,
      },
    },
    {
      selector: 'edge.highlighted',
      style: {
        'line-color':         '#0078d4',
        'target-arrow-color': '#0078d4',
        'width': 3,
        'color': '#93c5fd',
      },
    },
    {
      selector: 'edge.edge-outgoing',
      style: {
        'line-color': '#ef4444',
        'target-arrow-color': '#ef4444',
        'width': 3,
      },
    },
    {
      selector: 'edge.edge-incoming',
      style: {
        'line-color': '#22c55e',
        'target-arrow-color': '#22c55e',
        'width': 3,
      },
    },
    {
      // P3 US 1.2 – canvas node search highlight
      selector: 'node.canvas-highlighted',
      style: {
        'border-color': '#f59e0b',
        'border-width': 4,
        'overlay-color': '#f59e0b',
        'overlay-opacity': 0.15,
        'overlay-padding': 8,
      },
    },
  ];
}

function mapCardinalitySymbol(raw) {
  const m = {
    ZeroOne: '0..1',
    ExactlyOne: '1..1',
    ZeroMore: '0..*',
    OneMore: '1..*',
  };
  return m[raw] || '';
}

function buildRelationLabel(rel) {
  const constraints = rel?.constraints || [];
  const mapped = constraints.slice(0, 2).map(c =>
    c.field === c.relatedField ? c.field : `${c.field}=${c.relatedField}`
  ).join(', ');
  return rel?.name || mapped || '';
}

function buildEdgeData(id, source, target, rel) {
  return {
    id,
    source,
    target,
    label: buildRelationLabel(rel),
    sourceCardinality: mapCardinalitySymbol(rel?.cardinality),
    targetCardinality: mapCardinalitySymbol(rel?.relatedTableCardinality),
  };
}

function refreshEdgeLabels() {
  if (!cy) return;
  cy.edges().forEach(e => {
    const source = e.data('source');
    const target = e.data('target');
    let rel = (tableIndex[source]?.relations || []).find(r => r.relatedTable === target);
    if (!rel) {
      const reverse = (tableIndex[target]?.relations || []).find(r => r.relatedTable === source);
      if (reverse) rel = reverseRelation(reverse, source, target);
    }
    e.data('label', buildRelationLabel(rel));
    e.data('sourceCardinality', mapCardinalitySymbol(rel?.cardinality));
    e.data('targetCardinality', mapCardinalitySymbol(rel?.relatedTableCardinality));
  });
}

// Adiciona uma tabela ao grafo (apenas o nó, sem relações)
function addTableToGraph(name, position) {
  if (!tableIndex[name]) return;
  if (cy.getElementById(name).length > 0) return; // já existe

  const t   = tableIndex[name];
  const col = groupColor(t.tableGroup);
  const lbl = name.length > 20 ? name.slice(0, 18) + '…' : name;
  const w   = Math.max(100, Math.min(180, name.length * 7.5 + 16));

  cy.add({
    data: {
      id:          name,
      label:       lbl,
      labelWidth:  (w - 8) + 'px',
      width:       w,
      bgColor:     col.bg,
      bgColorHL:   col.bg,
      borderColor: col.border,
      tableGroup:  t.tableGroup,
    },
    position: position || randomPos(),
  });

  updateGraphStats();

  // US 1.1 – Auto-linking with existing nodes
  cy.nodes().forEach(n => {
    const existingName = n.id();
    if (existingName === name) return;
    const edgeId  = `${name}→${existingName}`;
    const edgeIdR = `${existingName}→${name}`;
    if (cy.getElementById(edgeId).length > 0 || cy.getElementById(edgeIdR).length > 0) return;

      let constraintLabel = '';
      if (relIndex[name] && relIndex[name].has(existingName)) {
        const rel = (tableIndex[name].relations || []).find(r => r.relatedTable === existingName);
        constraintLabel = buildRelationLabel(rel);
        cy.add({ data: buildEdgeData(edgeId, name, existingName, rel) });
      } else if (relIndex[existingName] && relIndex[existingName].has(name)) {
        const rel = (tableIndex[existingName].relations || []).find(r => r.relatedTable === name);
        constraintLabel = buildRelationLabel(rel);
        cy.add({ data: buildEdgeData(edgeIdR, existingName, name, rel) });
      }
  });
}

// Expande as relações de 1º nível de uma tabela
function expandTableInGraph(name, runLayout) {
  const t = tableIndex[name];
  if (!t) return;
  pushUndo();

  if (expansionMode === 'manual') {
    addTableToGraph(name);
    updateGraphStats();
    return;
  }
  if (expansionMode === 'filtered') {
    showExpansionDialog(name, runLayout);
    return;
  }

  // full mode (default)
  addTableToGraph(name);

  const newNodes = [];
  t.relations.forEach(rel => {
    const rName = rel.relatedTable;
    if (!rName || !tableIndex[rName]) return;
    const isNew = cy.getElementById(rName).length === 0;
    addTableToGraph(rName);
    if (isNew) newNodes.push(rName);

    const edgeId = `${name}→${rName}`;
    const edgeIdR = `${rName}→${name}`;
    if (cy.getElementById(edgeId).length === 0 && cy.getElementById(edgeIdR).length === 0) {
      const constraintLabel = buildRelationLabel(rel);
      cy.add({ data: buildEdgeData(edgeId, name, rName, rel) });
    }
  });

  if (runLayout && newNodes.length > 0) {
    applyLayout();
  }

  updateGraphStats();
}

function applyLayout(layoutName) {
  if (!cy || cy.nodes().length === 0) return;
  const name = layoutName || appConfig.layout || document.getElementById('layout-select').value;
  appConfig.layout = name;

  // P3 US 2.1: pause bubble during layout, resume after with updated origins
  const wasBubbling = bubbleAnimEnabled;
  if (wasBubbling) {
    cancelAnimationFrame(bubbleRaf);
    bubbleRaf = null;
  }

  const layout = cy.layout({
    name,
    animate: true,
    animationDuration: 500,
    padding: 40,
    nodeRepulsion: appConfig.nodeRepulsion || 8000,
    idealEdgeLength: appConfig.idealEdgeLength || 120,
    edgeElasticity: 0.45,
    nestingFactor: 1.2,
    gravity: 0.25,
    numIter: 1000,
    nodeDimensionsIncludeLabels: true,
  });

  if (wasBubbling) {
    layout.on('layoutstop', () => {
      // Update bubble origins to new post-layout positions, then restart
      cy.nodes().forEach(n => {
        if (bubblePhases[n.id()]) {
          bubblePhases[n.id()].ox = n.position('x');
          bubblePhases[n.id()].oy = n.position('y');
          bubblePhases[n.id()].t  = Math.random() * Math.PI * 2;
        }
      });
      startBubbleAnim();
    });
  }

  layout.run();
}

function clearGraph(withUndo = true) {
  if (withUndo) pushUndo();
  cy?.elements().remove();
  clearDirectionalHighlight();
  closeDetail();
  updateGraphStats();
  renderVS();
}

function fitGraph() {
  cy?.fit(undefined, 40);
}

function graphCenter() {
  const w = document.getElementById('graph-container').clientWidth;
  const h = document.getElementById('graph-container').clientHeight;
  return { x: w / 2, y: h / 2 };
}

function randomPos() {
  const w = document.getElementById('graph-container').clientWidth  || 800;
  const h = document.getElementById('graph-container').clientHeight || 600;
  return {
    x: 80 + Math.random() * (w - 160),
    y: 80 + Math.random() * (h - 160),
  };
}

function toggleLabels() {
  appConfig.showRelationName = !appConfig.showRelationName;
  cy?.style().selector('edge').style('label', appConfig.showRelationName ? 'data(label)' : '').update();
  const btn = document.getElementById('toggle-labels-btn');
  btn.classList.toggle('btn-primary', appConfig.showRelationName);
  syncSettingsUI();
  saveAppConfig();
}

function updateGraphStats() {
  const nodes = cy?.nodes().length || 0;
  const edges = cy?.edges().length || 0;
  const badge = document.getElementById('graph-node-count');
  if (nodes > 0) {
    badge.textContent = `${nodes} tabelas · ${edges} relações`;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
  syncWelcomeVisibility();
}

function syncWelcomeVisibility() {
  const welcome = document.getElementById('graph-welcome');
  if (!welcome) return;
  const hasNodes = (cy?.nodes().length || 0) > 0;
  welcome.classList.toggle('hidden', hasNodes);
}

function clearDirectionalHighlight() {
  cy?.edges().removeClass('edge-outgoing edge-incoming');
}

function applyDirectionalHighlight(nodeName) {
  if (!cy) return;
  clearDirectionalHighlight();
  const node = cy.getElementById(nodeName);
  if (!node || node.length === 0) return;
  node.connectedEdges().forEach(edge => {
    if (edge.hasClass('highlighted')) return; // keep pathfinding priority
    if (edge.data('source') === nodeName) edge.addClass('edge-outgoing');
    if (edge.data('target') === nodeName) edge.addClass('edge-incoming');
  });
}

// ── CANVAS NODE SEARCH (P3 US 1.2) ────────────────────────────────
function searchInCanvas() {
  const inp     = document.getElementById('canvas-search-input');
  const clearBtn = document.getElementById('canvas-search-clear');
  const q = inp.value.trim();

  clearBtn.classList.toggle('hidden', !q);
  cy?.nodes().removeClass('canvas-highlighted');
  inp.classList.remove('not-found');

  if (!q || !cy) return;

  const regex = window.D365Search?.createSafeRegex ? window.D365Search.createSafeRegex(q) : (() => {
    try { return new RegExp(q, 'i'); } catch { return null; }
  })();
  if (!regex) {
    inp.classList.add('not-found');
    return;
  }

  const matches = cy.nodes().filter(n => regex.test(n.id()));
  if (matches.length > 0) {
    matches.addClass('canvas-highlighted');
    const center = window.D365Search?.centerOfNodes ? window.D365Search.centerOfNodes(matches.toArray()) : null;
    if (center) {
      cy.animate({ center, zoom: Math.max(cy.zoom(), 1.1) }, { duration: 400 });
    } else {
      cy.fit(matches, 80);
    }
  } else {
    inp.classList.add('not-found');
  }
}

// ── LEGEND ─────────────────────────────────────────────────────────
function buildLegend() {
  const groups = ['Main', 'Transaction', 'Group', 'WorksheetHeader', 'WorksheetLine', 'Staging', 'None'];
  const legend = document.getElementById('graph-legend');
  legend.innerHTML = groups.map(g => {
    const c = groupColor(g);
    return `<div class="legend-item">
      <span class="legend-dot" style="background:${c.bg};border:1px solid ${c.border}"></span>
      <span>${g}</span>
    </div>`;
  }).join('');
}

// ── DETAIL PANEL ───────────────────────────────────────────────────
function showDetail(t, skipHistory = false) {
  if (!skipHistory && currentDetail !== null && currentDetail.name !== t.name) {
    detailHistory.push(currentDetail);
  }
  currentDetail = t;
  const col = groupColor(t.tableGroup);

  document.getElementById('detail-table-name').textContent = t.name;
  const tag = document.getElementById('detail-group-tag');
  tag.textContent  = t.tableGroup;
  tag.className    = `tag ${col.tag}`;

  document.getElementById('tab-fields-count').textContent  = t.fields.length;
  document.getElementById('tab-rels-count').textContent    = t.relations.length;

  // Fields
  renderFields(t.fields, t.name);
  // Relations
  renderRelations(t.relations, t.name);
  // Reset query tab
  resetQueryTab();

  document.getElementById('detail-panel').classList.remove('hidden');
  document.getElementById('back-detail-btn').style.display = detailHistory.length > 0 ? '' : 'none';
  // Keep current active tab
  renderVS();
  renderBreadcrumbs();
}

function closeDetail() {
  document.getElementById('detail-panel').classList.add('hidden');
  currentDetail = null;
  detailHistory = [];
  renderVS();
  renderBreadcrumbs();
}

// ── NAVIGATION HISTORY (US 2.2) ────────────────────────────────────
function navigateBack() {
  if (detailHistory.length === 0) return;
  const prev = detailHistory.pop();
  showDetail(prev, true);
}

// ── TOOLTIP (US 3.2) ──────────────────────────────────────────────
function showTooltip(t, x, y) {
  document.getElementById('tt-name').textContent   = t.name;
  document.getElementById('tt-group').textContent  = t.tableGroup;
  document.getElementById('tt-fields').textContent = t.fields.length;
  document.getElementById('tt-rels').textContent   = t.relations.length;
  const el = document.getElementById('hover-tooltip');
  el.classList.remove('hidden');
  updateTooltipPos(x, y);
}

function hideTooltip() {
  document.getElementById('hover-tooltip').classList.add('hidden');
}

function updateTooltipPos(x, y) {
  const el = document.getElementById('hover-tooltip');
  if (!el || el.classList.contains('hidden')) return;
  const tw = el.offsetWidth  || 240;
  const th = el.offsetHeight || 100;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let lx = x + 15;
  let ly = y + 10;
  if (lx + tw > vw) lx = x - tw - 10;
  if (ly + th > vh) ly = y - th - 10;
  el.style.left = lx + 'px';
  el.style.top  = ly + 'px';
}

// ── EXPANSION DIALOG (US 3.1) ─────────────────────────────────────
let pendingExpansionName      = null;
let pendingExpansionRunLayout = false;

function showExpansionDialog(name, runLayout) {
  const t = tableIndex[name];
  if (!t) return;
  pendingExpansionName      = name;
  pendingExpansionRunLayout = !!runLayout;

  // P3 US 2.3: hide tooltip when dialog opens
  hideTooltip();
  // P3 US 1.3: reset filter
  const filterInput = document.getElementById('expansion-dialog-filter');
  if (filterInput) filterInput.value = '';

  const list = document.getElementById('expansion-dialog-list');
  list.innerHTML = '';
  t.relations.forEach(rel => {
    const rName = rel.relatedTable;
    if (!rName || !tableIndex[rName]) return;
    const label = document.createElement('label');
    label.className = 'exp-dialog-item';
    label.style.display = '';
    const cb = document.createElement('input');
    cb.type  = 'checkbox';
    cb.value = rName;
    cb.checked = true;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + rName));
    list.appendChild(label);
  });

  document.getElementById('expansion-dialog').classList.remove('hidden');
}

function confirmExpansion() {
  const name      = pendingExpansionName;
  const runLayout = pendingExpansionRunLayout;
  document.getElementById('expansion-dialog').classList.add('hidden');
  if (!name) return;
  pushUndo();

  const t = tableIndex[name];
  if (!t) return;
  addTableToGraph(name);

  const checked = new Set(
    [...document.querySelectorAll('#expansion-dialog-list input[type="checkbox"]:checked')]
      .map(cb => cb.value)
  );

  const newNodes = [];
  t.relations.forEach(rel => {
    const rName = rel.relatedTable;
    if (!rName || !tableIndex[rName] || !checked.has(rName)) return;
    const isNew = cy.getElementById(rName).length === 0;
    addTableToGraph(rName);
    if (isNew) newNodes.push(rName);
    const edgeId  = `${name}→${rName}`;
    const edgeIdR = `${rName}→${name}`;
    if (cy.getElementById(edgeId).length === 0 && cy.getElementById(edgeIdR).length === 0) {
      const constraintLabel = buildRelationLabel(rel);
      cy.add({ data: buildEdgeData(edgeId, name, rName, rel) });
    }
  });

  if (runLayout && newNodes.length > 0) applyLayout();
  updateGraphStats();
}

// ── SHIFT PATH (US 3.3) ───────────────────────────────────────────
function updateShiftPathDisplay() {
  const display = document.getElementById('shift-path-display');
  const badge   = document.getElementById('shift-path-badge');
  if (!display || !badge) return;
  if (shiftPath.length === 0) {
    display.classList.add('hidden');
  } else {
    badge.textContent = shiftPath.join(' → ');
    display.classList.remove('hidden');
  }
}

function clearShiftPath() {
  cy?.elements().removeClass('highlighted');
  shiftPath.forEach(name => cy?.getElementById(name).removeClass('shift-queued'));
  shiftPath = [];
  updateShiftPathDisplay();
}

// ── FIELDS ─────────────────────────────────────────────────────────
let allFields = [];
let currentFieldsTableName = '';

function renderFields(fields, tableName) {
  allFields = fields;
  currentFieldsTableName = tableName || '';
  document.getElementById('fields-filter').value = '';
  applyFieldFilter('');
}

function filterFields() {
  applyFieldFilter(document.getElementById('fields-filter').value.toLowerCase());
}

function applyFieldFilter(q) {
  const filtered = q
    ? allFields.filter(f => (f.name || '').toLowerCase().includes(q) ||
                             (f.type || '').toLowerCase().includes(q) ||
                             (f.edt  || '').toLowerCase().includes(q))
    : allFields;

  const tbody = document.getElementById('fields-tbody');
  const empty = document.getElementById('fields-empty');

  document.getElementById('fields-shown-count').textContent =
    `${filtered.length} / ${allFields.length}`;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = filtered.map(f => {
    const rawType = f.type || '';
    const type = rawType.replace(/^AxTableField/, '');
    const edt  = f.edt || f.extendedDataType || f.enumType || '';
    const tableSet = selectedFieldsByTable[currentFieldsTableName] || new Set();
    const checked = tableSet.has(f.name || '');
    return `<tr class="field-row" tabindex="0">
      <td><input class="field-select-cb" type="checkbox" data-field="${esc(f.name || '')}" ${checked ? 'checked' : ''} /></td>
      <td>${esc(f.name || '')}</td>
      <td><span class="type-badge">${esc(type)}</span></td>
      <td>${edt ? `<span class="edt-badge">${esc(edt)}</span>` : '<span class="no">—</span>'}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.field-select-cb').forEach(cb => cb.addEventListener('change', e => {
    if (!currentFieldsTableName) return;
    if (!selectedFieldsByTable[currentFieldsTableName]) selectedFieldsByTable[currentFieldsTableName] = new Set();
    const set = selectedFieldsByTable[currentFieldsTableName];
    const name = e.target.dataset.field;
    if (e.target.checked) set.add(name); else set.delete(name);
  }));

  // Keyboard navigation: up/down to move focus, space to toggle checkbox
  const rows = [...tbody.querySelectorAll('.field-row')];
  rows.forEach((row, idx) => {
    row.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        rows[Math.min(idx + 1, rows.length - 1)]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        rows[Math.max(idx - 1, 0)]?.focus();
      } else if (e.key === ' ') {
        e.preventDefault();
        const cb = row.querySelector('.field-select-cb');
        if (cb) {
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
  });
}

// ── RELATIONS ──────────────────────────────────────────────────────
let allRelations = [];
let currentRelTableName = '';

function renderRelations(relations, tableName) {
  allRelations   = relations;
  currentRelTableName = tableName;
  document.getElementById('rels-filter').value = '';
  applyRelFilter('');
}

function filterRelations() {
  applyRelFilter(document.getElementById('rels-filter').value.toLowerCase());
}

function applyRelFilter(q) {
  const filtered = q
    ? allRelations.filter(r =>
        (r.name         || '').toLowerCase().includes(q) ||
        (r.relatedTable || '').toLowerCase().includes(q))
    : allRelations;

  const list  = document.getElementById('relations-list');
  const empty = document.getElementById('rels-empty');

  document.getElementById('rels-shown-count').textContent =
    `${filtered.length} / ${allRelations.length}`;

  if (filtered.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = '';
  filtered.forEach(r => {
    const card = document.createElement('div');
    card.className = 'nav-card';
    const constraintsHtml = (r.constraints || []).map(c =>
      `<div class="nav-constraint">
        <span>${esc(c.field)}</span>
        <span class="nav-constraint-arrow">→</span>
        <span>${esc(c.relatedField)}</span>
      </div>`
    ).join('');

    card.innerHTML = `
      <div class="nav-card-top">
        <span class="nav-name">${esc(r.name || r.relatedTable)}</span>
        ${r.cardinality ? `<span class="cardinality-badge">${esc(r.cardinality)}</span>` : ''}
      </div>
      <div>
        <span style="font-size:11px;color:var(--text-muted)">→ </span>
        <span class="nav-related" data-table="${esc(r.relatedTable)}">${esc(r.relatedTable)}</span>
      </div>
      ${constraintsHtml ? `<div class="nav-card-constraints">${constraintsHtml}</div>` : ''}`;

    // P3 US 3.1: Click on relation → navigate detail only (no canvas add)
    // The "Adicionar trilha ao canvas" breadcrumb button handles adding to graph
    card.addEventListener('click', () => {
      const rName = r.relatedTable;
      if (tableIndex[rName]) {
        showDetail(tableIndex[rName]); // skipHistory=false → builds breadcrumb trail
      }
    });

    list.appendChild(card);
  });
}

// ── TABS ───────────────────────────────────────────────────────────
function switchTab(tabId, fromUserClick = false) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-content').forEach(c =>
    c.classList.toggle('active', c.id === `tab-${tabId}`));
  if (fromUserClick && tabId === 'query') {
    if (queryPath && queryPath.length > 1) {
      renderQueryAccordion(queryPath);
    } else if (currentDetail) {
      genSimpleQuery();
    }
  }
}

// ── QUERY GENERATOR ────────────────────────────────────────────────
function resetQueryTab() {
  document.getElementById('query-hint').classList.remove('hidden');
  document.getElementById('query-output').classList.add('hidden');
  document.getElementById('query-accordion').classList.add('hidden');
  document.getElementById('toggle-while-select-btn').classList.add('hidden');
}

function getSelectedFields(tableName) {
  const set = selectedFieldsByTable[tableName];
  if (!set || set.size === 0) return [];
  return [...set];
}

function getSqlProjection(tableName, alias) {
  const picked = getSelectedFields(tableName);
  if (picked.length === 0) return [`${alias}.*`];
  const out = picked.map(f => `${alias}.${f}`);
  if (appConfig.includeSystemFields) {
    out.push(`${alias}.DataAreaId`, `${alias}.Partition`);
  }
  return out;
}

function genSimpleQuery() {
  if (!currentDetail) return;
  const t = currentDetail;
  const alias = tableAlias(t.name);
  const selected = getSqlProjection(t.name, alias);
  const topFields = selected.map(f => `    ${f}`).join(',\n');
  const xppPicked = getSelectedFields(t.name);
  const xppSelectExpr = xppPicked.length ? xppPicked.join(', ') : alias;

  const sql = `<span class="kw">SELECT</span>\n${topFields}\n<span class="kw">FROM</span> <span class="tbl">${t.name}</span> <span class="kw">AS</span> <span class="tbl">${alias}</span>`;
  const xpp = `<span class="kw">select</span> ${esc(xppSelectExpr)}\n    <span class="kw">from</span> <span class="tbl">${t.name}</span>;`;

  document.getElementById('sql-output').innerHTML = sql;
  document.getElementById('xpp-output').innerHTML = xpp;
  document.getElementById('query-path-label').textContent = `Tabela: ${t.name}`;
  document.getElementById('toggle-while-select-btn').classList.add('hidden');
  document.getElementById('query-hint').classList.add('hidden');
  document.getElementById('query-accordion').classList.add('hidden');
  document.getElementById('query-output').classList.remove('hidden');
  switchTab('query');
}

function generatePathQuery(path) {
  if (!path || path.length < 2) return;
  queryPath = path;
  const lastRel = path[path.length - 2]?.relation;
  const many = window.D365Pathfinding?.shouldUseWhileSelect
    ? window.D365Pathfinding.shouldUseWhileSelect(lastRel)
    : ['ZeroMore', 'OneMore'].includes(lastRel?.relatedTableCardinality);
  whileSelectMode = many && appConfig.defaultIterative;
  const toggleBtn = document.getElementById('toggle-while-select-btn');
  toggleBtn.classList.toggle('hidden', !many);
  toggleBtn.classList.toggle('btn-primary', whileSelectMode);
  renderQueryAccordion(path);
  switchTab('query');
}

function tableAlias(name) {
  // Gera um alias a partir do nome da tabela (primeiras letras dos segmentos)
  const parts = name.replace(/([A-Z])/g, ' $1').trim().split(' ').filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, 3).map(p => p[0].toLowerCase()).join('');
  return name.slice(0, 2).toLowerCase();
}

function copyCode(preId, btn) {
  const el  = document.getElementById(preId);
  const txt = el ? el.innerText : '';
  navigator.clipboard.writeText(txt).then(() => {
    if (btn) { btn.textContent = '✅ Copiado'; btn.classList.add('copied'); }
    setTimeout(() => {
      if (btn) { btn.textContent = '📋 Copiar'; btn.classList.remove('copied'); }
    }, 2000);
  });
}

// ── PATHFINDING (BFS) ──────────────────────────────────────────────
function findPath() {
  cy?.elements().removeClass('highlighted');
  clearDirectionalHighlight();
  const fromName = document.getElementById('path-from').value.trim();
  const toName   = document.getElementById('path-to').value.trim();
  const waypointInputs = document.querySelectorAll('#waypoints-container input');
  const waypoints = [...waypointInputs].map(i => i.value.trim()).filter(Boolean);
  const resultEl = document.getElementById('path-result');

  if (!fromName || !toName) {
    showPathResult('⚠ Preencha os dois campos.', 'error');
    return;
  }
  if (!tableIndex[fromName]) {
    showPathResult(`❌ Tabela "${fromName}" não encontrada.`, 'error');
    return;
  }
  if (!tableIndex[toName]) {
    showPathResult(`❌ Tabela "${toName}" não encontrada.`, 'error');
    return;
  }
  for (const wp of waypoints) {
    if (!tableIndex[wp]) {
      showPathResult(`❌ Tabela "${wp}" não encontrada.`, 'error');
      return;
    }
  }
  if (fromName === toName) {
    showPathResult('⚠ Origem e destino são iguais.', 'error');
    return;
  }

  const stops = [fromName, ...waypoints, toName];
  let fullPath = null;

  for (let i = 0; i < stops.length - 1; i++) {
    const seg = bfs(stops[i], stops[i + 1], appConfig.maxDepth || 8);
    if (!seg) {
      showPathResult(`❌ Nenhum caminho encontrado entre "${stops[i]}" e "${stops[i+1]}" (máx. ${appConfig.maxDepth || 8} saltos).`, 'error');
      return;
    }
    if (fullPath === null) {
      fullPath = seg;
    } else {
      fullPath = fullPath.concat(seg.slice(1)); // skip first to avoid duplicate junction
    }
  }

  renderPathResult(fullPath);
  addPathToGraph(fullPath);
  generatePathQuery(fullPath);
}

function bfs(start, end, maxDepth = 8) {
  // Cada item na fila: { name, path: [{ table, relation }] }
  const queue   = [{ name: start, path: [{ table: start, relation: null }] }];
  const visited = new Set([start]);

  while (queue.length > 0) {
    const { name, path } = queue.shift();
    if (path.length > maxDepth + 1) continue;

    const t = tableIndex[name];
    if (!t) continue;

    const neighbors = [];
    for (const rel of t.relations) {
      if (rel.relatedTable && tableIndex[rel.relatedTable]) {
        neighbors.push({ next: rel.relatedTable, relation: rel });
      }
    }
    if (!appConfig.strictDirection) {
      for (const inbound of inboundRelIndex[name] || []) {
        const reversed = reverseRelation(inbound.relation, name, inbound.from);
        neighbors.push({ next: inbound.from, relation: reversed });
      }
    }
    const ranked = prioritizeNeighbors(neighbors, end);
    for (const item of ranked) {
      const next = item.next;
      if (!next || visited.has(next) || !tableIndex[next]) continue;
      visited.add(next);
      const newPath = [...path, { table: next, relation: item.relation }];
      if (next === end) return newPath;
      queue.push({ name: next, path: newPath });
    }
  }
  return null;
}

function relationPriorityScore(rel, targetTable) {
  if (!rel) return 99;
  if (rel.name === targetTable) return 0;
  const constraints = rel.constraints || [];
  const business = constraints.some(c =>
    /(Id|Account|RecId)$/i.test(c.field || '') || /(Id|Account|RecId)$/i.test(c.relatedField || '')
  );
  return business ? 1 : 2;
}

function prioritizeNeighbors(neighbors, targetTable) {
  return neighbors.slice().sort((a, b) => {
    const sa = relationPriorityScore(a.relation, targetTable);
    const sb = relationPriorityScore(b.relation, targetTable);
    if (sa !== sb) return sa - sb;
    return String(a.next).localeCompare(String(b.next));
  });
}

function reverseRelation(rel, sourceName, targetName) {
  return {
    name: rel.name,
    relatedTable: targetName,
    cardinality: rel.relatedTableCardinality || rel.cardinality,
    relatedTableCardinality: rel.cardinality,
    constraints: (rel.constraints || []).map(c => ({
      field: c.relatedField,
      relatedField: c.field,
    })),
    __reversed: true,
    __source: sourceName,
    __target: targetName,
  };
}

function addPathToGraph(path) {
  // Limpar highlights anteriores
  cy?.elements().removeClass('highlighted');

  path.forEach(step => addTableToGraph(step.table));

  for (let i = 1; i < path.length; i++) {
    const src = path[i - 1].table;
    const tgt = path[i].table;
    const rel = path[i - 1].relation;
    const edgeId  = `${src}→${tgt}`;
    const edgeIdR = `${tgt}→${src}`;
    if (cy.getElementById(edgeId).length === 0 && cy.getElementById(edgeIdR).length === 0) {
      const label = buildRelationLabel(rel);
      cy.add({ data: buildEdgeData(edgeId, src, tgt, rel) });
    }
    cy.getElementById(edgeId).addClass('highlighted');
    cy.getElementById(edgeIdR).addClass('highlighted');
    cy.getElementById(src).addClass('highlighted');
    cy.getElementById(tgt).addClass('highlighted');
  }

  updateGraphStats();
}

function renderPathResult(path) {
  const el = document.getElementById('path-result');
  el.classList.remove('hidden');

  if (!path || path.length === 0) {
    el.innerHTML = '<div class="path-no-result">❌ Nenhum caminho encontrado.</div>';
    return;
  }

  const steps = path.map((step, i) => {
    const rel = step.relation;
    const joinInfo = rel?.constraints?.slice(0, 2).map(c => `${c.field} = ${c.relatedField}`).join(', ') || '';
    return `${i > 0 ? '<div class="path-arrow">↓</div>' : ''}
      <div class="path-step">
        <span class="path-step-icon">${i === 0 ? '🟢' : i === path.length - 1 ? '🔴' : '🔵'}</span>
        <div class="path-step-info">
          <div class="path-step-table">${esc(step.table)}</div>
          ${joinInfo ? `<div class="path-step-join">${esc(joinInfo)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `<button class="clear-path-result-btn" id="clear-path-result-btn">✕ Limpar Resultado</button><div style="font-size:11px;color:#6b7280;margin-bottom:6px">${path.length - 1} salto${path.length > 2 ? 's' : ''}</div>${steps}`;

  document.getElementById('clear-path-result-btn').addEventListener('click', () => {
    el.innerHTML = '';
    el.classList.add('hidden');
    cy?.elements().removeClass('highlighted');
  });

  const start = path[0].table;
  const end = path[path.length - 1].table;
  renderAltRoutes(start, end);
}

function showPathResult(msg, type) {
  const el = document.getElementById('path-result');
  el.classList.remove('hidden');
  el.innerHTML = `<div class="path-no-result">${esc(msg)}</div>`;
}

// ── UNDO (US 3.2) ──────────────────────────────────────────────────
function pushUndo() {
  if (!cy) return;
  undoStack.push(cy.elements().jsons());
  if (undoStack.length > 10) undoStack.shift();
  updateUndoBtn();
}

function undoAction() {
  if (undoStack.length === 0) return;
  const snapshot = undoStack.pop();
  cy.elements().remove();
  cy.add(snapshot);
  updateGraphStats();
  renderVS();
  updateUndoBtn();
}

function applyAutoFontScaling() {
  if (!cy || !autoZoomFontEnabled) return;
  const z = Math.max(0.2, cy.zoom());
  const nodeFont = Math.max(10, Math.min(18, 11 / z));
  const edgeFont = Math.max(8, Math.min(14, 9 / z));
  cy.style()
    .selector('node').style('font-size', `${nodeFont}px`)
    .selector('edge').style('font-size', `${edgeFont}px`)
    .update();
}

function toggleSidebarCollapse() {
  const sidebar = document.querySelector('.sidebar');
  const btn = document.getElementById('toggle-sidebar-btn');
  const collapsed = sidebar.classList.toggle('collapsed');
  btn.textContent = collapsed ? '▶' : '◀';
  btn.title = collapsed ? 'Expandir sidebar' : 'Minimizar sidebar';
  setTimeout(() => cy?.resize(), 220);
}

function toggleDetailCollapse() {
  const panel = document.getElementById('detail-panel');
  const btn = document.getElementById('toggle-detail-btn');
  const collapsed = panel.classList.toggle('collapsed');
  btn.textContent = collapsed ? '◀' : '▶';
  btn.title = collapsed ? 'Expandir painel' : 'Minimizar painel';
  const resizer = document.getElementById('detail-resizer');
  if (resizer) resizer.style.display = collapsed ? 'none' : '';
  setTimeout(() => cy?.resize(), 220);
}

function updateUndoBtn() {
  const btn = document.getElementById('undo-btn');
  if (btn) {
    btn.disabled = undoStack.length === 0;
    btn.classList.toggle('disabled', undoStack.length === 0);
  }
}

// ── REMOVE NODE (US 3.1) ───────────────────────────────────────────
function removeNodeFromGraph(name) {
  pushUndo();
  cy.getElementById(name).connectedEdges().remove();
  cy.getElementById(name).remove();
  updateGraphStats();
  renderVS();
}

// ── BREADCRUMBS (US 2.2) ───────────────────────────────────────────
function renderBreadcrumbs() {
  const el = document.getElementById('detail-breadcrumbs');
  if (!el) return;
  if (detailHistory.length === 0 && !currentDetail) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  let html = '';
  detailHistory.forEach((t, i) => {
    html += `<span class="breadcrumb-item" data-idx="${i}">${esc(t.name)}</span>`;
    html += `<span class="breadcrumb-sep"> > </span>`;
  });
  if (currentDetail) {
    html += `<span class="breadcrumb-current">${esc(currentDetail.name)}</span>`;
  }
  if (detailHistory.length > 0) {
    html += `<button class="btn btn-ghost btn-sm add-trail-btn" id="add-trail-to-graph-btn">📌 Adicionar trilha ao canvas</button>`;
  }
  el.innerHTML = html;
}

// ── BFS MULTIPLE ROUTES (US 1.3) ───────────────────────────────────
function bfsMultiple(start, end, maxRoutes = 5, maxDepth = appConfig.maxDepth || 8) {
  if (!tableIndex[start] || !tableIndex[end]) return [];
  const routes = [];
  const stack = [{ name: start, path: [{ table: start, relation: null }], visited: new Set([start]) }];
  let iterations = 0;

  while (stack.length > 0 && routes.length < maxRoutes && iterations < 50000) {
    iterations++;
    const { name, path, visited } = stack.pop();
    if (path.length > maxDepth + 1) continue;

    const t = tableIndex[name];
    if (!t) continue;

    const neighbors = [];
    for (const rel of t.relations) {
      if (rel.relatedTable && tableIndex[rel.relatedTable]) {
        neighbors.push({ next: rel.relatedTable, relation: rel });
      }
    }
    if (!appConfig.strictDirection) {
      for (const inbound of inboundRelIndex[name] || []) {
        neighbors.push({ next: inbound.from, relation: reverseRelation(inbound.relation, name, inbound.from) });
      }
    }
    const ranked = prioritizeNeighbors(neighbors, end);
    for (const item of ranked) {
      const next = item.next;
      if (!next || visited.has(next) || !tableIndex[next]) continue;
      const newPath = [...path, { table: next, relation: item.relation }];
      if (next === end) {
        routes.push(newPath);
        if (routes.length >= maxRoutes) break;
      } else {
        const newVisited = new Set(visited);
        newVisited.add(next);
        stack.push({ name: next, path: newPath, visited: newVisited });
      }
    }
  }
  return routes.sort((a, b) => a.length - b.length);
}

function renderAltRoutes(start, end) {
  const resultEl = document.getElementById('path-result');
  if (!resultEl) return;
  // Remove any previous alt-routes container
  resultEl.querySelector('.alt-routes-container')?.remove();

  const routes = bfsMultiple(start, end);
  if (routes.length === 0) return;

  const items = routes.map((route, i) => {
    const hops = route.length - 1;
    const label = route.map(s => s.table).join(' → ');
    return `<div class="alt-route-item" data-idx="${i}"><span class="alt-route-hops">${hops} salto${hops !== 1 ? 's' : ''}:</span>${esc(label)}</div>`;
  }).join('');

  const container = document.createElement('div');
  container.className = 'alt-routes-container';
  container.innerHTML = `
    <div class="alt-routes-header">
      🔀 Rotas Alternativas (${routes.length})
      <button class="alt-routes-toggle-btn" title="Recolher/Expandir">▲</button>
    </div>
    <div class="alt-routes-list">${items}</div>`;
  resultEl.appendChild(container);

  // Toggle collapse
  container.querySelector('.alt-routes-toggle-btn').addEventListener('click', () => {
    const list = container.querySelector('.alt-routes-list');
    const btn  = container.querySelector('.alt-routes-toggle-btn');
    const collapsed = list.classList.toggle('collapsed');
    btn.textContent = collapsed ? '▼' : '▲';
  });

  // Click route → render on graph
  container.querySelectorAll('.alt-route-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      addPathToGraph(routes[i]);
      generatePathQuery(routes[i]);
    });
  });
}

// ── QUERY ACCORDION (US 4.1) ───────────────────────────────────────
function renderQueryAccordion(path) {
  const accordion = document.getElementById('query-accordion');
  const hint = document.getElementById('query-hint');
  const output = document.getElementById('query-output');
  if (!accordion || !path || path.length < 2) return;

  hint.classList.add('hidden');
  output.classList.add('hidden');
  accordion.classList.remove('hidden');

  function buildQueryBlock(sqlHtml, xppHtml) {
    return `<h4 class="query-lang-label">SQL</h4>
<div class="code-block">
  <pre class="query-pre">${sqlHtml}</pre>
  <button class="copy-btn" onclick="this.previousElementSibling.innerText && navigator.clipboard.writeText(this.previousElementSibling.innerText).then(()=>{this.textContent='✅ Copiado';setTimeout(()=>this.textContent='📋 Copiar',2000)})">📋 Copiar</button>
</div>
<h4 class="query-lang-label" style="margin-top:14px">X++ (select statement)</h4>
<div class="code-block">
  <pre class="query-pre">${xppHtml}</pre>
  <button class="copy-btn" onclick="this.previousElementSibling.innerText && navigator.clipboard.writeText(this.previousElementSibling.innerText).then(()=>{this.textContent='✅ Copiado';setTimeout(()=>this.textContent='📋 Copiar',2000)})">📋 Copiar</button>
</div>`;
  }

  function buildAliasMap(subPath) {
    const aliases = {};
    const used = new Set();
    subPath.forEach((step, i) => {
      let a = tableAlias(step.table);
      if (used.has(a)) a += (i + 1);
      used.add(a);
      aliases[step.table] = a;
    });
    return aliases;
  }

  function resolvedConstraints(prevTable, nextTable, rel) {
    const rank = (c) => {
      const f = String(c.field || '');
      const rf = String(c.relatedField || '');
      const tech = /^(DOM|DataAreaId|Partition)$/i.test(f) || /^(DOM|DataAreaId|Partition)$/i.test(rf);
      const biz = /(Id|Account|RecId)$/i.test(f) || /(Id|Account|RecId)$/i.test(rf);
      if (biz && !tech) return 0;
      if (biz) return 1;
      if (tech) return 3;
      return 2;
    };
    const prioritize = (arr) => arr.slice().sort((a, b) => rank(a) - rank(b));

    let explicit = (rel?.constraints || []).filter(c => c.field && c.relatedField);
    explicit = prioritize(explicit);
    if (explicit.length > 0) return { constraints: explicit, inferred: false };

    // Join by relation name fallback: try finding relation in source metadata by relation.name
    if (rel?.name) {
      const sourceRels = tableIndex[prevTable]?.relations || [];
      const byName = sourceRels.find(r => r.name === rel.name && r.relatedTable === nextTable);
      const byNameConstraints = prioritize((byName?.constraints || []).filter(c => c.field && c.relatedField));
      if (byNameConstraints.length > 0) return { constraints: byNameConstraints, inferred: false };
    }

    const inferred = window.D365Query?.inferConstraints
      ? window.D365Query.inferConstraints(tableIndex[prevTable]?.fields, tableIndex[nextTable]?.fields)
      : [];
    return { constraints: prioritize(inferred), inferred: inferred.length > 0 };
  }

  function buildSqlForPath(subPath) {
    const aliases = buildAliasMap(subPath);
    const first = subPath[0];
    const projection = subPath.flatMap(step => getSqlProjection(step.table, aliases[step.table]));
    let sqlLines = [`<span class="kw">SELECT</span> ${projection.map(p => `<span class="fld">${esc(p)}</span>`).join(', ')}\n<span class="kw">FROM</span>  <span class="tbl">${first.table}</span> <span class="kw">AS</span> <span class="tbl">${aliases[first.table]}</span>`];
    for (let i = 1; i < subPath.length; i++) {
      const step = subPath[i];
      const a = aliases[step.table];
      const rel = subPath[i - 1].relation;
      const resolved = resolvedConstraints(subPath[i - 1].table, step.table, rel);
      const joinConds = resolved.constraints.map(c =>
        `        <span class="tbl">${aliases[subPath[i-1].table]}</span>.<span class="fld">${c.field}</span> = <span class="tbl">${a}</span>.<span class="fld">${c.relatedField}</span>`
      );
      if (joinConds.length === 0) {
        joinConds.push(`        <span class="cm">/* relacionamento sem constraints mapeadas */</span>`);
      } else if (resolved.inferred) {
        joinConds.push(`        <span class="cm">/* constraints inferidas por nome de campo */</span>`);
      }
      if (appConfig.includeSystemFields) {
        joinConds.push(
          `        <span class="tbl">${aliases[subPath[i-1].table]}</span>.<span class="fld">DATAAREAID</span> = <span class="tbl">${a}</span>.<span class="fld">DATAAREAID</span>`,
          `        <span class="tbl">${aliases[subPath[i-1].table]}</span>.<span class="fld">PARTITION</span>  = <span class="tbl">${a}</span>.<span class="fld">PARTITION</span>`
        );
      }
      sqlLines.push(`    <span class="kw">INNER JOIN</span> <span class="tbl">${step.table}</span> <span class="kw">AS</span> <span class="tbl">${a}</span>\n        <span class="kw">ON</span> ${joinConds.join('\n        <span class="kw">AND</span> ')}`);
    }
    return sqlLines.join('\n');
  }

  function buildXppForPath(subPath) {
    const aliases = buildAliasMap(subPath);
    const xppSelect = subPath.map((step, i) => {
      const a = aliases[step.table];
      const selected = getSelectedFields(step.table);
      const fieldChunk = selected.length ? selected.map(f => `<span class="fld">${f}</span>`).join(', ') : `<span class="tbl">${a}</span>`;
      if (i === 0) return `<span class="kw">${whileSelectMode ? 'while select' : 'select'}</span> ${fieldChunk} <span class="kw">from</span> <span class="tbl">${step.table}</span>`;
      const rel = subPath[i - 1].relation;
      const resolved = resolvedConstraints(subPath[i - 1].table, step.table, rel);
      const joinFs = resolved.constraints.map(c =>
        `           <span class="tbl">${aliases[subPath[i-1].table]}</span>.<span class="fld">${c.field}</span> == <span class="tbl">${a}</span>.<span class="fld">${c.relatedField}</span>`
      );
      const note = resolved.inferred ? `\n    <span class="cm">// constraints inferidas por nome de campo</span>` : '';
      if (joinFs.length === 0) {
        return `    <span class="kw">join</span> ${fieldChunk} <span class="kw">from</span> <span class="tbl">${step.table}</span>${note}`;
      }
      const whereExpr = joinFs.join('\n        <span class="kw">&&</span> ');
      return `    <span class="kw">join</span> ${fieldChunk} <span class="kw">from</span> <span class="tbl">${step.table}</span>${note}\n    <span class="kw">where</span> ${whereExpr}`;
    });
    const varDecls = subPath.map(step => `    <span class="tbl">${step.table}</span> <span class="tbl">${aliases[step.table]}</span>;`).join('\n');
    if (whileSelectMode) {
      return `<span class="cm">// Declarations</span>\n${varDecls}\n\n<span class="cm">// Query</span>\n${xppSelect.join('\n')}\n{\n    <span class="cm">// TODO: Insira sua lógica de processamento aqui</span>\n}`;
    }
    return `<span class="cm">// Declarations</span>\n${varDecls}\n\n<span class="cm">// Query</span>\n${xppSelect.join('\n')};`;
  }

  // Section 1: Individual queries
  let sect1Items = path.map(step => {
    const alias = tableAlias(step.table);
    const t = tableIndex[step.table];
    const topFields = t ? getSqlProjection(step.table, alias).map(f => `    ${f}`).join(',\n') : `    ${alias}.*`;
    const sql = `<span class="kw">SELECT</span>\n${topFields}\n<span class="kw">FROM</span> <span class="tbl">${step.table}</span> <span class="kw">AS</span> <span class="tbl">${alias}</span>`;
    const xpp = `<span class="kw">select</span> <span class="tbl">${alias}</span>\n    <span class="kw">from</span> <span class="tbl">${step.table}</span>;`;
    return `<div class="accordion-item"><button class="accordion-header">${esc(step.table)}</button><div class="accordion-body">${buildQueryBlock(sql, xpp)}</div></div>`;
  }).join('');

  // Section 2: Partial query
  let sect2Content = '';
  if (currentDetail) {
    const k = path.findIndex(s => s.table === currentDetail.name);
    if (k > 0) {
      const partial = path.slice(0, k + 1);
      sect2Content = buildQueryBlock(buildSqlForPath(partial), buildXppForPath(partial));
    } else {
      sect2Content = '<p style="font-size:12px;color:#6b7280">Abra uma tabela do caminho no painel de detalhes para ver a query parcial.</p>';
    }
  } else {
    sect2Content = '<p style="font-size:12px;color:#6b7280">Abra uma tabela do caminho no painel de detalhes para ver a query parcial.</p>';
  }

  // Section 3: Full query
  const fullSql = buildSqlForPath(path);
  const fullXpp = buildXppForPath(path);

  const html = `
<div class="accordion-item"><button class="accordion-header open">📋 Queries Individuais</button><div class="accordion-body open">${sect1Items}</div></div>
<div class="accordion-item"><button class="accordion-header">🔍 Query Parcial</button><div class="accordion-body">${sect2Content}</div></div>
<div class="accordion-item"><button class="accordion-header">🔗 Query Completa</button><div class="accordion-body">${buildQueryBlock(fullSql, fullXpp)}</div></div>
`;

  accordion.innerHTML = html;

  accordion.querySelectorAll('.accordion-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const body = hdr.nextElementSibling;
      hdr.classList.toggle('open');
      body.classList.toggle('open');
    });
  });
}

// ── BUBBLE ANIMATION (US 4.2) ──────────────────────────────────────
function startBubbleAnim() {
  if (!cy) return;
  bubblePhases = {};
  cy.nodes().forEach(n => {
    bubblePhases[n.id()] = {
      t: Math.random() * Math.PI * 2,
      speed: 0.02 + Math.random() * 0.01,
      amplitude: 2 + Math.random() * 2,
      ox: n.position('x'),
      oy: n.position('y'),
    };
  });

  function loop() {
    cy.startBatch();
    cy.nodes().forEach(n => {
      if (n.grabbed()) return;
      const id = n.id();
      if (!bubblePhases[id]) bubblePhases[id] = { t: Math.random()*Math.PI*2, speed: 0.02+Math.random()*0.01, amplitude: 2+Math.random()*2, ox: n.position('x'), oy: n.position('y') };
      const p = bubblePhases[id];
      p.t += p.speed;
      n.position({ x: p.ox + Math.sin(p.t)*p.amplitude, y: p.oy + Math.cos(p.t*0.7)*p.amplitude });
    });
    cy.endBatch();
    bubbleRaf = requestAnimationFrame(loop);
  }
  bubbleRaf = requestAnimationFrame(loop);
}

function stopBubbleAnim() {
  cancelAnimationFrame(bubbleRaf);
  bubbleRaf = null;
  if (cy) {
    cy.nodes().forEach(n => {
      const p = bubblePhases[n.id()];
      if (p) n.position({ x: p.ox, y: p.oy });
    });
  }
  bubblePhases = {};
  bubbleAnimEnabled = false;
}

// ── OVERLAY ────────────────────────────────────────────────────────
function hideOverlay() {
  document.getElementById('loading-overlay').style.display = 'none';
  document.getElementById('file-input-area').classList.add('hidden');
  resetIngestionProgress();
  document.getElementById('app').classList.remove('hidden');
}

function openMetadataDashboard() {
  const modal = document.getElementById('dashboard-modal');
  modal.classList.remove('hidden');
  document.getElementById('dashboard-cards').innerHTML = '<div class="dash-item">Processando métricas...</div>';
  setTimeout(renderMetadataDashboard, 0);
}

function renderMetadataDashboard() {
  const sourceTables = (appConfig.dashboardUseSidebarFilter && (document.getElementById('search-input')?.value || '').trim())
    ? vsFiltered
    : ALL_TABLES;
  if (!sourceTables.length) return;
  const totalTables = sourceTables.length;
  const totalFields = sourceTables.reduce((n, t) => n + (t.fields?.length || 0), 0);
  const totalRelations = sourceTables.reduce((n, t) => n + (t.relations?.length || 0), 0);
  const avgDensity = totalTables ? (totalRelations / totalTables).toFixed(2) : '0.00';
  const modelCounts = {};
  sourceTables.forEach(t => {
    const models = Array.isArray(t.models) && t.models.length ? t.models : [t.model || 'Unknown'];
    const uniqueModels = [...new Set(models.map(m => String(m || '').trim()).filter(Boolean))];
    uniqueModels.forEach(m => {
      modelCounts[m] = (modelCounts[m] || 0) + 1;
    });
  });
  const totalModels = Object.keys(modelCounts).length;

  document.getElementById('dashboard-cards').innerHTML = `
    <div class="dashboard-card"><div class="n">${totalTables.toLocaleString()}</div><div class="l">Tabelas</div></div>
    <div class="dashboard-card"><div class="n">${totalFields.toLocaleString()}</div><div class="l">Campos</div></div>
    <div class="dashboard-card"><div class="n">${totalRelations.toLocaleString()}</div><div class="l">Relações</div></div>
    <div class="dashboard-card"><div class="n">${avgDensity}</div><div class="l">Densidade média</div></div>
    <div class="dashboard-card"><div class="n">${totalModels.toLocaleString()}</div><div class="l">Modelos</div></div>`;

  const scopedNames = new Set(sourceTables.map(t => t.name));
  const groupCounts = {};
  sourceTables.forEach(t => groupCounts[t.tableGroup || 'None'] = (groupCounts[t.tableGroup || 'None'] || 0) + 1);
  const groupRows = Object.entries(groupCounts).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<div class="dash-item"><span>${esc(k)}</span><span>${v}</span></div>`).join('');
  document.getElementById('dash-group-dist').innerHTML = `<div class="dash-list">${groupRows}</div>`;

  const modelRows = Object.entries(modelCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([k, v]) => `<div class="dash-item"><span>${esc(k)}</span><span>${v}</span></div>`)
    .join('');
  const modelTarget = document.getElementById('dash-model-dist');
  if (modelTarget) modelTarget.innerHTML = `<div class="dash-list">${modelRows}</div>`;

  const connected = sourceTables.map(t => ({
    name: t.name,
    score: (t.relations?.filter(r => scopedNames.has(r.relatedTable)).length || 0) +
      ((inboundRelIndex[t.name] || []).filter(r => scopedNames.has(r.from)).length || 0),
  })).sort((a, b) => b.score - a.score).slice(0, 10);
  document.getElementById('dash-top-connected').innerHTML = `<div class="dash-list">${
    connected.map(x => `<div class="dash-item"><a class="dash-link" data-table="${esc(x.name)}">${esc(x.name)}</a><span>${x.score}</span></div>`).join('')
  }</div>`;

  const fieldTop = sourceTables.map(t => ({ name: t.name, score: t.fields?.length || 0 }))
    .sort((a, b) => b.score - a.score).slice(0, 10);
  document.getElementById('dash-top-fields').innerHTML = `<div class="dash-list">${
    fieldTop.map(x => `<div class="dash-item"><a class="dash-link" data-table="${esc(x.name)}">${esc(x.name)}</a><span>${x.score}</span></div>`).join('')
  }</div>`;

  const enumCounts = {};
  sourceTables.forEach(t => (t.fields || []).forEach(f => {
    const en = f.enumType || (String(f.type || '').toLowerCase().includes('enum') ? (f.edt || 'Enum') : '');
    if (en) enumCounts[en] = (enumCounts[en] || 0) + 1;
  }));
  const enums = Object.entries(enumCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  document.getElementById('dash-enums').innerHTML = `<div class="dash-list">${
    enums.map(([k, v]) => `<div class="dash-item"><span>${esc(k)}</span><span>${v}</span></div>`).join('')
  }</div>`;

  const orphans = sourceTables.filter(t =>
    ((t.relations?.filter(r => scopedNames.has(r.relatedTable)).length || 0) +
    ((inboundRelIndex[t.name] || []).filter(r => scopedNames.has(r.from)).length || 0)) === 0
  ).slice(0, 200);
  document.getElementById('dash-orphans').innerHTML = `<div class="dash-list">${
    orphans.map(t => `<div class="dash-item"><a class="dash-link" data-table="${esc(t.name)}">${esc(t.name)}</a><span>0</span></div>`).join('')
  }</div>`;
}

function focusTableFromDashboard(name) {
  document.getElementById('dashboard-modal').classList.add('hidden');
  document.getElementById('search-input').value = name;
  onSearch();
  if (tableIndex[name]) {
    addTableToGraph(name);
    showDetail(tableIndex[name]);
    fitGraph();
  }
}

function loadAppConfig() {
  appConfig = window.D365State?.loadConfig?.() || { ...DEFAULT_CONFIG };
}

function saveAppConfig() {
  if (window.D365State?.saveConfig) window.D365State.saveConfig(appConfig);
  else localStorage.setItem('d365fo-table-explorer:config:v2', JSON.stringify(appConfig));
}

function syncSettingsUI() {
  const byId = (id) => document.getElementById(id);
  byId('cfg-layout').value = appConfig.layout;
  byId('cfg-repulsion').value = appConfig.nodeRepulsion;
  byId('cfg-edge-length').value = appConfig.idealEdgeLength;
  byId('cfg-auto-font').checked = appConfig.autoZoomFont;
  byId('cfg-show-edge-labels').checked = appConfig.showRelationName;
  byId('cfg-show-cardinality').checked = appConfig.showMultiplicity;
  byId('cfg-bubble').checked = appConfig.bubbleMode;
  byId('cfg-directional-highlight').checked = appConfig.directionalHighlight;
  byId('cfg-strict-direction').checked = appConfig.strictDirection;
  byId('cfg-max-depth').value = appConfig.maxDepth;
  byId('cfg-dashboard-filter').checked = appConfig.dashboardUseSidebarFilter;
  byId('cfg-default-iterative').checked = appConfig.defaultIterative;
  byId('cfg-include-system-fields').checked = appConfig.includeSystemFields;
  byId('strict-direction-inline').checked = appConfig.strictDirection;
  byId('dash-use-sidebar-filter').checked = appConfig.dashboardUseSidebarFilter;
}

function wireSettingsInputs() {
  const debouncedLayout = window.D365Graph?.debounce
    ? window.D365Graph.debounce(() => cy?.nodes().length && applyLayout(appConfig.layout), 100)
    : ((fn) => fn)(() => cy?.nodes().length && applyLayout(appConfig.layout));
  const map = [
    ['cfg-layout', 'layout', 'value'],
    ['cfg-repulsion', 'nodeRepulsion', 'value'],
    ['cfg-edge-length', 'idealEdgeLength', 'value'],
    ['cfg-auto-font', 'autoZoomFont', 'checked'],
    ['cfg-show-edge-labels', 'showRelationName', 'checked'],
    ['cfg-show-cardinality', 'showMultiplicity', 'checked'],
    ['cfg-bubble', 'bubbleMode', 'checked'],
    ['cfg-directional-highlight', 'directionalHighlight', 'checked'],
    ['cfg-strict-direction', 'strictDirection', 'checked'],
    ['cfg-max-depth', 'maxDepth', 'value'],
    ['cfg-dashboard-filter', 'dashboardUseSidebarFilter', 'checked'],
    ['cfg-default-iterative', 'defaultIterative', 'checked'],
    ['cfg-include-system-fields', 'includeSystemFields', 'checked'],
  ];
  map.forEach(([id, key, prop]) => {
    const el = document.getElementById(id);
    const handler = () => {
      appConfig[key] = prop === 'checked' ? el.checked : Number.isFinite(+el[prop]) ? +el[prop] : el[prop];
      if (key === 'maxDepth') appConfig.maxDepth = Math.max(1, Math.min(20, appConfig.maxDepth || 8));
      if (key === 'dashboardUseSidebarFilter') {
        const dashCb = document.getElementById('dash-use-sidebar-filter');
        if (dashCb) dashCb.checked = !!appConfig.dashboardUseSidebarFilter;
      }
      applyConfigToRuntime();
      if (['layout', 'nodeRepulsion', 'idealEdgeLength'].includes(key) && cy?.nodes().length) {
        debouncedLayout();
      }
      syncSettingsUI();
      saveAppConfig();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });
}

function applyConfigToRuntime() {
  autoZoomFontEnabled = !!appConfig.autoZoomFont;
  if (document.getElementById('layout-select')) {
    document.getElementById('layout-select').value = appConfig.layout;
  }
  const labelsBtn = document.getElementById('toggle-labels-btn');
  if (labelsBtn) labelsBtn.classList.toggle('btn-primary', !!appConfig.showRelationName);
  const strictInline = document.getElementById('strict-direction-inline');
  if (strictInline) strictInline.checked = !!appConfig.strictDirection;
  const bubbleBtn = document.getElementById('bubble-anim-btn');
  if (bubbleBtn) bubbleBtn.classList.toggle('active', !!appConfig.bubbleMode);
  if (appConfig.bubbleMode && !bubbleAnimEnabled) { bubbleAnimEnabled = true; startBubbleAnim(); }
  if (!appConfig.bubbleMode && bubbleAnimEnabled) { bubbleAnimEnabled = false; stopBubbleAnim(); }
  if (!appConfig.directionalHighlight) clearDirectionalHighlight();
  if (cy) {
    refreshEdgeLabels();
    cy.style()
      .selector('edge')
      .style('label', appConfig.showRelationName ? 'data(label)' : '')
      .style('source-label', appConfig.showMultiplicity ? 'data(sourceCardinality)' : '')
      .style('target-label', appConfig.showMultiplicity ? 'data(targetCardinality)' : '')
      .update();
    applyAutoFontScaling();
  }
}

// ── UTILS ──────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── EXPORT / IMPORT GRAPH (US 4.1) ────────────────────────────────
function exportGraph() {
  if (!cy || cy.nodes().length === 0) {
    alert('O grafo está vazio.');
    return;
  }
  const tables = cy.nodes().map(n => ({
    name:     n.id(),
    position: { x: Math.round(n.position('x')), y: Math.round(n.position('y')) },
  }));
  const now     = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const obj     = { version: 1, timestamp: now.toISOString(), tables };
  const blob    = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href        = url;
  a.download    = `d365fo-graph-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importGraph(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const obj = JSON.parse(ev.target.result);
      if (!obj.version || !Array.isArray(obj.tables)) throw new Error('Formato inválido');
      const unknown = obj.tables.filter(t => !tableIndex[t.name]);
      if (unknown.length > 0) {
        alert(`Tabelas não encontradas no metadata atual: ${unknown.map(t => t.name).join(', ')}`);
      }
      pushUndo();
      clearGraph(false);
      obj.tables.forEach(t => {
        if (tableIndex[t.name]) addTableToGraph(t.name, t.position);
      });
      updateGraphStats();
    } catch (e) {
      alert(`Erro ao importar grafo: ${e.message}`);
    }
  };
  reader.readAsText(file);
}

// ── SIDEBAR RESIZE ─────────────────────────────────────────────────
(function initResize() {
  const resizer  = document.getElementById('sidebar-resizer');
  const sidebar  = document.querySelector('.sidebar');
  let dragging   = false, startX = 0, startW = 0;

  resizer.addEventListener('mousedown', e => {
    dragging = true;
    startX   = e.clientX;
    startW   = sidebar.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const w = Math.max(200, Math.min(500, startW + e.clientX - startX));
    sidebar.style.width = w + 'px';
    renderVS();
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

// ── DETAIL PANEL RESIZE (US 2.1) ──────────────────────────────────
(function initDetailResize() {
  const resizer = document.getElementById('detail-resizer');
  const panel   = document.getElementById('detail-panel');
  let dragging  = false, startX = 0, startW = 0;

  resizer.addEventListener('mousedown', e => {
    dragging = true;
    startX   = e.clientX;
    startW   = panel.offsetWidth;
    document.body.style.cursor    = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    // Dragging LEFT increases width (panel is on right side)
    const delta = startX - e.clientX;
    const w = Math.max(300, Math.min(600, startW + delta));
    panel.style.width = w + 'px';
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    document.body.style.cursor    = '';
    document.body.style.userSelect = '';
  });
})();
