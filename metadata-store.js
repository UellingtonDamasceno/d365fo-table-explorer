/* Local-first metadata persistence (IndexedDB via Dexie) */
(function () {
  const DB_NAME = 'd365fo-table-explorer-db';
  const IMPORT_INFO_KEY = 'last-import';
  const TABLE_CHUNK_SIZE = 300;

  let db = null;

  function isSupported() {
    return typeof window !== 'undefined' && !!window.indexedDB && typeof window.Dexie !== 'undefined';
  }

  function getDb() {
    if (!isSupported()) return null;
    if (db) return db;
    db = new window.Dexie(DB_NAME);
    db.version(2).stores({
      tables: '&name, tableGroup, model, *models, *fieldNames, *relatedTables, updatedAt',
      extensions: '[tableName+model], tableName, model, updatedAt',
      meta: '&key',
    });
    return db;
  }

  function uniq(arr) { return [...new Set((arr || []).filter(Boolean))]; }

  function normalizeTable(table) {
    const fieldNames = (table.fields || []).map(f => String(f?.name || '')).filter(Boolean);
    const relatedTables = (table.relations || []).map(r => String(r?.relatedTable || '')).filter(Boolean);
    return {
      ...table,
      fieldNames: uniq(fieldNames),
      relatedTables: uniq(relatedTables),
      updatedAt: Date.now()
    };
  }

  /**
   * Grava um lote de tabelas realizando o merge se já existirem no banco.
   * Crucial para a estratégia de Pipeline (Streaming).
   */
  async function saveImportBatch(newTables) {
    const d = getDb();
    if (!d) return;

    await d.transaction('rw', d.table('tables'), async () => {
      const names = newTables.map(t => t.name);
      const existing = await d.table('tables').where('name').anyOf(names).toArray();
      const existingMap = new Map(existing.map(t => [t.name, t]));

      const toPut = newTables.map(incoming => {
        const base = existingMap.get(incoming.name);
        if (!base) return normalizeTable(incoming);

        // Merge lógico: combina campos, relações e modelos
        const mergedModels = uniq([...(base.models || []), ...(incoming.models || [])]);
        
        // Merge de campos (deduplicado por nome)
        const fieldMap = new Map();
        [...(base.fields || []), ...(incoming.fields || [])].forEach(f => {
          if (f.name) fieldMap.set(f.name.toLowerCase(), f);
        });

        // Merge de relações (deduplicado por nome/tabela)
        const relMap = new Map();
        [...(base.relations || []), ...(incoming.relations || [])].forEach(r => {
          const key = (r.name || r.relatedTable).toLowerCase();
          relMap.set(key, r);
        });

        // Merge de índices (deduplicado por nome)
        const indexMap = new Map();
        [...(base.indexes || []), ...(incoming.indexes || [])].forEach(idx => {
          if (idx.name) indexMap.set(idx.name.toLowerCase(), idx);
        });

        return normalizeTable({
          ...base,
          tableGroup: (incoming.tableGroup !== 'None') ? incoming.tableGroup : base.tableGroup,
          primaryIndex: incoming.primaryIndex || base.primaryIndex || '',
          clusteredIndex: incoming.clusteredIndex || base.clusteredIndex || '',
          models: mergedModels,
          fields: Array.from(fieldMap.values()),
          relations: Array.from(relMap.values()),
          indexes: Array.from(indexMap.values()),
        });
      });

      await d.table('tables').bulkPut(toPut);
    });
  }

  async function clearAll() {
    const d = getDb();
    if (d) {
      await d.table('tables').clear();
      await d.table('extensions').clear();
      await d.table('meta').clear();
    }
  }

  async function saveImport(payload) {
    const d = getDb();
    if (!d) return false;
    await clearAll();
    const tables = (payload.tables || []).map(normalizeTable);
    await d.table('tables').bulkPut(tables);
    await d.table('meta').put({ 
      key: IMPORT_INFO_KEY, 
      value: { 
        importedAt: new Date().toISOString(), 
        totalTables: tables.length 
      } 
    });
    return true;
  }

  window.D365MetadataDB = {
    isSupported,
    init: getDb,
    clearAll,
    saveImport,
    saveImportBatch,
    getAllTables: () => getDb().table('tables').orderBy('name').toArray(),
    countTables: () => getDb().table('tables').count(),
    getImportInfo: async () => (await getDb().table('meta').get(IMPORT_INFO_KEY))?.value,
    ensureStoragePersistence: async () => navigator.storage?.persist?.()
  };
})();
