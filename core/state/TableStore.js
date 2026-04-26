/* =====================================================================
   core/state/TableStore.js
   Armazenamento e indexação de tabelas D365FO
   Substitui: ALL_TABLES, tableIndex, tableIndexLower, relIndex, inboundRelIndex
   ===================================================================== */
'use strict';

class TableStore {
  constructor() {
    /** @type {Object[]} Array principal de tabelas */
    this._tables = [];
    /** @type {Map<string, Object>} Lookup case-sensitive O(1) */
    this._byName = new Map();
    /** @type {Map<string, Object>} Lookup case-insensitive O(1) */
    this._byNameLower = new Map();
    /** @type {Map<string, Set<string>>} name → Set de tabelas que ela referencia */
    this._outbound = new Map();
    /** @type {Map<string, Array>} name → [{from, relation}] relações de entrada */
    this._inbound = new Map();
  }

  /**
   * Carrega e indexa um array de tabelas.
   * Substitui a lógica de indexação em init() de app.js.
   *
   * @param {Object[]} rawTables
   */
  load(rawTables) {
    // Reset completo
    this._tables = [];
    this._byName.clear();
    this._byNameLower.clear();
    this._outbound.clear();
    this._inbound.clear();

    // Normalizar e filtrar
    const normalized = (Array.isArray(rawTables) ? rawTables : [])
      .map(t => this._normalize(t))
      .filter(t => t.name && t.name !== '(sem nome)');

    // Primeiro pass: popular mapas base
    for (const t of normalized) {
      this._tables.push(t);
      this._byName.set(t.name, t);
      this._byNameLower.set(t.name.toLowerCase(), t);
      this._outbound.set(t.name, new Set());
      this._inbound.set(t.name, []);
    }

    // Segundo pass: construir índices relacionais
    for (const t of this._tables) {
      for (const rel of t.relations) {
        if (rel.relatedTable && this._byName.has(rel.relatedTable)) {
          this._outbound.get(t.name).add(rel.relatedTable);
          this._inbound.get(rel.relatedTable).push({ from: t.name, relation: rel });
        }
      }
    }
  }

  /**
   * Normaliza um objeto de tabela raw para o formato canônico.
   * Toda a lógica de normalização que estava em init() de app.js.
   *
   * @param {Object} t
   * @returns {Object}
   */
  _normalize(t) {
    const name = String(t?.name || '').trim();
    if (!name) return { name: '' };

    const primaryIndex = String(t.primaryIndex || '');
    const clusteredIndex = String(t.clusteredIndex || '');
    const model = String(t.model || (Array.isArray(t.models) && t.models[0]) || 'Unknown');

    const models = Array.isArray(t.models) && t.models.length
      ? [...new Set(t.models.map(m => String(m || '').trim()).filter(Boolean))]
      : [model];

    const indexes = Array.isArray(t.indexes)
      ? t.indexes
          .map(idx => ({
            name: String(idx?.name || ''),
            fields: Array.isArray(idx?.fields) ? idx.fields.map(String) : [],
            allowDuplicates: !!idx?.allowDuplicates,
            isPrimary: String(idx?.name || '').toLowerCase() === primaryIndex.toLowerCase(),
            isClustered: String(idx?.name || '').toLowerCase() === clusteredIndex.toLowerCase(),
          }))
          .filter(idx => idx.name)
      : [];

    const fields = Array.isArray(t.fields)
      ? t.fields
          .map(f => ({
            name: String(f?.name || ''),
            type: String(f?.type || ''),
            extendedDataType: String(f?.extendedDataType || f?.edt || ''),
            enumType: String(f?.enumType || ''),
            sourceModels: Array.isArray(f?.sourceModels)
              ? [...new Set(f.sourceModels.map(x => String(x || '').trim()).filter(Boolean))]
              : [],
          }))
          .filter(f => f.name)
      : [];

    const relations = Array.isArray(t.relations)
      ? t.relations
          .map(r => ({
            name: String(r?.name || ''),
            relatedTable: String(r?.relatedTable || ''),
            cardinality: String(r?.cardinality || ''),
            relatedTableCardinality: String(r?.relatedTableCardinality || ''),
            relationshipType: String(r?.relationshipType || ''),
            constraints: Array.isArray(r?.constraints)
              ? r.constraints
                  .map(c => ({
                    field: String(c?.field || ''),
                    relatedField: String(c?.relatedField || ''),
                  }))
                  .filter(c => c.field && c.relatedField)
              : [],
            sourceModels: Array.isArray(r?.sourceModels)
              ? [...new Set(r.sourceModels.map(x => String(x || '').trim()).filter(Boolean))]
              : [],
          }))
          .filter(r => r.relatedTable && r.constraints.length)
      : [];

    return {
      name,
      tableGroup: String(t.tableGroup || 'None') || 'None',
      primaryIndex,
      clusteredIndex,
      model,
      models,
      fields,
      relations,
      indexes,
    };
  }

  // ── API PÚBLICA ──────────────────────────────────────────

  /**
   * Busca tabela por nome (case-insensitive como fallback).
   *
   * @param {string} name
   * @returns {Object|null}
   */
  get(name) {
    if (!name) return null;
    return this._byName.get(name) || this._byNameLower.get(name.toLowerCase()) || null;
  }

  /**
   * Retorna array de todas as tabelas (readonly).
   * @returns {Object[]}
   */
  getAll() { return this._tables; }

  /** @returns {number} */
  count() { return this._tables.length; }

  /**
   * Set de nomes de tabelas que 'name' referencia diretamente.
   *
   * @param {string} name
   * @returns {Set<string>}
   */
  getOutbound(name) { return this._outbound.get(name) || new Set(); }

  /**
   * Array de relações que apontam PARA 'name'.
   *
   * @param {string} name
   * @returns {Array<{from: string, relation: Object}>}
   */
  getInbound(name) { return this._inbound.get(name) || []; }

  /**
   * Verifica se uma tabela existe no store.
   *
   * @param {string} name
   * @returns {boolean}
   */
  has(name) { return this._byName.has(name); }

  /**
   * Retorna grupos únicos de todas as tabelas.
   * @returns {string[]}
   */
  getGroups() {
    return [...new Set(this._tables.map(t => t.tableGroup))].sort();
  }

  /**
   * Filtra tabelas com base em query de texto e grupo.
   * Inclui ranking: exact match → prefix → contains.
   *
   * @param {string} query
   * @param {string} groupFilter
   * @param {'asc'|'desc'} sortOrder
   * @returns {Object[]}
   */
  search(query, groupFilter = '', sortOrder = 'asc') {
    const q = (query || '').toLowerCase().trim();
    const regex = q ? (() => { try { return new RegExp(q, 'i'); } catch { return null; } })() : null;

    let results = this._tables.filter(t => {
      const matchQ = !q || (regex ? regex.test(t.name) : t.name.toLowerCase().includes(q));
      const matchG = !groupFilter || t.tableGroup === groupFilter;
      return matchQ && matchG;
    });

    if (q) {
      results.sort((a, b) => {
        const aL = a.name.toLowerCase();
        const bL = b.name.toLowerCase();
        if (aL === q) return -1;
        if (bL === q) return 1;
        if (aL.startsWith(q) && !bL.startsWith(q)) return -1;
        if (!aL.startsWith(q) && bL.startsWith(q)) return 1;
        return sortOrder === 'asc' ? aL.localeCompare(bL) : bL.localeCompare(aL);
      });
    } else {
      results.sort((a, b) =>
        sortOrder === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
      );
    }

    return results;
  }
}

// Instância singleton global
const tableStore = new TableStore();
window.D365TableStore = tableStore;