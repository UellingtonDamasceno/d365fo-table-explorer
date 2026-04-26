/* =====================================================================
   features/graph/GraphController.js
   Gerenciamento da instância do Cytoscape e manipulação do grafo
   ===================================================================== */
'use strict';

const GraphController = {
  /**
   * Inicializa a instância do Cytoscape.
   */
  init(container, options) {
    if (window.cy) {
      try { window.cy.removeAllListeners(); window.cy.destroy(); } catch (_) {}
    }

    if (typeof cytoscape === 'undefined') {
      const welcome = document.getElementById('graph-welcome');
      if (welcome) {
        welcome.innerHTML = `<div class="welcome-icon">⚠️</div><h2 style="color:#f87171">Cytoscape.js não carregado</h2><p>Esta ferramenta requer a biblioteca de grafos. Verifique sua conexão.</p>`;
        welcome.classList.remove('hidden');
      }
      return null;
    }

    const cy = cytoscape({
      container,
      elements: [],
      style: this.buildStyle(options.appConfig),
      layout: { name: 'preset' },
      minZoom: 0.3,
      maxZoom: 4,
      boxSelectionEnabled: false,
    });

    return cy;
  },

  /**
   * Define o estilo visual do grafo.
   */
  buildStyle(appConfig) {
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
        style: { 'border-width': 3, 'border-color': '#ffffff', 'z-index': 20 },
      },
      {
        selector: 'node.highlighted',
        style: { 'border-color': '#0078d4', 'border-width': 4, 'background-color': 'data(bgColorHL)' },
      },
      {
        selector: 'node.path-selected',
        style: { 'border-color': '#f59e0b', 'border-width': 3 },
      },
      {
        selector: 'node.cy-node-queued',
        style: { 'border-color': '#3b82f6', 'border-width': 4, 'z-index': 9999 },
      },
      {
        selector: 'node.shift-queued',
        style: { 'border-color': '#22c55e', 'border-width': 3 },
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
          'source-text-offset':    10,
          'target-text-offset':    10,
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
        style: { 'line-color': '#0078d4', 'target-arrow-color': '#0078d4', 'width': 3, 'color': '#93c5fd' },
      },
      {
        selector: 'edge.edge-outgoing',
        style: { 'line-color': '#ef4444', 'target-arrow-color': '#ef4444', 'width': 3 },
      },
      {
        selector: 'edge.edge-incoming',
        style: { 'line-color': '#22c55e', 'target-arrow-color': '#22c55e', 'width': 3 },
      },
      {
        selector: 'node.canvas-highlighted',
        style: { 'border-color': '#f59e0b', 'border-width': 4, 'overlay-color': '#f59e0b', 'overlay-opacity': 0.15, 'overlay-padding': 8 },
      },
    ];
  },

  /**
   * Adiciona uma tabela ao grafo.
   */
  addTable(cy, tableName, position, options) {
    const t = window.D365TableStore.get(tableName);
    if (!t || cy.getElementById(tableName).length > 0) return;

    const col = window.D365GroupColors.groupColor(t.tableGroup);
    const lbl = tableName.length > 20 ? tableName.slice(0, 18) + '…' : tableName;
    const w   = Math.max(100, Math.min(180, tableName.length * 7.5 + 16));

    cy.add({
      data: {
        id:          tableName,
        label:       lbl,
        labelWidth:  (w - 8) + 'px',
        width:       w,
        bgColor:     col.bg,
        bgColorHL:   col.bg,
        borderColor: col.border,
        tableGroup:  t.tableGroup,
      },
      position: position || this.randomPos(cy.container()),
    });

    // Auto-link com nós existentes
    cy.nodes().forEach(n => {
      const other = n.id();
      if (other === tableName) return;
      const edgeId  = `${tableName}→${other}`;
      const edgeIdR = `${other}→${tableName}`;
      if (cy.getElementById(edgeId).length > 0 || cy.getElementById(edgeIdR).length > 0) return;

      const rel = t.relations.find(r => r.relatedTable === other);
      if (rel) {
        cy.add({ data: window.D365Graph.buildEdgeData(edgeId, tableName, other, rel) });
      } else {
        const otherTable = window.D365TableStore.get(other);
        const relR = otherTable?.relations.find(r => r.relatedTable === tableName);
        if (relR) {
          cy.add({ data: window.D365Graph.buildEdgeData(edgeIdR, other, tableName, relR) });
        }
      }
    });
  },

  /**
   * Gera posição aleatória dentro do container.
   */
  randomPos(container) {
    const w = container?.clientWidth || 800;
    const h = container?.clientHeight || 600;
    return {
      x: 80 + Math.random() * (w - 160),
      y: 80 + Math.random() * (h - 160),
    };
  },

  /**
   * Aplica o layout ao grafo.
   */
  applyLayout(cy, appConfig, onStop) {
    if (!cy || cy.nodes().length === 0) return;
    
    const layoutName = appConfig.layout || 'breadthfirst';
    const isForce = ['cose', 'fcose'].includes(layoutName);

    const layout = cy.layout({
      name: layoutName,
      animate: true,
      animationDuration: 400,
      padding: 40,
      randomize: false,
      // Force-directed (cose)
      nodeRepulsion: appConfig.nodeRepulsion || 8000,
      idealEdgeLength: appConfig.idealEdgeLength || 120,
      edgeElasticity: 0.45,
      nestingFactor: 1.2,
      gravity: 0.25,
      // Generic layouts (breadthfirst, grid, etc)
      spacingFactor: (appConfig.nodeRepulsion / 8000) * 1.5,
      numIter: 1000,
      nodeDimensionsIncludeLabels: true,
    });

    if (onStop) layout.on('layoutstop', onStop);
    layout.run();
  },

  /**
   * Atualiza estatísticas do grafo na UI.
   */
  updateStats(cy) {
    const nodes = cy?.nodes().length || 0;
    const edges = cy?.edges().length || 0;
    const badge = document.getElementById('graph-node-count');
    const welcome = document.getElementById('graph-welcome');
    const searchWrap = document.getElementById('canvas-search-wrap');

    if (nodes > 0) {
      if (badge) {
        badge.textContent = `${nodes} tabelas · ${edges} relações`;
        badge.classList.remove('hidden');
      }
      if (welcome) welcome.classList.add('hidden');
      if (searchWrap) searchWrap.classList.remove('hidden');
    } else {
      if (badge) badge.classList.add('hidden');
      if (welcome) welcome.classList.remove('hidden');
      if (searchWrap) searchWrap.classList.add('hidden');
    }
  },

  /**
   * Exporta o estado atual do grafo para um arquivo JSON.
   */
  exportGraph(cy) {
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
  },

  /**
   * Importa o estado de um grafo a partir de um arquivo JSON.
   */
  importGraph(cy, file, tableStore, callback) {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const obj = JSON.parse(ev.target.result);
        if (!obj.version || !Array.isArray(obj.tables)) throw new Error('Formato inválido');
        
        const unknown = obj.tables.filter(t => !tableStore.get(t.name));
        if (unknown.length > 0) {
          alert(`Tabelas não encontradas no metadata atual: ${unknown.map(t => t.name).join(', ')}`);
        }

        // Limpa grafo atual (o orquestrador chama pushUndo antes)
        cy.elements().remove();
        
        obj.tables.forEach(t => {
          if (tableStore.get(t.name)) {
            this.addTable(cy, t.name, t.position);
          }
        });

        if (callback) callback();
      } catch (e) {
        alert(`Erro ao importar grafo: ${e.message}`);
      }
    };
    reader.readAsText(file);
  }
};

window.D365GraphController = GraphController;