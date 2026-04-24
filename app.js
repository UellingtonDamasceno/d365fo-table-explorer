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
let lastIngestionTelemetry = null;

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

  // Back button
  document.getElementById('back-detail-btn').addEventListener('click', navigateBack);

  // Expansion mode buttons
  document.querySelectorAll('.exp-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      expansionMode = btn.dataset.mode;
      document.querySelectorAll('.exp-btn').forEach(b => b.classList.toggle('active', b === btn));
    }));

  document.getElementById('expansion-confirm-btn').addEventListener('click', confirmExpansion);
  document.getElementById('expansion-cancel-btn').addEventListener('click', () =>
    document.getElementById('expansion-dialog').classList.add('hidden'));

  document.getElementById('expansion-dialog-filter').addEventListener('input', () => {
    const q = document.getElementById('expansion-dialog-filter').value.toLowerCase();
    document.querySelectorAll('#expansion-dialog-list .exp-dialog-item').forEach(item => {
      item.style.display = (q && !item.textContent.toLowerCase().includes(q)) ? 'none' : '';
    });
  });

  document.getElementById('clear-shift-path-btn').addEventListener('click', clearShiftPath);

  // Export/Import
  document.getElementById('export-graph-btn').addEventListener('click', exportGraph);
  document.getElementById('import-graph-btn').addEventListener('click', () =>
    document.getElementById('import-graph-input').click());
  document.getElementById('import-graph-input').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) importGraph(file);
    e.target.value = '';
  });

  // Sort toggle
  document.getElementById('sort-toggle').addEventListener('click', () => {
    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    document.getElementById('sort-toggle').textContent = sortOrder === 'asc' ? 'A→Z' : 'Z→A';
    onSearch();
  });

  // Waypoints
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

  // Alt routes
  document.getElementById('find-alt-routes-btn').addEventListener('click', () => {
    const from = document.getElementById('path-from').value.trim();
    const to = document.getElementById('path-to').value.trim();
    if (from && to) renderAltRoutes(from, to);
  });

  // Undo
  document.getElementById('undo-btn').addEventListener('click', undoAction);

  // Modals
  document.getElementById('shortcuts-help-btn').addEventListener('click', () => {
    hideTooltip();
    document.getElementById('shortcuts-modal').classList.remove('hidden');
  });
  document.getElementById('shortcuts-modal-close-btn').addEventListener('click', () =>
    document.getElementById('shortcuts-modal').classList.add('hidden'));

  document.getElementById('open-settings-btn').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('hidden');
  });
  document.getElementById('settings-modal-close-btn').addEventListener('click', () =>
    document.getElementById('settings-modal').classList.add('hidden'));
  wireSettingsInputs();

  // Metadata dashboard
  document.getElementById('open-dashboard-btn').addEventListener('click', openMetadataDashboard);
  document.getElementById('open-telemetry-btn').addEventListener('click', openTelemetryModal);
  document.getElementById('telemetry-close-btn').addEventListener('click', () => 
    document.getElementById('telemetry-modal').classList.add('hidden'));
  document.getElementById('copy-telemetry-btn').addEventListener('click', copyTelemetryToClipboard);
  
  document.getElementById('dash-use-sidebar-filter').addEventListener('change', e => {
    appConfig.dashboardUseSidebarFilter = e.target.checked;
    saveAppConfig();
    renderMetadataDashboard();
  });
  document.getElementById('dashboard-close-btn').addEventListener('click', () =>
    document.getElementById('dashboard-modal').classList.add('hidden'));

  // Breadcrumbs
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

  // Shortcuts
  document.addEventListener('keydown', e => {
    const cancelNative = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    const inInput = (tag => tag === 'input' || tag === 'textarea')((document.activeElement?.tagName || '').toLowerCase());

    if (e.ctrlKey && e.key === 'f') { cancelNative(); document.getElementById('canvas-search-input').focus(); }
    if (e.ctrlKey && e.key === 'z' && !inInput) { cancelNative(); undoAction(); }
    if (e.ctrlKey && e.key.toLowerCase() === 's' && !inInput) { cancelNative(); exportGraph(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'o' && !inInput) { cancelNative(); document.getElementById('import-graph-input').click(); }
    if (e.key === 'Escape') {
       document.querySelectorAll('.shortcuts-modal').forEach(m => m.classList.add('hidden'));
       document.getElementById('expansion-dialog').classList.add('hidden');
    }
  });

  // Bubble animation
  document.getElementById('bubble-anim-btn').addEventListener('click', () => {
    appConfig.bubbleMode = !appConfig.bubbleMode;
    applyConfigToRuntime();
    syncSettingsUI();
    saveAppConfig();
  });

  // Canvas search
  document.getElementById('canvas-search-input').addEventListener('input', searchInCanvas);
  document.getElementById('canvas-search-clear').addEventListener('click', () => {
    document.getElementById('canvas-search-input').value = '';
    cy?.nodes().removeClass('canvas-highlighted');
  });

  // Initialize
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
  overlay.style.display = 'none';
  document.getElementById('app').classList.remove('hidden');
}

function resetIngestionProgress() {
  const box = document.getElementById('ingestion-progress');
  const fill = document.getElementById('ingestion-progress-fill');
  const statusTxt = document.getElementById('ingestion-status-text');
  const percentTxt = document.getElementById('ingestion-percent');
  const detailsTxt = document.getElementById('ingestion-progress-details');
  if (box) box.classList.add('hidden');
  if (fill) fill.style.width = '0%';
  if (statusTxt) statusTxt.textContent = 'Iniciando...';
  if (percentTxt) percentTxt.textContent = '0%';
  if (detailsTxt) detailsTxt.textContent = '';
}

function setIngestionProgress(state) {
  const box = document.getElementById('ingestion-progress');
  const fill = document.getElementById('ingestion-progress-fill');
  const statusTxt = document.getElementById('ingestion-status-text');
  const percentTxt = document.getElementById('ingestion-percent');
  const detailsTxt = document.getElementById('ingestion-progress-details');
  
  if (!box || !fill || !statusTxt || !detailsTxt || !percentTxt) return;
  box.classList.remove('hidden');

  const phase = state?.phase || '';
  let percent = 0;

  if (phase === 'scan') {
    statusTxt.textContent = '🔍 Fase 1: Varredura de disco...';
    detailsTxt.textContent = `Encontrados: ${Number(state?.matchedFiles || 0).toLocaleString()} XMLs relevantes em ${Number(state?.scannedFiles || 0).toLocaleString()} arquivos analisados`;
    fill.style.width = '15%';
    percentTxt.textContent = '';
  } else if (phase === 'parse') {
    const processed = Number(state?.processed || 0);
    const total = Number(state?.total || 0);
    percent = total > 0 ? Math.round((processed / total) * 100) : 0;
    statusTxt.textContent = '⚙️ Fase 2: Processando XMLs...';
    detailsTxt.textContent = `${processed.toLocaleString()} / ${total.toLocaleString()} arquivos | Threading em alta vazão`;
    percentTxt.textContent = `${percent}%`;
    fill.style.width = `${15 + (percent * 0.75)}%`; // vai de 15% a 90%
  } else if (phase === 'finalize') {
    statusTxt.textContent = '📦 Fase 3: Finalizando indexação...';
    detailsTxt.textContent = 'Organizando campos e relações para busca instantânea. Por favor, aguarde.';
    fill.style.width = '95%';
    percentTxt.textContent = '95%';
  } else if (phase === 'done') {
    statusTxt.textContent = '✅ Concluído!';
    detailsTxt.textContent = state?.message || 'Importação finalizada.';
    percentTxt.textContent = '100%';
    fill.style.width = '100%';
  } else if (phase === 'error') {
    statusTxt.textContent = '❌ Falha na importação';
    statusTxt.style.color = 'var(--accent-red)';
    detailsTxt.textContent = state?.message || 'Erro desconhecido.';
  }
}

async function importFromDirectory() {
  if (!window.D365Ingestion?.supportsDirectoryImport?.()) {
    alert('Este navegador não suporta importação por pasta.');
    return;
  }

  const overlay = document.getElementById('loading-overlay');
  const overlayWasHidden = overlay.style.display === 'none';
  showLoadingOverlay();
  document.getElementById('file-input-area').classList.remove('hidden');
  resetIngestionProgress();

  console.log('[Ingestion] Iniciando importação otimizada...');
  const tStartTotal = performance.now();

  try {
    setLoading('Solicitando acesso à pasta PackagesLocalDirectory...');
    const rootHandle = await window.showDirectoryPicker({ mode: 'read' });

    setLoading('Varrendo arquivos XML...');
    const tStartScan = performance.now();
    const scan = await window.D365Ingestion.collectXmlFiles(rootHandle, {
      onProgress: (p) => setIngestionProgress(p),
    });
    const tEndScan = performance.now();
    console.log(`[Ingestion] 🔍 Fase 1 concluída em ${(tEndScan - tStartScan).toFixed(2)}ms`);

    if (!scan.files.length) {
      setLoading('Nenhum XML de AxTable foi encontrado.');
      if (overlayWasHidden) hideOverlay();
      return;
    }

    setLoading(`Processando ${scan.files.length.toLocaleString()} arquivos...`);
    const parsed = await window.D365Ingestion.processFiles(scan.files, {
      onProgress: (p) => setIngestionProgress(p),
    });
    
    setLoading('Finalizando metadados...');
    setIngestionProgress({ phase: 'finalize' });

    if (window.D365MetadataDB?.isSupported?.()) {
      await window.D365MetadataDB.saveImport({
        tables: parsed.tables,
        extensions: parsed.extensions,
        stats: { durationMs: performance.now() - tStartTotal }
      });
      lastImportInfo = await window.D365MetadataDB.getImportInfo();
    }

    const tEndTotal = performance.now();
    const totalTimeSec = ((tEndTotal - tStartTotal) / 1000).toFixed(2);
    
    lastIngestionTelemetry = {
      totalTimeSec,
      fileCount: scan.files.length,
      tableCount: parsed.tables.length,
      fieldCount: parsed.stats?.totalFields || 0,
      workerMetrics: parsed.stats?.workerMetrics || [],
      scanTimeMs: tEndScan - tStartScan,
      parseTimeMs: tEndTotal - tEndScan
    };

    setIngestionProgress({ 
      phase: 'done', 
      message: `Sucesso: ${parsed.tables.length.toLocaleString()} tabelas e ${lastIngestionTelemetry.fieldCount.toLocaleString()} campos em ${totalTimeSec}s` 
    });
    init({ tables: parsed.tables });
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (overlayWasHidden) hideOverlay();
      return;
    }
    console.error('Falha na importação:', err);
    setLoading(`❌ Falha: ${err.message}`);
    document.getElementById('file-input-area').classList.remove('hidden');
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

  ALL_TABLES = Array.isArray(data) ? data : (data.tables || []);
  selectedFieldsByTable = {};

  ALL_TABLES.forEach(t => {
    if (!t.name)       t.name       = '(sem nome)';
    if (!t.tableGroup) t.tableGroup = 'None';
    if (!t.model) t.model = (Array.isArray(t.models) && t.models[0]) ? t.models[0] : 'Unknown';
    if (!Array.isArray(t.models) || !t.models.length) t.models = [t.model];
    t.models = [...new Set(t.models.map(m => String(m || '').trim()).filter(Boolean))];

    if (!Array.isArray(t.fields)) t.fields = [];
    t.fields = t.fields.map(f => ({
        name: String(f?.name || ''),
        type: String(f?.type || ''),
        extendedDataType: String(f?.extendedDataType || f?.edt || ''),
        enumType: String(f?.enumType || ''),
    })).filter(f => f.name);

    if (!Array.isArray(t.relations)) t.relations = [];
    t.relations = t.relations.map(r => ({
        name: String(r?.name || ''),
        relatedTable: String(r?.relatedTable || ''),
        cardinality: String(r?.cardinality || ''),
        relatedTableCardinality: String(r?.relatedTableCardinality || ''),
        relationshipType: String(r?.relationshipType || ''),
        constraints: Array.isArray(r?.constraints)
          ? r.constraints.map(c => ({ field: String(c?.field || ''), relatedField: String(c?.relatedField || '') }))
          : [],
    })).filter(r => r.relatedTable);
  });

  ALL_TABLES = ALL_TABLES.filter(t => t.name && t.name !== '(sem nome)');

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
  if (rawQ) {
    vsFiltered.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      if (aName === q) return -1;
      if (bName === q) return 1;
      return sortOrder === 'asc' ? aName.localeCompare(bName) : bName.localeCompare(aName);
    });
  } else {
    vsFiltered.sort((a, b) => sortOrder === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
  }
  vsContainer.scrollTop = 0;
  vsViewport = { start: -1, end: -1 };
  renderVS(true);
  updateListCount();
}

function clearSearch() { document.getElementById('search-input').value = ''; onSearch(); }
function updateListCount() { document.getElementById('list-count').textContent = vsFiltered.length.toLocaleString(); }

function renderVS(force = false) {
  const scrollTop = vsContainer.scrollTop;
  const clientHeight = vsContainer.clientHeight;
  const totalH = vsFiltered.length * VS_H;
  vsInner.style.height = totalH + 'px';
  const start = Math.max(0, Math.floor(scrollTop / VS_H) - 2);
  const end = Math.min(vsFiltered.length, Math.ceil((scrollTop + clientHeight) / VS_H) + 2);
  if (!force && start === vsViewport.start && end === vsViewport.end) return;
  vsViewport = { start, end };
  vsInner.innerHTML = '';
  const inGraphNames = cy ? new Set(cy.nodes().map(n => n.id())) : new Set();
  for (let i = start; i < end; i++) {
    const t = vsFiltered[i];
    const col = groupColor(t.tableGroup);
    const div = document.createElement('div');
    div.className = 'table-item' + (inGraphNames.has(t.name) ? ' in-graph' : '') + (currentDetail?.name === t.name ? ' active' : '');
    div.style.top = (i * VS_H) + 'px';
    div.innerHTML = `<span class="table-dot" style="background:${col.bg}"></span><span class="table-name">${esc(t.name)}</span>`;
    div.addEventListener('click', () => onTableClick(t));
    vsInner.appendChild(div);
  }
}

function onTableClick(t) { addTableToGraph(t.name); showDetail(t); renderVS(); }

function initCy() {
  cy = cytoscape({
    container: document.getElementById('cy'),
    elements: [],
    style: buildCyStyle(),
    layout: { name: 'preset' },
    minZoom: 0.1, maxZoom: 4, wheelSensitivity: 0.3,
  });
  cy.on('tap', 'node', e => {
    const t = tableIndex[e.target.id()];
    if (t) showDetail(t, true);
  });
}

function buildCyStyle() {
  return [
    { selector: 'node', style: { 'label': 'data(id)', 'background-color': 'data(bgColor)', 'width': 140, 'height': 34, 'shape': 'roundrectangle', 'color': '#fff', 'text-valign': 'center', 'font-size': '10px' } },
    { selector: 'edge', style: { 'width': 1.5, 'line-color': '#374151', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'label': appConfig.showRelationName ? 'data(label)' : '', 'font-size': '9px', 'color': '#6b7280' } }
  ];
}

function addTableToGraph(name) {
  if (!tableIndex[name] || cy.getElementById(name).length > 0) return;
  const t = tableIndex[name];
  const col = groupColor(t.tableGroup);
  cy.add({ data: { id: name, bgColor: col.bg } });
  updateGraphStats();
}

function expandTableInGraph(name, runLayout) {
  const t = tableIndex[name];
  if (!t) return;
  addTableToGraph(name);
  t.relations.forEach(r => { if (tableIndex[r.relatedTable]) addTableToGraph(r.relatedTable); });
  if (runLayout) applyLayout();
}

function applyLayout() { cy.layout({ name: appConfig.layout, animate: true }).run(); }
function clearGraph() { cy?.elements().remove(); updateGraphStats(); renderVS(); }
function fitGraph() { cy?.fit(undefined, 40); }
function graphCenter() { return { x: 300, y: 200 }; }

function toggleLabels() {
  appConfig.showRelationName = !appConfig.showRelationName;
  cy?.style().selector('edge').style('label', appConfig.showRelationName ? 'data(label)' : '').update();
  saveAppConfig();
}

function updateGraphStats() {
  const n = cy?.nodes().length || 0;
  const e = cy?.edges().length || 0;
  const badge = document.getElementById('graph-node-count');
  badge.textContent = `${n} tabelas · ${e} relações`;
  badge.classList.toggle('hidden', n === 0);
  document.getElementById('graph-welcome').classList.toggle('hidden', n > 0);
}

function showDetail(t, skipHistory = false) {
  if (!skipHistory && currentDetail && currentDetail.name !== t.name) detailHistory.push(currentDetail);
  currentDetail = t;
  const col = groupColor(t.tableGroup);
  document.getElementById('detail-table-name').textContent = t.name;
  const tag = document.getElementById('detail-group-tag');
  tag.textContent = t.tableGroup;
  tag.className = `tag ${col.tag}`;
  renderFields(t.fields, t.name);
  renderRelations(t.relations, t.name);
  document.getElementById('detail-panel').classList.remove('hidden');
  document.getElementById('back-detail-btn').style.display = detailHistory.length > 0 ? '' : 'none';
  renderVS();
  renderBreadcrumbs();
}

function closeDetail() { currentDetail = null; detailHistory = []; document.getElementById('detail-panel').classList.add('hidden'); renderVS(); renderBreadcrumbs(); }
function navigateBack() { if (detailHistory.length) showDetail(detailHistory.pop(), true); }

function renderFields(fields, tableName) {
  const tbody = document.getElementById('fields-tbody');
  tbody.innerHTML = fields.map(f => `<tr><td><input type="checkbox" /></td><td>${esc(f.name)}</td><td>${esc(f.type)}</td><td>${esc(f.extendedDataType || '')}</td></tr>`).join('');
}

function renderRelations(relations, tableName) {
  const list = document.getElementById('relations-list');
  list.innerHTML = relations.map(r => `<div class="nav-card" onclick="showDetail(tableIndex['${r.relatedTable}'])"><div class="nav-name">${esc(r.name || r.relatedTable)}</div><div class="nav-related">→ ${esc(r.relatedTable)}</div></div>`).join('');
}

function renderBreadcrumbs() {
  const el = document.getElementById('detail-breadcrumbs');
  if (!el) return;
  let html = detailHistory.map((t, i) => `<span class="breadcrumb-item" onclick="detailHistory=detailHistory.slice(0,${i});showDetail(tableIndex['${t.name}'],true)">${esc(t.name)}</span>`).join(' > ');
  if (currentDetail) html += (html ? ' > ' : '') + `<span class="breadcrumb-current">${esc(currentDetail.name)}</span>`;
  el.innerHTML = html;
}

function undoAction() { if (undoStack.length) { cy.elements().remove(); cy.add(undoStack.pop()); updateGraphStats(); renderVS(); } }
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tabId}`));
}

function openMetadataDashboard() { document.getElementById('dashboard-modal').classList.remove('hidden'); renderMetadataDashboard(); }
function renderMetadataDashboard() {
  const source = ALL_TABLES;
  document.getElementById('dashboard-cards').innerHTML = `<div class="dashboard-card"><div class="n">${source.length.toLocaleString()}</div><div class="l">Tabelas</div></div>`;
}

function openTelemetryModal() {
  const modal = document.getElementById('telemetry-modal');
  const content = document.getElementById('telemetry-content');
  if (!modal || !content) return;
  if (!lastIngestionTelemetry) {
    content.innerHTML = '<p style="color:var(--text-muted);font-style:italic">Nenhum dado de telemetria.</p>';
  } else {
    const t = lastIngestionTelemetry;
    const workerRows = t.workerMetrics.map(m => `<tr><td>Worker ${m.workerId}</td><td>${m.files.toLocaleString()}</td><td>${m.errors}</td><td>${m.totalMs.toFixed(0)}ms</td><td>${m.avgMs}ms</td></tr>`).join('');
    content.innerHTML = `
      <div class="telemetry-summary">
        <div class="telemetry-summary-item"><span>Tempo Total:</span><span>${t.totalTimeSec}s</span></div>
        <div class="telemetry-summary-item"><span>Varredura:</span><span>${(t.scanTimeMs/1000).toFixed(2)}s</span></div>
        <div class="telemetry-summary-item"><span>Parsing:</span><span>${(t.parseTimeMs/1000).toFixed(2)}s</span></div>
        <div class="telemetry-summary-item"><span>Arquivos:</span><span>${t.fileCount.toLocaleString()}</span></div>
        <div class="telemetry-summary-item"><span>Campos:</span><span>${t.fieldCount.toLocaleString()}</span></div>
      </div>
      <table class="telemetry-table"><thead><tr><th>Thread</th><th>Files</th><th>Err</th><th>CPU</th><th>Avg</th></tr></thead><tbody>${workerRows}</tbody></table>`;
  }
  modal.classList.remove('hidden');
}

function copyTelemetryToClipboard() {
  if (!lastIngestionTelemetry) return;
  const t = lastIngestionTelemetry;
  const report = `PERFORMANCE REPORT\nTotal: ${t.totalTimeSec}s\nFiles: ${t.fileCount}\nTables: ${t.tableCount}\nFields: ${t.fieldCount}\nScan: ${(t.scanTimeMs/1000).toFixed(2)}s\nParse: ${(t.parseTimeMs/1000).toFixed(2)}s`;
  navigator.clipboard.writeText(report).then(() => { alert('Copiado!'); });
}

function saveAppConfig() { localStorage.setItem('d365fo-table-explorer:config:v2', JSON.stringify(appConfig)); }
function loadAppConfig() { const s = localStorage.getItem('d365fo-table-explorer:config:v2'); if (s) appConfig = JSON.parse(s); }
function syncSettingsUI() {}
function wireSettingsInputs() {}
function applyConfigToRuntime() {}
function buildLegend() {}
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function toggleSidebarCollapse() {}
function toggleDetailCollapse() {}
function findPath() {}
function searchInCanvas() {}
function clearShiftPath() {}
function exportGraph() {}
function importGraph() {}
function confirmExpansion() {}
function genSimpleQuery() {}
function resetQueryTab() {}
function renderQueryAccordion() {}
function pushUndo() {}

(function initResize() {
  const resizer = document.getElementById('sidebar-resizer');
  const sidebar = document.querySelector('.sidebar');
  let dragging = false, startX = 0, startW = 0;
  resizer.addEventListener('mousedown', e => { dragging = true; startX = e.clientX; startW = sidebar.offsetWidth; document.body.style.cursor = 'col-resize'; });
  document.addEventListener('mousemove', e => { if (dragging) { sidebar.style.width = Math.max(200, Math.min(500, startW + e.clientX - startX)) + 'px'; renderVS(); } });
  document.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = ''; });
})();

(function initDetailResize() {
  const resizer = document.getElementById('detail-resizer');
  const panel = document.getElementById('detail-panel');
  let dragging = false, startX = 0, startW = 0;
  resizer.addEventListener('mousedown', e => { dragging = true; startX = e.clientX; startW = panel.offsetWidth; document.body.style.cursor = 'col-resize'; });
  document.addEventListener('mousemove', e => { if (dragging) { panel.style.width = Math.max(300, Math.min(600, startW + (startX - e.clientX))) + 'px'; } });
  document.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = ''; });
})();
