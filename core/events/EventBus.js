/* =====================================================================
   core/events/EventBus.js
   Pub/Sub simples para comunicação desacoplada entre módulos
   ===================================================================== */
'use strict';

/**
 * Catálogo de todos os eventos da aplicação.
 * Usar sempre estas constantes — nunca strings literais.
 */
const EVENTS = Object.freeze({
  // Dados
  TABLES_LOADED:         'tables:loaded',          // { count: number }
  // Tabelas
  TABLE_SELECTED:        'table:selected',          // { table: TableObject }
  TABLE_ADDED_TO_GRAPH:  'table:added-to-graph',    // { name: string }
  TABLE_REMOVED:         'table:removed',           // { name: string }
  // Grafo
  GRAPH_CLEARED:         'graph:cleared',           // {}
  GRAPH_CHANGED:         'graph:changed',           // { nodes: number, edges: number }
  GRAPH_LAYOUT_DONE:     'graph:layout-done',       // {}
  // Pathfinding
  PATH_FOUND:            'path:found',              // { path: PathStep[] }
  PATH_NOT_FOUND:        'path:not-found',          // { from, to }
  // Detail
  DETAIL_OPENED:         'detail:opened',           // { table: TableObject }
  DETAIL_CLOSED:         'detail:closed',           // {}
  // Configurações
  CONFIG_CHANGED:        'config:changed',          // { key, value, prev }
  // UI
  SEARCH_CHANGED:        'search:changed',          // { query, group, results: number }
  TAB_SWITCHED:          'tab:switched',            // { tabId }
  // Ingestão
  INGESTION_STARTED:     'ingestion:started',       // {}
  INGESTION_PROGRESS:    'ingestion:progress',      // { phase, percent }
  INGESTION_DONE:        'ingestion:done',          // { tables, fields, duration }
  INGESTION_ERROR:       'ingestion:error',         // { message }
});

class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
    /** @type {boolean} */
    this._debug = false;
  }

  /**
   * Registra um handler para um evento.
   *
   * @param {string} event - Constante de EVENTS
   * @param {Function} handler - Callback (data) => void
   * @param {{ once?: boolean }} options
   * @returns {Function} Função de unsubscribe
   */
  on(event, handler, options = {}) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());

    const wrappedHandler = options.once
      ? (data) => { handler(data); this.off(event, wrappedHandler); }
      : handler;

    this._handlers.get(event).add(wrappedHandler);

    // Retorna função de cleanup (conveniente para usar em destroy())
    return () => this.off(event, wrappedHandler);
  }

  /**
   * Remove um handler.
   *
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    this._handlers.get(event)?.delete(handler);
  }

  /**
   * Emite um evento para todos os handlers registrados.
   *
   * @param {string} event
   * @param {*} data
   */
  emit(event, data = {}) {
    if (this._debug) {
      console.log(`[EventBus] ${event}`, data);
    }
    this._handlers.get(event)?.forEach(handler => {
      try {
        handler(data);
      } catch (err) {
        console.error(`[EventBus] Erro no handler de "${event}":`, err);
      }
    });
  }

  /**
   * Ativa logs de debug para todos os eventos.
   */
  enableDebug() { this._debug = true; }
  disableDebug() { this._debug = false; }

  /**
   * Lista handlers registrados (útil para debugging).
   *
   * @param {string} event
   * @returns {number} Quantidade de handlers
   */
  listenerCount(event) {
    return this._handlers.get(event)?.size || 0;
  }
}

// Singleton global — único bus da aplicação
const eventBus = new EventBus();

window.D365EventBus = { bus: eventBus, EVENTS };