'use strict';

/* ===================================================================
   D365FO Table Explorer – app.js
   Orquestrador principal da aplicação.
   =================================================================== */

// ── STATE ──────────────────────────────────────────────────────────
function getTable(name) { return window.D365TableStore.get(name); }
function groupColor(group) { return window.D365GroupColors.groupColor(group); }
function esc(str) { return window.D365DomUtils.esc(str); }
function tableAlias(name) { return window.D365StringUtils.tableAlias(name); }

let cy          = null;        
let currentDetail  = null;     
let detailHistory  = [];       
let querySequence  = [];       
let expansionMode  = 'full';   
let sortOrder      = 'asc';
let undoStack      = [];
let bubbleAnimEnabled = false;
let selectedFieldsByTable = {};
let tableFiltersByTable = {};    
let tableOrderByByTable = {};   
let whileSelectMode = false;
let lastIngestionTelemetry = null;
let _virtualScrollList = null;
let ALL_TABLES = [];
let vsFiltered = [];

const DEFAULT_CONFIG = window.D365AppDefaults?.APP_DEFAULTS || {
  layout: 'cose', nodeRepulsion: 8000, idealEdgeLength: 120, autoZoomFont: true,
  showRelationName: true, showMultiplicity: false, bubbleMode: false,
  directionalHighlight: false, strictDirection: false, maxDepth: 8,
  dashboardUseSidebarFilter: true, includeSystemFields: false,
  userWantsLegend: true,
};
let appConfig = window.D365State?.loadConfig?.() || { ...DEFAULT_CONFIG };

function updateHud() {
  const hud = document.getElementById('path-builder-hud');
  const seq = document.getElementById('hud-sequence');
  if (!hud || !seq) return;
  if (querySequence.length === 0) { hud.classList.add('hidden'); return; }
  hud.classList.remove('hidden');
  seq.innerHTML = querySequence.map(name => `<span class="hud-step">${esc(name)}</span>`).join('<span class="hud-arrow">➔</span>');
}

// ── STARTUP ────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Ingestão
  document.getElementById('pick-directory-btn')?.addEventListener('click', importFromDirectory);
  document.getElementById('import-directory-btn')?.addEventListener('click', importFromDirectory);

  // Layout & Resizing
  window.addEventListener('resize', () => cy?.resize());
  document.getElementById('toggle-sidebar-btn')?.addEventListener('click', () => window.D365DomUI.toggleSidebarCollapse());
  document.getElementById('toggle-detail-btn')?.addEventListener('click', () => window.D365DomUI.toggleDetailCollapse());
  window.D365DomUI.initResizers(() => renderVS());

  // Busca e Filtro
  const sInp = document.getElementById('search-input');
  sInp?.addEventListener('input', onSearch);
  sInp?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const match = getTable(sInp.value.trim());
      if (match) { addTableToGraph(match.name); showDetail(match, true); clearSearch(); }
    }
  });
  document.getElementById('clear-btn')?.addEventListener('click', clearSearch);
  document.getElementById('group-filter')?.addEventListener('change', onSearch);
  document.getElementById('sort-toggle')?.addEventListener('click', () => {
    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    document.getElementById('sort-toggle').textContent = sortOrder === 'asc' ? 'A→Z' : 'Z→A';
    onSearch();
  });

  // Controles do Grafo
  document.getElementById('toggle-ctrl-bar-btn')?.addEventListener('click', function() {
    const bar = document.getElementById('graph-ctrl-bar');
    const isCollapsed = bar.classList.toggle('collapsed');
    this.textContent = isCollapsed ? '⚙️' : '✕';
  });
  document.getElementById('clear-graph-btn')?.addEventListener('click', () => { if (confirm('Limpar grafo?')) clearGraph(); });
  document.getElementById('toggle-labels-btn')?.addEventListener('click', toggleLabels);
  document.getElementById('fit-btn2')?.addEventListener('click', fitGraph);
  document.getElementById('toggle-legend-btn')?.addEventListener('click', () => {
    appConfig.userWantsLegend = !appConfig.userWantsLegend;
    saveAppConfig();
    updateGraphStats();
  });
  
  // Implementação de arraste do HUD corrigida
  const hud = document.getElementById('path-builder-hud');
  const handle = hud?.querySelector('.hud-drag-handle');
  if (hud && handle) {
    let isDragging = false;
    let offset = { x: 0, y: 0 };
    handle.onmousedown = (e) => {
      isDragging = true;
      const rect = hud.getBoundingClientRect();
      const parentRect = hud.parentElement.getBoundingClientRect();
      
      // Calcular offset do mouse dentro do HUD
      offset.x = e.clientX - rect.left;
      offset.y = e.clientY - rect.top;
      
      // Converter coordenadas da viewport para coordenadas relativas ao pai
      hud.style.bottom = 'auto';
      hud.style.left = (rect.left - parentRect.left) + 'px';
      hud.style.top = (rect.top - parentRect.top) + 'px';
      hud.style.margin = '0';
      hud.style.transform = 'none';
      
      document.onmousemove = (me) => {
        if (!isDragging) return;
        hud.style.left = (me.clientX - offset.x - parentRect.left) + 'px';
        hud.style.top = (me.clientY - offset.y - parentRect.top) + 'px';
      };
      document.onmouseup = () => { isDragging = false; document.onmousemove = null; };
    };

    // Resetar posição no duplo clique
    handle.ondblclick = () => {
      hud.style.bottom = '';
      hud.style.top = '';
      hud.style.left = '';
      hud.style.margin = '';
      hud.style.transform = '';
    };
  }

  // Tooltips Dinâmicos para a barra de ferramentas
  const bar = document.getElementById('graph-ctrl-bar');
  const tooltip = document.getElementById('graph-ctrl-tooltip');
  if (bar && tooltip) {
    const showTooltip = (el, text) => {
      const rect = el.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      tooltip.textContent = text;
      tooltip.style.top = (rect.top - barRect.top + 4) + 'px';
      tooltip.classList.add('visible');
    };
    const hideTooltip = () => tooltip.classList.remove('visible');

    bar.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        let text = btn.title;
        // Lógica de estados dinâmicos
        if (btn.id === 'toggle-legend-btn') {
          const isHidden = document.getElementById('graph-legend')?.classList.contains('hidden');
          text = isHidden ? 'Mostrar Legenda' : 'Ocultar Legenda';
        } else if (btn.id === 'toggle-labels-btn') {
          text = appConfig.showRelationName ? 'Ocultar Nomes das Relações' : 'Mostrar Nomes das Relações';
        } else if (btn.id === 'bubble-anim-btn') {
          text = appConfig.bubbleMode ? 'Desativar Efeito Bolha' : 'Ativar Efeito Bolha';
        } else if (btn.id === 'clear-graph-btn') {
          text = 'Limpar Grafo';
        } else if (btn.id === 'fit-btn2') {
          text = 'Centralizar Grafo';
        } else if (btn.id === 'zoom-in-btn') {
          text = 'Aumentar Zoom';
        } else if (btn.id === 'zoom-out-btn') {
          text = 'Diminuir Zoom';
        } else if (btn.id === 'toggle-ctrl-bar-btn') {
          text = bar.classList.contains('collapsed') ? 'Mostrar Configurações' : 'Fechar Menu';
        } else if (btn.classList.contains('exp-btn')) {
          const modes = { 'full': 'Expansão Total', 'filtered': 'Selecionar Relações', 'manual': 'Apenas Tabela Selecionada' };
          text = modes[btn.dataset.mode] || text;
        }
        showTooltip(btn, text);
      });
      btn.addEventListener('mouseleave', hideTooltip);
      btn.addEventListener('click', hideTooltip); // Esconde ao clicar para atualizar o estado
    });
  }

  document.getElementById('zoom-in-btn')?.addEventListener('click', () => cy?.zoom({ level: cy.zoom() * 1.2, renderedPosition: graphCenter() }));
  document.getElementById('zoom-out-btn')?.addEventListener('click', () => cy?.zoom({ level: cy.zoom() * 0.8, renderedPosition: graphCenter() }));
  document.getElementById('bubble-anim-btn')?.addEventListener('click', () => {
    appConfig.bubbleMode = !appConfig.bubbleMode;
    applyConfigToRuntime(); saveAppConfig();
  });

  // Expansão
  document.querySelectorAll('.exp-btn').forEach(btn => btn.addEventListener('click', () => {
    expansionMode = btn.dataset.mode;
    document.querySelectorAll('.exp-btn').forEach(b => b.classList.toggle('active', b === btn));
  }));
  document.getElementById('expansion-confirm-btn')?.addEventListener('click', confirmExpansion);
  document.getElementById('expansion-cancel-btn')?.addEventListener('click', () => document.getElementById('expansion-dialog').classList.add('hidden'));
  document.getElementById('exp-select-all-btn')?.addEventListener('click', () => document.querySelectorAll('#expansion-dialog-list input').forEach(i => i.checked = true));
  document.getElementById('exp-deselect-all-btn')?.addEventListener('click', () => document.querySelectorAll('#expansion-dialog-list input').forEach(i => i.checked = false));

  // Detalhes e Tabs
  document.getElementById('close-detail-btn')?.addEventListener('click', closeDetail);
  document.getElementById('back-detail-btn')?.addEventListener('click', navigateBack);
  document.getElementById('expand-node-btn')?.addEventListener('click', () => { if (currentDetail) expandTableInGraph(currentDetail.name, true); });
  document.getElementById('gen-simple-query-btn')?.addEventListener('click', genSimpleQuery);
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab, true)));
  
  document.getElementById('fields-filter')?.addEventListener('input', filterFields);
  document.getElementById('fields-model-filter')?.addEventListener('change', filterFields);
  document.getElementById('rels-filter')?.addEventListener('input', filterRelations);
  
  document.getElementById('add-filter-condition-btn')?.addEventListener('click', () => {
    if (!currentDetail) return;
    const name = currentDetail.name;
    if (!tableFiltersByTable[name]) tableFiltersByTable[name] = [];
    tableFiltersByTable[name].push({ logic: tableFiltersByTable[name].length > 0 ? '&&' : '', field: currentDetail.fields[0]?.name || '', op: '==', value: '' });
    renderFilters(currentDetail);
  });

  // Pathfinding
  document.getElementById('open-pathfinding-btn')?.addEventListener('click', () => {
    document.getElementById('pathfinding-modal').classList.remove('hidden');
    document.getElementById('path-from').focus();
  });
  document.getElementById('find-path-btn')?.addEventListener('click', () => {
    window.D365PathfindingController.findPath(appConfig, { currentDetail }, {
      onPathFound: (fullPath) => {
        addPathToGraph(fullPath);
        window.D365QueryController.renderQueryAccordion(fullPath, appConfig, { selectedFieldsByTable, tableFiltersByTable, tableOrderByByTable, currentDetail }, whileSelectMode);
      }
    });
  });
  document.getElementById('path-modal-close-btn')?.addEventListener('click', () => document.getElementById('pathfinding-modal').classList.add('hidden'));
  document.getElementById('find-alt-routes-btn')?.addEventListener('click', () => window.D365PathfindingController.findAltRoutes(appConfig));
  
  window.addEventListener('d365:pathSelected', (e) => {
    const fullPath = e.detail.path;
    addPathToGraph(fullPath);
    window.D365QueryController.renderQueryAccordion(fullPath, appConfig, { selectedFieldsByTable, tableFiltersByTable, tableOrderByByTable, currentDetail }, whileSelectMode);
  });

  document.getElementById('hud-find-btn')?.addEventListener('click', () => {
    if (querySequence.length < 2) return;
    let fullPath = [];
    for (let i = 0; i < querySequence.length - 1; i++) {
      const seg = window.D365BfsEngine.bfs(querySequence[i], querySequence[i+1], { strict: appConfig.strictDirection });
      if (!seg) { alert(`Caminho não encontrado entre ${querySequence[i]} e ${querySequence[i+1]}`); return; }
      fullPath = fullPath.length ? fullPath.concat(seg.slice(1)) : seg;
    }
    window.D365QueryController.renderQueryAccordion(fullPath, appConfig, { selectedFieldsByTable, tableFiltersByTable, tableOrderByByTable, currentDetail }, whileSelectMode);
    switchTab('query');
  });

  // Modais
  document.getElementById('open-settings-btn')?.addEventListener('click', () => document.getElementById('settings-modal').classList.remove('hidden'));
  document.getElementById('settings-modal-close-btn')?.addEventListener('click', () => document.getElementById('settings-modal').classList.add('hidden'));
  document.getElementById('open-dashboard-btn')?.addEventListener('click', openMetadataDashboard);
  document.getElementById('dashboard-close-btn')?.addEventListener('click', () => document.getElementById('dashboard-modal').classList.add('hidden'));
  document.getElementById('shortcuts-help-btn')?.addEventListener('click', () => {
    window.D365DomUI.hideTooltip();
    document.getElementById('shortcuts-modal').classList.remove('hidden');
  });
  document.getElementById('shortcuts-modal-close-btn')?.addEventListener('click', () => document.getElementById('shortcuts-modal').classList.add('hidden'));
  
  document.getElementById('open-telemetry-btn')?.addEventListener('click', openTelemetryModal);
  document.getElementById('telemetry-close-btn')?.addEventListener('click', () => document.getElementById('telemetry-modal').classList.add('hidden'));
  document.getElementById('copy-telemetry-btn')?.addEventListener('click', copyTelemetryToClipboard);

  document.getElementById('add-waypoint-btn')?.addEventListener('click', () => {
    const container = document.getElementById('waypoints-container');
    const row = document.createElement('div');
    row.className = 'waypoint-row';
    row.innerHTML = `<div class="autocomplete-wrapper" style="flex:1"><input type="text" class="path-input" placeholder="Via..." autocomplete="off" /></div><button class="waypoint-remove-btn">✕</button>`;
    container.appendChild(row);
    row.querySelector('.waypoint-remove-btn').onclick = () => row.remove();
    initAutocomplete();
  });

  document.getElementById('canvas-search-input')?.addEventListener('input', searchInCanvas);
  document.getElementById('canvas-search-clear')?.addEventListener('click', () => {
    document.getElementById('canvas-search-input').value = '';
    searchInCanvas();
  });

  document.getElementById('toggle-while-select-btn')?.addEventListener('click', function() {
    whileSelectMode = !whileSelectMode;
    this.classList.toggle('btn-primary', whileSelectMode);
    if (currentDetail) genSimpleQuery();
  });

  document.getElementById('expansion-dialog-filter')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#expansion-dialog-list .exp-dialog-item').forEach(el => {
      const text = el.textContent.toLowerCase();
      el.style.display = text.includes(q) ? '' : 'none';
    });
  });

  // Grafo Portabilidade
  document.getElementById('export-graph-btn')?.addEventListener('click', exportGraph);
  document.getElementById('import-graph-btn')?.addEventListener('click', () => document.getElementById('import-graph-input').click());
  document.getElementById('import-graph-input')?.addEventListener('change', e => { if (e.target.files?.[0]) importGraph(e.target.files[0]); e.target.value = ''; });

  // Layout Select
  document.getElementById('layout-select')?.addEventListener('change', e => {
    appConfig.layout = e.target.value;
    applyLayout();
    saveAppConfig();
  });

  wireSettingsInputs();
  initializeFromDB();
  window.D365Shortcuts?.init?.();
});

// ── CORE FUNCTIONS ─────────────────────────────────────────────────
async function initializeFromDB() {
  const callbacks = {
    showOverlay: () => { document.getElementById('loading-overlay').style.display = 'flex'; },
    hideOverlay: hideOverlay,
    setLoading: (msg) => { document.getElementById('loading-msg').textContent = msg; },
    resetProgress: () => document.getElementById('ingestion-progress').classList.add('hidden'),
    initApp: (data) => init(data)
  };
  if (!await window.D365IngestionController.initializeFromDB(callbacks)) {
    document.getElementById('file-input-area').classList.remove('hidden');
  }
}

async function importFromDirectory() {
  const callbacks = {
    setLoading: (msg) => { document.getElementById('loading-msg').textContent = msg; },
    setProgress: (s) => setIngestionProgress(s),
    initApp: (data) => init(data),
    hideOverlay: hideOverlay
  };
  await window.D365IngestionController.importFromDirectory(callbacks);
}

function init(data) {
  stopBubbleAnim();
  if (cy) { cy.removeAllListeners(); cy.destroy(); cy = null; }
  currentDetail = null; 
  detailHistory.length = 0; 
  querySequence.length = 0; 
  undoStack.length = 0; 
  
  const rawTables = Array.isArray(data) ? data : (data.tables || []);
  window.D365TableStore.load(rawTables);
  ALL_TABLES = window.D365TableStore.getAll();
  lastIngestionTelemetry = data.telemetry || lastIngestionTelemetry;

  document.getElementById('total-count').textContent = ALL_TABLES.length.toLocaleString();
  loadAppConfig();
  syncSettingsUI();
  populateGroupFilter();
  initVS();
  initCy();
  applyConfigToRuntime();
  buildLegend();
  initAutocomplete();
  updateGraphStats();
  hideOverlay();
}

function initCy() {
  cy = window.D365GraphController.init(document.getElementById('cy'), { appConfig });
  if (!cy) return;
  window.cy = cy;
  
  // Impede que o clique simples selecione o nó nativamente (evita iniciar HUD sem Ctrl)
  cy.autounselectify(false); 

  cy.on('zoom', applyAutoFontScaling);

  cy.on('tap', 'node', e => {
    try {
      const node = e.target; const name = node.id(); const t = getTable(name);
      const isCtrl = e.originalEvent?.ctrlKey || e.originalEvent?.metaKey;

      if (isCtrl) {
        const idx = querySequence.indexOf(name);
        if (idx >= 0) {
          // Remover da sequência
          querySequence.splice(idx, 1);
          node.removeClass('cy-node-queued');
          node.unselect();
        } else {
          // Validação de Tabela Ilhada
          const hasOutbound = t?.relations && t.relations.length > 0;
          const hasInbound = window.D365TableStore.getInbound(name).length > 0;
          const isIsolated = !hasOutbound && !hasInbound;

          if (isIsolated) {
            node.unselect();
            setTimeout(() => alert(`A tabela ${name} está totalmente isolada (sem relações de entrada ou saída) e não pode ser usada na query.`), 10);
            return;
          }

          querySequence.push(name);
          node.addClass('cy-node-queued');
          node.select();
        }
        updateHud(); 
        return; 
      }

      // Clique normal: apenas navegação e detalhes (limpa seleções visuais para manter o grafo limpo)
      cy.nodes().unselect();
      if (t) showDetail(t, true);
      if (appConfig.directionalHighlight) applyDirectionalHighlight(name);
    } catch (err) {
      console.error('Erro no clique do nó:', err);
    }
  });

  cy.on('dblclick dbltap', 'node', e => expandTableInGraph(e.target.id(), true));
  cy.on('mouseover', 'node', e => {
    const t = getTable(e.target.id()); if (!t) return;
    const pos = e.renderedPosition; const rect = document.getElementById('graph-container').getBoundingClientRect();
    window.D365DomUI.showTooltip(t, rect.left + pos.x + 15, rect.top + pos.y + 10);
  });
  cy.on('mouseout', 'node', () => window.D365DomUI.hideTooltip());
  cy.on('dragfree', 'node', () => pushUndo());
  cy.on('dragfree', 'node', e => window.D365BubbleAnimation.updateOrigin(e.target.id(), e.target.position('x'), e.target.position('y')));
}

function showDetail(t, skipHistory = false) {
  if (!t) return;
  if (!skipHistory && currentDetail && currentDetail.name !== t.name) detailHistory.push(currentDetail);
  currentDetail = t;
  const col = groupColor(t.tableGroup);
  document.getElementById('detail-table-name').textContent = t.name;
  const tag = document.getElementById('detail-group-tag');
  tag.textContent = t.tableGroup; tag.className = `tag ${col.tag}`;
  
  // Popular e controlar visibilidade do filtro de modelos
  const modelFilter = document.getElementById('fields-model-filter');
  const uniqueModels = [...new Set(t.fields.flatMap(f => f.sourceModels || []))].filter(m => m && m !== 'Unknown').sort();
  
  if (modelFilter) {
    if (uniqueModels.length > 1) {
      modelFilter.innerHTML = '<option value="">Todos os modelos</option>' + uniqueModels.map(m => `<option value="${m}">${m}</option>`).join('');
      modelFilter.style.display = '';
    } else {
      modelFilter.style.display = 'none';
    }
  }

  document.getElementById('tab-fields-count').textContent = t.fields.length;
  document.getElementById('tab-rels-count').textContent = t.relations.length;
  renderFields(t.fields, t.name);
  renderRelations(t.relations, t.name);
  renderFilters(t);
  document.getElementById('detail-panel').classList.remove('hidden');
  document.getElementById('back-detail-btn').style.display = detailHistory.length > 0 ? '' : 'none';
  renderVS();
  renderBreadcrumbs();
}

function renderFields(fields, tableName) {
  const q = document.getElementById('fields-filter').value.toLowerCase();
  const m = document.getElementById('fields-model-filter').value;
  const filtered = fields.filter(f => (!q || f.name.toLowerCase().includes(q)) && (!m || (f.sourceModels || []).includes(m)));
  const tbody = document.getElementById('fields-tbody');
  const selectedSet = selectedFieldsByTable[tableName] || new Set();
  tbody.innerHTML = window.D365TableRenderer.renderFields(filtered, tableName, selectedSet);
  tbody.querySelectorAll('.field-select-cb').forEach(cb => cb.onchange = e => {
    if (!selectedFieldsByTable[tableName]) selectedFieldsByTable[tableName] = new Set();
    if (e.target.checked) selectedFieldsByTable[tableName].add(e.target.dataset.field);
    else selectedFieldsByTable[tableName].delete(e.target.dataset.field);
    if (document.querySelector('.tab-btn[data-tab="query"]').classList.contains('active')) genSimpleQuery();
  });
  const rows = [...tbody.querySelectorAll('.field-row')];
  rows.forEach((row, idx) => {
    row.onkeydown = e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); rows[Math.min(idx + 1, rows.length - 1)]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); rows[Math.max(idx - 1, 0)]?.focus(); }
      else if (e.key === ' ') { e.preventDefault(); const cb = row.querySelector('.field-select-cb'); if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } }
    };
  });
  document.getElementById('fields-shown-count').textContent = `${filtered.length} / ${fields.length}`;
}

function renderRelations(relations, tableName) {
  const q = document.getElementById('rels-filter').value.toLowerCase();
  const filtered = relations.filter(r => !q || r.relatedTable.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q));
  const list = document.getElementById('relations-list');
  list.innerHTML = window.D365TableRenderer.renderRelations(filtered);
  list.querySelectorAll('.nav-card').forEach(card => card.onclick = () => showDetail(getTable(card.dataset.related)));
}

function renderFilters(t) {
  const container = document.getElementById('filter-conditions-list');
  const indexSelect = document.getElementById('filter-index-select');
  if (!container || !indexSelect) return;
  const filters = tableFiltersByTable[t.name] || [];
  const orderBy = tableOrderByByTable[t.name] || { indexName: '', manualFields: [] };
  container.innerHTML = window.D365TableRenderer.renderFilterItems(t, filters);
  indexSelect.innerHTML = '<option value="">Nenhum índice selecionado</option>' + (t.indexes || []).map(idx => `<option value="${idx.name}" ${orderBy.indexName === idx.name ? 'selected' : ''}>${idx.name} (${idx.fields.join(', ')})</option>`).join('');
  indexSelect.onchange = () => { 
    tableOrderByByTable[t.name] = { ...orderBy, indexName: indexSelect.value };
    if (document.querySelector('.tab-btn[data-tab="query"]').classList.contains('active')) genSimpleQuery();
  };
  const names = t.fields.map(f => f.name);
  container.querySelectorAll('.filter-group').forEach(row => {
    const idx = parseInt(row.dataset.idx); const fInp = row.querySelector('.f-field');
    window.D365Autocomplete.create(fInp, { getSuggestions: (q) => names.filter(n => n.toLowerCase().includes(q.toLowerCase())), onSelect: (val) => { fInp.value = val; fInp.dispatchEvent(new Event('change')); } });
    row.querySelectorAll('select, input').forEach(el => el.onchange = () => {
      filters[idx].logic = row.querySelector('.f-logic')?.value || '';
      filters[idx].field = row.querySelector('.f-field').value;
      filters[idx].op = row.querySelector('.f-op').value;
      filters[idx].value = row.querySelector('.f-val').value;
      tableFiltersByTable[t.name] = filters;

      // Se o campo ou o operador mudou, precisamos re-renderizar para atualizar a UI (operadores e tipos de input)
      if (el.classList.contains('f-field') || el.classList.contains('f-op')) {
        renderFilters(t);
      }

      if (document.querySelector('.tab-btn[data-tab="query"]').classList.contains('active')) genSimpleQuery();
    });    row.querySelector('.remove-filter-btn').onclick = () => { filters.splice(idx, 1); tableFiltersByTable[t.name] = filters; renderFilters(t); if (document.querySelector('.tab-btn[data-tab="query"]').classList.contains('active')) genSimpleQuery(); };
  });
}

function renderBreadcrumbs() {
  const el = document.getElementById('detail-breadcrumbs'); if (!el) return;
  if (detailHistory.length === 0 && !currentDetail) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = window.D365TableRenderer.renderBreadcrumbs(detailHistory, currentDetail);
  el.querySelectorAll('.breadcrumb-item').forEach(item => item.onclick = () => {
    const idx = parseInt(item.dataset.idx); const t = detailHistory[idx];
    detailHistory = detailHistory.slice(0, idx); showDetail(t, true);
  });
  document.getElementById('add-trail-to-graph-btn')?.addEventListener('click', () => {
    pushUndo();
    detailHistory.forEach(t => window.D365GraphController.addTable(cy, t.name, null, { appConfig }));
    if (currentDetail) window.D365GraphController.addTable(cy, currentDetail.name, null, { appConfig });
    applyLayout();
  });
}

function onSearch() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const g = document.getElementById('group-filter').value;
  vsFiltered = window.D365TableStore.search(q, g, sortOrder);
  if (_virtualScrollList) _virtualScrollList.setItems(vsFiltered);
  document.getElementById('list-count').textContent = vsFiltered.length.toLocaleString();
}

function clearSearch() { document.getElementById('search-input').value = ''; onSearch(); }

function initVS() {
  _virtualScrollList = new window.D365VirtualScrollList(document.getElementById('vscroll-container'), document.getElementById('vscroll-inner'), {
    itemHeight: 40,
    renderItem(t, el) {
      const c = groupColor(t.tableGroup);
      const inG = cy?.getElementById(t.name).length > 0;
      el.className = `table-item ${inG ? 'in-graph' : ''} ${currentDetail?.name === t.name ? 'active' : ''}`;
      el.innerHTML = `<span class="table-dot" style="background:${c.bg}"></span><span class="table-name">${t.name}</span>`;
    },
    onItemClick: t => { addTableToGraph(t.name); showDetail(t, true); },
    onItemHover: (t, x, y) => window.D365DomUI.showTooltip(t, x, y),
    onItemLeave: () => window.D365DomUI.hideTooltip()
  });
  onSearch();
}

// ── WRAPPERS & HELPERS ─────────────────────────────────────────────
function addTableToGraph(name, pos) {
  if (!getTable(name) || (cy && cy.getElementById(name).length > 0)) return;
  pushUndo();
  window.D365GraphController.addTable(cy, name, pos, { appConfig });
  if (!pos) applyLayout();
  updateGraphStats(); renderVS();
}

function addPathToGraph(path) {
  if (!path || !cy) return;
  pushUndo();
  path.forEach(step => window.D365GraphController.addTable(cy, step.table, null, { appConfig }));
  applyLayout();
  updateGraphStats();
  renderVS();
}

function expandTableInGraph(name, run) {
  const t = getTable(name); if (!t) return;
  pushUndo();
  if (expansionMode === 'filtered') { showExpansionDialog(name, run); return; }
  addTableToGraph(name);
  if (expansionMode === 'full') {
    t.relations.forEach(r => { if (getTable(r.relatedTable)) window.D365GraphController.addTable(cy, r.relatedTable, null, { appConfig }); });
  }
  if (run) applyLayout();
  updateGraphStats();
}

function applyLayout(layoutName) {
  if (!cy) return;
  const wasBubbling = bubbleAnimEnabled; if (wasBubbling) stopBubbleAnim();
  window.D365GraphController.applyLayout(cy, { ...appConfig, layout: layoutName || appConfig.layout }, () => { if (wasBubbling) startBubbleAnim(); });
}

function clearGraph() { pushUndo(); cy?.elements().remove(); updateGraphStats(); renderVS(); }
function fitGraph() { cy?.fit(undefined, 40); }
function updateGraphStats() { 
  window.D365GraphController.updateStats(cy); 
  
  const nodeCount = cy ? cy.nodes().length : 0;
  const bar = document.getElementById('graph-ctrl-bar');
  const legend = document.getElementById('graph-legend');
  
  if (nodeCount > 0) {
    bar?.classList.remove('hidden');
    // A legenda só aparece se houver nós E o usuário quiser vê-la
    if (appConfig.userWantsLegend) legend?.classList.remove('hidden');
    else legend?.classList.add('hidden');
  } else {
    // Se o grafo estiver vazio, a legenda some obrigatoriamente
    bar?.classList.add('hidden');
    legend?.classList.add('hidden');
  }
}
function closeDetail() { document.getElementById('detail-panel').classList.add('hidden'); currentDetail = null; renderVS(); }
function renderVS() { if (_virtualScrollList) _virtualScrollList.refresh(); }
function navigateBack() { if (detailHistory.length) showDetail(detailHistory.pop(), true); }
function genSimpleQuery() { if (currentDetail) window.D365QueryController.genSimpleQuery(currentDetail, appConfig, { selectedFieldsByTable, tableFiltersByTable, tableOrderByByTable, currentDetail }); switchTab('query'); }

function switchTab(id, fromUser) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${id}`));
  if (fromUser && id === 'query') { if (querySequence.length >= 2) document.getElementById('hud-find-btn').click(); else if (currentDetail) genSimpleQuery(); }
}

function openMetadataDashboard() { document.getElementById('dashboard-modal').classList.remove('hidden'); window.D365DashboardController.render(vsFiltered, appConfig, window.D365TableStore._inbound); }
function openTelemetryModal() { window.D365DashboardController.renderTelemetry(lastIngestionTelemetry); document.getElementById('telemetry-modal').classList.remove('hidden'); }

function copyTelemetryToClipboard() {
  if (!lastIngestionTelemetry) return;
  const t = lastIngestionTelemetry;
  const workers = t.workerMetrics.map(m => `Thread ${m.workerId}: ${m.files} files, ${m.errors} errors, CPU ${m.totalMs.toFixed(2)}ms, Avg ${m.avgMs}ms/f`).join('\n');
  const report = `--- D365FO TABLE EXPLORER PERFORMANCE REPORT ---
Timestamp: ${new Date().toISOString()}
Total Time: ${t.totalTimeSec}s
Scan Time: ${(t.scanTimeMs / 1000).toFixed(2)}s
Parse Time: ${(t.parseTimeMs / 1000).toFixed(2)}s
Total Files: ${t.fileCount}
Unique Tables: ${t.tableCount}
Avg Throughput: ${(t.fileCount / t.totalTimeSec).toFixed(2)} files/sec

WORKER METRICS:
${workers}
-----------------------------------------------`;

  navigator.clipboard.writeText(report).then(() => {
    const btn = document.getElementById('copy-telemetry-btn');
    if (btn) {
      const oldText = btn.textContent;
      btn.textContent = '✅ Copiado!';
      setTimeout(() => btn.textContent = oldText, 2000);
    }
  });
}

function loadAppConfig() { appConfig = window.D365State.loadConfig(); }
function saveAppConfig() { window.D365State.saveConfig(appConfig); }

function syncSettingsUI() {
  const map = { 'cfg-layout': 'layout', 'cfg-repulsion': 'nodeRepulsion', 'cfg-edge-length': 'idealEdgeLength', 'cfg-auto-font': 'autoZoomFont', 'cfg-show-edge-labels': 'showRelationName', 'cfg-show-cardinality': 'showMultiplicity', 'cfg-bubble': 'bubbleMode', 'cfg-directional-highlight': 'directionalHighlight', 'cfg-strict-direction': 'strictDirection', 'cfg-max-depth': 'maxDepth', 'cfg-include-system-fields': 'includeSystemFields' };
  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id); if (!el) return;
    if (el.type === 'checkbox') el.checked = !!appConfig[key]; else el.value = appConfig[key];
  });
  const strictInline = document.getElementById('strict-direction-inline');
  if (strictInline) strictInline.checked = !!appConfig.strictDirection;
}

function wireSettingsInputs() {
  const ids = ['cfg-layout', 'cfg-repulsion', 'cfg-edge-length', 'cfg-auto-font', 'cfg-show-edge-labels', 'cfg-show-cardinality', 'cfg-bubble', 'cfg-directional-highlight', 'cfg-strict-direction', 'cfg-max-depth', 'cfg-include-system-fields'];
  
  const debouncedApplyLayout = window.D365GraphUtils.debounce(() => applyLayout(), 50);

  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    const eventType = el.type === 'range' ? 'input' : 'change';

    el.addEventListener(eventType, e => {
      const keyMap = { 'layout': 'layout', 'repulsion': 'nodeRepulsion', 'edge-length': 'idealEdgeLength', 'auto-font': 'autoZoomFont', 'show-edge-labels': 'showRelationName', 'show-cardinality': 'showMultiplicity', 'bubble': 'bubbleMode', 'directional-highlight': 'directionalHighlight', 'strict-direction': 'strictDirection', 'max-depth': 'maxDepth', 'include-system-fields': 'includeSystemFields' };
      const key = keyMap[id.replace('cfg-', '')]; if (!key) return;
      appConfig[key] = e.target.type === 'checkbox' ? e.target.checked : (isNaN(e.target.value) ? e.target.value : Number(e.target.value));
      
      if (key === 'strictDirection') {
        const inline = document.getElementById('strict-direction-inline');
        if (inline) inline.checked = appConfig.strictDirection;
      }

      if (['layout', 'nodeRepulsion', 'idealEdgeLength'].includes(key)) {
        if (el.type === 'range') debouncedApplyLayout();
        else applyLayout(); 
      } else if (key === 'includeSystemFields' && document.querySelector('.tab-btn[data-tab="query"]').classList.contains('active')) {
        genSimpleQuery();
      } else {
        applyConfigToRuntime();
      }
      saveAppConfig();
    });
  });
  
  document.getElementById('strict-direction-inline')?.addEventListener('change', e => {
    appConfig.strictDirection = e.target.checked;
    const cfg = document.getElementById('cfg-strict-direction');
    if (cfg) cfg.checked = appConfig.strictDirection;
    saveAppConfig();
  });
}

function applyConfigToRuntime() {
  if (!cy) return;
  if (appConfig.bubbleMode) startBubbleAnim(); else stopBubbleAnim();
  cy.style(window.D365GraphController.buildStyle(appConfig)).update();
}

function buildLegend() {
  const legend = document.getElementById('graph-legend');
  if (legend) legend.innerHTML = ['Main', 'Transaction', 'Group', 'WorksheetHeader', 'WorksheetLine', 'Staging', 'None'].map(g => { const c = groupColor(g); return `<div class="legend-item"><span class="legend-dot" style="background:${c.bg};border:1px solid ${c.border}"></span><span>${g}</span></div>`; }).join('');
}

function initAutocomplete() {
  const names = ALL_TABLES.map(t => t.name);
  document.querySelectorAll('.path-input').forEach(el => window.D365Autocomplete.create(el, { getSuggestions: (q) => names.filter(n => n.toLowerCase().includes(q.toLowerCase())) }));

  const canvasSearch = document.getElementById('canvas-search-input');
  if (canvasSearch) {
    window.D365Autocomplete.create(canvasSearch, {
      getSuggestions: (q) => {
        if (!cy) return [];
        const low = q.toLowerCase();
        return cy.nodes().map(n => n.id()).filter(id => id.toLowerCase().includes(low));
      },
      onSelect: (val) => {
        const node = cy.getElementById(val);
        if (node.length) {
          cy.animate({ center: { eles: node }, zoom: 1.2 }, { duration: 500 });
          node.select();
        }
      }
    });
  }
}

function populateGroupFilter() {
  const sel = document.getElementById('group-filter');
  if (sel) sel.innerHTML = '<option value="">Todos os grupos</option>' + window.D365TableStore.getGroups().map(g => `<option value="${g}">${g}</option>`).join('');
}

function showExpansionDialog(name, run) {
  const t = getTable(name); if (!t) return;
  const list = document.getElementById('expansion-dialog-list');
  list.innerHTML = t.relations.map(r => `<label class="exp-dialog-item"><input type="checkbox" value="${r.relatedTable}" checked /> ${r.relatedTable}</label>`).join('');
  document.getElementById('expansion-dialog').classList.remove('hidden');
}

function confirmExpansion() {
  const checked = [...document.querySelectorAll('#expansion-dialog-list input:checked')].map(i => i.value);
  pushUndo(); checked.forEach(name => window.D365GraphController.addTable(cy, name, null, { appConfig }));
  document.getElementById('expansion-dialog').classList.add('hidden');
  applyLayout(); updateGraphStats();
}

function pushUndo() { if (cy) { undoStack.push(cy.elements().jsons()); if (undoStack.length > 20) undoStack.shift(); } }
function undoAction() {
  if (!undoStack.length || !cy) return;
  
  const wasBubbling = bubbleAnimEnabled;
  if (wasBubbling) stopBubbleAnim();

  cy.batch(() => {
    cy.elements().remove();
    cy.add(undoStack.pop());
  });

  updateGraphStats();
  renderVS();
  
  if (wasBubbling) startBubbleAnim();
}

function exportGraph() { window.D365GraphController.exportGraph(cy); }
function importGraph(file) { 
  pushUndo(); 
  window.D365GraphController.importGraph(cy, file, window.D365TableStore, () => {
    updateGraphStats();
    renderVS();
  }); 
}

function applyAutoFontScaling() { if (cy && appConfig.autoZoomFont) cy.nodes().style('font-size', Math.max(8, Math.min(16, 12 / cy.zoom())) + 'px'); }

function searchInCanvas() {
  const q = document.getElementById('canvas-search-input').value.toLowerCase(); if (!cy) return;
  cy.nodes().removeClass('canvas-highlighted'); if (!q) return;
  const matches = cy.nodes().filter(n => n.id().toLowerCase().includes(q));
  matches.addClass('canvas-highlighted'); if (matches.length === 1) cy.animate({ center: { eles: matches } });
}

function toggleLabels() { appConfig.showRelationName = !appConfig.showRelationName; applyConfigToRuntime(); saveAppConfig(); }
function graphCenter() { return { x: cy ? cy.width() / 2 : 0, y: cy ? cy.height() / 2 : 0 }; }
function removeNodeFromGraph(id) { pushUndo(); cy.getElementById(id).remove(); updateGraphStats(); renderVS(); }
function filterFields() { if (currentDetail) renderFields(currentDetail.fields, currentDetail.name); }
function filterRelations() { if (currentDetail) renderRelations(currentDetail.relations, currentDetail.name); }
function startBubbleAnim() { bubbleAnimEnabled = true; window.D365BubbleAnimation.start(cy); }
function stopBubbleAnim() { bubbleAnimEnabled = false; window.D365BubbleAnimation.stop(); }
function hideOverlay() { document.getElementById('loading-overlay').style.display = 'none'; document.getElementById('app').classList.remove('hidden'); renderVS(); }
function resetQueryTab() { document.getElementById('query-hint').classList.remove('hidden'); document.getElementById('query-output').classList.add('hidden'); document.getElementById('query-accordion').classList.add('hidden'); }
function setIngestionProgress(s) { const fill = document.getElementById('ingestion-progress-fill'); const txt = document.getElementById('ingestion-status-text'); if (!fill || !txt) return; document.getElementById('ingestion-progress').classList.remove('hidden'); if (s.phase === 'scan') { txt.textContent = '🔍 Varrendo arquivos...'; fill.style.width = '20%'; } else if (s.phase === 'parse') { const p = Math.round((s.processed / s.total) * 100); txt.textContent = `⚙️ Processando ${p}%`; fill.style.width = `${20 + p * 0.75}%`; } else if (s.phase === 'done') { txt.textContent = '✅ Concluído!'; fill.style.width = '100%'; } }
function applyDirectionalHighlight(nodeId) {
  if (!cy) return;
  
  cy.batch(() => {
    // Resetar estados anteriores
    cy.elements().removeClass('node-dimmed edge-dimmed edge-incoming edge-outgoing highlighted');
    
    const rootNode = cy.getElementById(nodeId);
    if (!rootNode.length) return;

    // Aplicar esmaecimento geral (opcional, para focar no destaque)
    cy.elements().addClass('node-dimmed edge-dimmed');
    
    rootNode.removeClass('node-dimmed').addClass('highlighted');

    // Destacar arestas de saída (Vermelho)
    const outbound = rootNode.outgoers('edge');
    outbound.removeClass('edge-dimmed').addClass('edge-outgoing');
    outbound.targets().removeClass('node-dimmed');

    // Destacar arestas de entrada (Verde)
    const inbound = rootNode.incomers('edge');
    inbound.removeClass('edge-dimmed').addClass('edge-incoming');
    inbound.sources().removeClass('node-dimmed');
  });
}

window.exportGraph = exportGraph; window.clearGraph = clearGraph; window.undoAction = undoAction; window.applyLayout = applyLayout; window.closeDetail = closeDetail; window.removeNodeFromGraph = removeNodeFromGraph;
window.querySequence = querySequence; window.updateHud = updateHud;
