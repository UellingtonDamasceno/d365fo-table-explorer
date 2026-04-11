/* Local-first metadata persistence (IndexedDB via Dexie) */
(function () {
  const DB_NAME = 'd365fo-table-explorer-db';
  const IMPORT_INFO_KEY = 'last-import';
  const TABLE_CHUNK_SIZE = 300;
  const EXT_CHUNK_SIZE = 500;

  let db = null;

  function isSupported() {
    return typeof window !== 'undefined' && !!window.indexedDB && typeof window.Dexie !== 'undefined';
  }

  function getDb() {
    if (!isSupported()) return null;
    if (db) return db;
    db = new window.Dexie(DB_NAME);
    db.version(1).stores({
      tables: '&name, tableGroup, model, *models, *fieldNames, *relatedTables, updatedAt',
      extensions: '[tableName+model], tableName, model, updatedAt',
      meta: '&key',
    });
    return db;
  }

  function uniqStr(arr) {
    return [...new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))];
  }

  function normalizeField(field) {
    const sourceModels = uniqStr(field?.sourceModels);
    return {
      name: String(field?.name || ''),
      type: String(field?.type || ''),
      extendedDataType: String(field?.extendedDataType || field?.edt || ''),
      enumType: String(field?.enumType || ''),
      sourceModels,
    };
  }

  function normalizeRelation(rel) {
    const constraints = Array.isArray(rel?.constraints)
      ? rel.constraints
          .map(c => ({
            field: String(c?.field || ''),
            relatedField: String(c?.relatedField || ''),
          }))
          .filter(c => c.field && c.relatedField)
      : [];
    return {
      name: String(rel?.name || ''),
      relatedTable: String(rel?.relatedTable || ''),
      cardinality: String(rel?.cardinality || ''),
      relatedTableCardinality: String(rel?.relatedTableCardinality || ''),
      relationshipType: String(rel?.relationshipType || ''),
      constraints,
      sourceModels: uniqStr(rel?.sourceModels),
    };
  }

  function normalizeTable(table) {
    const fields = Array.isArray(table?.fields) ? table.fields.map(normalizeField).filter(f => f.name) : [];
    const relations = Array.isArray(table?.relations) ? table.relations.map(normalizeRelation).filter(r => r.relatedTable && r.constraints.length) : [];
    const models = uniqStr(table?.models && table.models.length ? table.models : [table?.model || 'Unknown']);
    const model = String(table?.model || models[0] || 'Unknown');

    return {
      name: String(table?.name || ''),
      tableGroup: String(table?.tableGroup || 'None'),
      model,
      models,
      fields,
      relations,
      fieldNames: uniqStr(fields.map(f => f.name)),
      relatedTables: uniqStr(relations.map(r => r.relatedTable)),
      updatedAt: Date.now(),
    };
  }

  function normalizeExtension(ext) {
    return {
      tableName: String(ext?.tableName || ''),
      model: String(ext?.model || 'Unknown'),
      files: Number(ext?.files || 0),
      fieldsAdded: Number(ext?.fieldsAdded || 0),
      relationsAdded: Number(ext?.relationsAdded || 0),
      updatedAt: Date.now(),
    };
  }

  function chunk(array, size) {
    const out = [];
    for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
    return out;
  }

  function stores(d) {
    return {
      tables: d.table('tables'),
      extensions: d.table('extensions'),
      meta: d.table('meta'),
    };
  }

  async function bulkPutChunked(table, rows, size) {
    const chunks = chunk(rows, size);
    for (const part of chunks) {
      if (part.length) await table.bulkPut(part);
    }
  }

  async function clearAll() {
    const d = getDb();
    if (!d) return false;
    const s = stores(d);
    await d.transaction('rw', s.tables, s.extensions, s.meta, async () => {
      await s.tables.clear();
      await s.extensions.clear();
      await s.meta.clear();
    });
    return true;
  }

  async function saveImport(payload) {
    const d = getDb();
    if (!d) return false;

    const tables = (payload?.tables || []).map(normalizeTable).filter(t => t.name);
    const extensions = (payload?.extensions || []).map(normalizeExtension).filter(x => x.tableName && x.model);
    const stats = payload?.stats || {};

    const s = stores(d);
    await d.transaction('rw', s.tables, s.extensions, s.meta, async () => {
      await s.tables.clear();
      await s.extensions.clear();
      await bulkPutChunked(s.tables, tables, TABLE_CHUNK_SIZE);
      await bulkPutChunked(s.extensions, extensions, EXT_CHUNK_SIZE);
      await s.meta.put({
        key: IMPORT_INFO_KEY,
        value: {
          ...stats,
          totalTables: tables.length,
          totalExtensions: extensions.length,
          importedAt: new Date().toISOString(),
        },
      });
    });

    return true;
  }

  async function getAllTables() {
    const d = getDb();
    if (!d) return [];
    return stores(d).tables.orderBy('name').toArray();
  }

  async function countTables() {
    const d = getDb();
    if (!d) return 0;
    return stores(d).tables.count();
  }

  async function getImportInfo() {
    const d = getDb();
    if (!d) return null;
    const row = await stores(d).meta.get(IMPORT_INFO_KEY);
    return row?.value || null;
  }

  async function ensureStoragePersistence() {
    if (!navigator.storage?.persist) {
      return { supported: false, persisted: false };
    }
    let persisted = false;
    try {
      if (navigator.storage.persisted) persisted = await navigator.storage.persisted();
    } catch (_) {}
    if (!persisted) {
      try { persisted = await navigator.storage.persist(); } catch (_) {}
    }
    let estimate = null;
    try {
      estimate = navigator.storage.estimate ? await navigator.storage.estimate() : null;
    } catch (_) {
      estimate = null;
    }
    return { supported: true, persisted, estimate };
  }

  window.D365MetadataDB = {
    isSupported,
    init: getDb,
    clearAll,
    saveImport,
    getAllTables,
    countTables,
    getImportInfo,
    ensureStoragePersistence,
  };
})();
