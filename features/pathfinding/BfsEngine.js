/* =====================================================================
   features/pathfinding/BfsEngine.js
   Algoritmo BFS com fila eficiente — substitui bfs() e bfsMultiple() de app.js
   ===================================================================== */
'use strict';

/**
 * Fila FIFO com enqueue O(1) e dequeue O(1) via linked list.
 * Substitui o Array.shift() que era O(n) no app.js original.
 */
class Queue {
  constructor() {
    this._head = null;
    this._tail = null;
    this._size = 0;
  }

  enqueue(item) {
    const node = { item, next: null };
    if (this._tail) this._tail.next = node;
    else this._head = node;
    this._tail = node;
    this._size++;
  }

  dequeue() {
    if (!this._head) return undefined;
    const item = this._head.item;
    this._head = this._head.next;
    if (!this._head) this._tail = null;
    this._size--;
    return item;
  }

  get size() { return this._size; }
  get isEmpty() { return this._size === 0; }
}

/**
 * Cria uma relação reversa (para BFS bidirecional com strict=false).
 *
 * @param {Object} rel - Relação original
 * @param {string} sourceName
 * @param {string} targetName
 * @returns {Object}
 */
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

/**
 * Score de prioridade para ordenar vizinhos durante BFS.
 * Vizinhos com score menor são explorados primeiro.
 *
 * @param {Object} rel
 * @param {string} targetTable
 * @returns {number}
 */
function relationPriorityScore(rel, targetTable) {
  if (!rel) return 99;
  if (rel.name === targetTable) return 0;
  const constraints = rel.constraints || [];
  const hasBizField = constraints.some(c =>
    /(Id|Account|RecId)$/i.test(c.field || '') ||
    /(Id|Account|RecId)$/i.test(c.relatedField || '')
  );
  return hasBizField ? 1 : 2;
}

/**
 * Ordena vizinhos para melhorar chance de encontrar path ótimo primeiro.
 *
 * @param {Array<{next: string, relation: Object}>} neighbors
 * @param {string} targetTable
 * @returns {Array}
 */
function prioritizeNeighbors(neighbors, targetTable) {
  return neighbors.slice().sort((a, b) => {
    const sa = relationPriorityScore(a.relation, targetTable);
    const sb = relationPriorityScore(b.relation, targetTable);
    if (sa !== sb) return sa - sb;
    return String(a.next).localeCompare(String(b.next));
  });
}

/**
 * BFS para encontrar o caminho mais curto entre dois nós.
 *
 * @param {string} start
 * @param {string} end
 * @param {Object} options
 * @param {Object} options.tableStore - Instância de D365TableStore (window.D365TableStore)
 * @param {number} [options.maxDepth=8]
 * @param {boolean} [options.strict=false] - Se true, ignora relações reversas
 * @returns {Array<{table: string, relation: Object|null}>|null}
 */
function bfs(start, end, options = {}) {
  const store = options.tableStore || window.D365TableStore;
  const maxDepth = options.maxDepth || 8;
  const strict = !!options.strict;

  if (!store || !store.has(start) || !store.has(end)) return null;
  if (start === end) return null;

  const queue = new Queue();
  queue.enqueue({ name: start, path: [{ table: start, relation: null }] });

  const visited = new Set([start]);

  while (!queue.isEmpty) {
    const { name, path } = queue.dequeue();
    if (path.length > maxDepth + 1) continue;

    const t = store.get(name);
    if (!t) continue;

    const neighbors = [];

    // Relações de saída (diretas)
    for (const rel of t.relations) {
      if (rel.relatedTable && store.has(rel.relatedTable)) {
        neighbors.push({ next: rel.relatedTable, relation: rel });
      }
    }

    // Relações de entrada (reversas) — apenas se strict=false
    if (!strict) {
      for (const inbound of store.getInbound(name)) {
        const reversed = reverseRelation(inbound.relation, name, inbound.from);
        neighbors.push({ next: inbound.from, relation: reversed });
      }
    }

    const ranked = prioritizeNeighbors(neighbors, end);

    for (const item of ranked) {
      const next = item.next;
      if (!next || visited.has(next) || !store.has(next)) continue;
      visited.add(next);

      const newPath = [...path, { table: next, relation: item.relation }];
      if (next === end) return newPath;

      queue.enqueue({ name: next, path: newPath });
    }
  }

  return null;
}

/**
 * Encontra múltiplas rotas entre dois nós (DFS com limite).
 *
 * @param {string} start
 * @param {string} end
 * @param {Object} options
 * @param {Object} options.tableStore
 * @param {number} [options.maxRoutes=5]
 * @param {number} [options.maxDepth=8]
 * @param {boolean} [options.strict=false]
 * @returns {Array[]} Array de paths, ordenados por comprimento
 */
function bfsMultiple(start, end, options = {}) {
  const store = options.tableStore || window.D365TableStore;
  const maxRoutes = options.maxRoutes || 5;
  const maxDepth = options.maxDepth || 8;
  const strict = !!options.strict;

  if (!store || !store.has(start) || !store.has(end)) return [];

  const routes = [];
  // Usa stack (DFS) para diversidade de rotas
  const stack = [{
    name: start,
    path: [{ table: start, relation: null }],
    visited: new Set([start]),
  }];

  let iterations = 0;
  const MAX_ITERATIONS = 50000;

  while (stack.length > 0 && routes.length < maxRoutes && iterations < MAX_ITERATIONS) {
    iterations++;
    const { name, path, visited } = stack.pop();
    if (path.length > maxDepth + 1) continue;

    const t = store.get(name);
    if (!t) continue;

    const neighbors = [];
    for (const rel of t.relations) {
      if (rel.relatedTable && store.has(rel.relatedTable)) {
        neighbors.push({ next: rel.relatedTable, relation: rel });
      }
    }
    if (!strict) {
      for (const inbound of store.getInbound(name)) {
        neighbors.push({
          next: inbound.from,
          relation: reverseRelation(inbound.relation, name, inbound.from),
        });
      }
    }

    const ranked = prioritizeNeighbors(neighbors, end);

    for (const item of ranked) {
      const next = item.next;
      if (!next || visited.has(next) || !store.has(next)) continue;
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

window.D365BfsEngine = { bfs, bfsMultiple, reverseRelation, prioritizeNeighbors };