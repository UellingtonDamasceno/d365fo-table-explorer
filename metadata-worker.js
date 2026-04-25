/* Worker: parse D365FO AxTable/AxTableExtension XML partitions */

// Utility: Extract value of a tag using indexOf for performance on large files
function extractTagValue(tag, xml) {
  if (!xml) return '';
  const startTagPrefix = `<${tag}`;
  const endTag = `</${tag}>`;
  
  const sIdx = xml.indexOf(startTagPrefix);
  if (sIdx === -1) return '';
  
  const contentStart = xml.indexOf('>', sIdx);
  if (contentStart === -1) return '';
  
  // Check if self-closing
  if (xml[contentStart - 1] === '/') return '';

  const eIdx = xml.indexOf(endTag, contentStart);
  if (eIdx === -1) return '';
  
  return xml.substring(contentStart + 1, eIdx).trim();
}

// Utility: Extract multiple blocks of the same tag
function extractBlocks(tag, xml) {
  if (!xml) return [];
  const blocks = [];
  const startTagPrefix = `<${tag}`;
  const endTag = `</${tag}>`;
  let pos = 0;
  
  while (true) {
    const sIdx = xml.indexOf(startTagPrefix, pos);
    if (sIdx === -1) break;
    
    const contentStart = xml.indexOf('>', sIdx);
    if (contentStart === -1) break;
    
    if (xml[contentStart - 1] === '/') {
      pos = contentStart + 1;
      continue;
    }

    const eIdx = xml.indexOf(endTag, contentStart);
    if (eIdx === -1) break;
    
    blocks.push(xml.substring(sIdx, eIdx + endTag.length));
    pos = eIdx + endTag.length;
  }
  return blocks;
}

// Utility: Clean CDATA and inner tags
function cleanValue(val) {
  if (!val) return '';
  return val.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
}

function fileNameNoExt(path) {
  const raw = String(path || '').split(/[\\/]/).pop() || '';
  return raw.replace(/\.xml$/i, '');
}

function deriveContextFromPath(path) {
  const parts = String(path || '').split(/[\\/]+/).filter(Boolean);
  const axIndex = parts.findIndex(p => /^AxTable(Extension)?$/i.test(p));
  if (axIndex < 0) return { isRelevant: false, isExtension: false, model: 'Unknown' };
  
  const axFolder = parts[axIndex];
  let model = 'Unknown';
  if (axIndex > 0) {
    let prev = parts[axIndex - 1];
    if (prev.toLowerCase() === 'delta' && axIndex > 1) model = parts[axIndex - 2];
    else model = prev;
  }

  return {
    isRelevant: true,
    isExtension: /Extension$/i.test(axFolder),
    model,
  };
}

function relationDedupKey(rel) {
  const byName = String(rel?.name || '').trim();
  if (byName) return byName.toLowerCase();
  return String(rel?.relatedTable || '').trim().toLowerCase();
}

function createAggTable(name) {
  return {
    name,
    tableGroup: 'None',
    primaryIndex: '',
    clusteredIndex: '',
    model: '',
    models: new Set(),
    fields: [],
    relations: [],
    indexes: [],
    _fieldByName: new Map(),
    _relByKey: new Map(),
    _indexByName: new Map(),
  };
}

function mergeSourceModels(targetObj, incomingObj, fallbackModel) {
  const set = new Set(Array.isArray(targetObj?.sourceModels) ? targetObj.sourceModels : []);
  const incoming = Array.isArray(incomingObj?.sourceModels) ? incomingObj.sourceModels : [];
  incoming.forEach(m => { if (m) set.add(String(m)); });
  if (!incoming.length && fallbackModel) set.add(String(fallbackModel));
  targetObj.sourceModels = [...set];
}

function mergeFragment(tableMap, fragment) {
  if (!fragment?.name) return;
  if (!tableMap.has(fragment.name)) tableMap.set(fragment.name, createAggTable(fragment.name));
  const table = tableMap.get(fragment.name);
  const model = fragment.model || 'Unknown';

  if (fragment.tableGroup && fragment.tableGroup !== 'None' && table.tableGroup === 'None') table.tableGroup = fragment.tableGroup;
  if (fragment.primaryIndex && !table.primaryIndex) table.primaryIndex = fragment.primaryIndex;
  if (fragment.clusteredIndex && !table.clusteredIndex) table.clusteredIndex = fragment.clusteredIndex;

  if (!fragment.isExtension && model && !table.model) table.model = model;
  table.models.add(model);
  (fragment.models || []).forEach(m => table.models.add(m));

  (fragment.fields || []).forEach(field => {
    const name = String(field?.name || '');
    if (!name) return;
    const k = name.toLowerCase();
    const existing = table._fieldByName.get(k);
    if (!existing) {
      const copy = {
        name,
        type: String(field?.type || ''),
        extendedDataType: String(field?.extendedDataType || ''),
        enumType: String(field?.enumType || ''),
        sourceModels: [],
      };
      mergeSourceModels(copy, field, model);
      table.fields.push(copy);
      table._fieldByName.set(k, copy);
      return;
    }
    // Update missing types if extension has more info
    if (!existing.type && field.type) existing.type = String(field.type);
    if (!existing.extendedDataType && field.extendedDataType) existing.extendedDataType = String(field.extendedDataType);
    if (!existing.enumType && field.enumType) existing.enumType = String(field.enumType);
    mergeSourceModels(existing, field, model);
  });

  (fragment.relations || []).forEach(rel => {
    if (!rel?.relatedTable) return;
    const key = relationDedupKey(rel);
    const existing = table._relByKey.get(key);
    if (!existing) {
      const copy = {
        name: String(rel?.name || ''),
        relatedTable: String(rel?.relatedTable || ''),
        cardinality: String(rel?.cardinality || ''),
        relatedTableCardinality: String(rel?.relatedTableCardinality || ''),
        relationshipType: String(rel?.relationshipType || ''),
        constraints: Array.isArray(rel?.constraints) ? rel.constraints : [],
        sourceModels: [],
      };
      mergeSourceModels(copy, rel, model);
      table.relations.push(copy);
      table._relByKey.set(key, copy);
      return;
    }
    mergeSourceModels(existing, rel, model);
  });

  (fragment.indexes || []).forEach(idx => {
    const name = String(idx?.name || '');
    if (!name) return;
    const k = name.toLowerCase();
    const existing = table._indexByName.get(k);
    if (!existing) {
      const copy = {
        name,
        fields: Array.isArray(idx.fields) ? idx.fields : [],
        allowDuplicates: idx.allowDuplicates,
      };
      table.indexes.push(copy);
      table._indexByName.set(k, copy);
    }
  });
}

function finalizeAggTables(tableMap) {
  const out = [];
  tableMap.forEach(t => {
    const models = [...t.models].filter(Boolean).sort((a, b) => a.localeCompare(b));
    const model = t.model || models[0] || 'Unknown';
    const fields = t.fields.sort((a, b) => a.name.localeCompare(b.name));
    const relations = t.relations.sort((a, b) => {
      const cmp = a.relatedTable.localeCompare(b.relatedTable);
      return cmp !== 0 ? cmp : (a.name || '').localeCompare(b.name || '');
    });
    const indexes = t.indexes.sort((a, b) => a.name.localeCompare(b.name));
    out.push({
      name: t.name,
      tableGroup: t.tableGroup || 'None',
      primaryIndex: t.primaryIndex || '',
      clusteredIndex: t.clusteredIndex || '',
      model,
      models: models.length ? models : [model],
      fields,
      relations,
      indexes,
    });
  });
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function finalizeExt(extMap) {
  return [...extMap.values()].sort((a, b) => {
    const c1 = a.tableName.localeCompare(b.tableName);
    return c1 !== 0 ? c1 : a.model.localeCompare(b.model);
  });
}

// ── REGEX-BASED PARSER (Primary & Reliable) ────────────────────────
// Removemos totalmente o fast-xml-parser. O D365FO XML possui tags aninhadas 
// conflituosas (como FieldGroups > Fields vs Root > Fields) que enganam 
// parsers JSON. O Regex global atinge 100% de paridade com o comportamento C#.
function parseByRegex(xmlText, path) {
  const ctx = deriveContextFromPath(path);
  const hasExtRoot = /<\s*AxTableExtension(?:\s|>)/i.test(xmlText);
  const hasBaseRoot = /<\s*AxTable(?:\s|>)/i.test(xmlText);
  if (!hasExtRoot && !hasBaseRoot) return null;
  
  const isExt = hasExtRoot || (!hasBaseRoot && ctx.isExtension);
  const model = ctx.model || 'Unknown';

  // 1. Basic properties
  const objectName = extractTagValue('Name', xmlText) || fileNameNoExt(path);
  const baseName = isExt && objectName.includes('.') ? objectName.split('.')[0] : objectName;
  if (!baseName) return null;

  const tableGroup = !isExt ? (extractTagValue('TableGroup', xmlText) || 'None') : 'None';
  const primaryIndex = !isExt ? extractTagValue('PrimaryIndex', xmlText) : '';
  const clusteredIndex = !isExt ? extractTagValue('ClusteredIndex', xmlText) : '';

  // 2. Extract Fields
  const fields = extractBlocks('AxTableField', xmlText).map(fb => {
    const fName = extractTagValue('Name', fb);
    if (!fName) return null;

    let type = '';
    const typeMatch = fb.match(/(?:i:type|type)="([^"]+)"/i);
    if (typeMatch) type = typeMatch[1];
    else {
      const tagMatch = fb.match(/<AxTableField(\w+)/i);
      if (tagMatch && tagMatch[1]) type = 'AxTableField' + tagMatch[1];
    }

    return {
      name: fName,
      type: type,
      extendedDataType: extractTagValue('ExtendedDataType', fb),
      enumType: extractTagValue('EnumType', fb),
      sourceModels: [model]
    };
  }).filter(Boolean);

  // 3. Extract Relations
  const relations = extractBlocks('AxTableRelation', xmlText).map(rb => {
    const relTable = extractTagValue('RelatedTable', rb);
    if (!relTable) return null;

    const constraints = extractBlocks('AxTableRelationConstraint', rb).map(cb => {
      if (cb.includes('AxTableRelationConstraintField')) {
        const f = extractTagValue('Field', cb);
        const rf = extractTagValue('RelatedField', cb);
        if (f && rf) return { field: f, relatedField: rf };
      }
      return null;
    }).filter(Boolean);

    if (constraints.length === 0) return null;

    return {
      name: extractTagValue('Name', rb),
      relatedTable: relTable,
      cardinality: extractTagValue('Cardinality', rb),
      relatedTableCardinality: extractTagValue('RelatedTableCardinality', rb),
      relationshipType: extractTagValue('RelationshipType', rb),
      constraints,
      sourceModels: [model]
    };
  }).filter(Boolean);

  // 4. Extract Indexes
  const indexes = extractBlocks('AxTableIndex', xmlText).map(ib => {
    const idxName = extractTagValue('Name', ib);
    if (!idxName) return null;
    
    const allowDuplicates = extractTagValue('AllowDuplicates', ib) === 'Yes';
    const indexFields = extractBlocks('AxTableIndexField', ib)
      .map(ifb => {
        const isIncluded = extractTagValue('IncludedColumn', ifb) === 'Yes';
        if (isIncluded) return null;
        return extractTagValue('DataField', ifb);
      })
      .filter(Boolean);

    if (indexFields.length === 0) return null;

    return { name: idxName, fields: indexFields, allowDuplicates };
  }).filter(Boolean);

  return {
    name: baseName,
    isExtension: isExt,
    model,
    models: [model],
    tableGroup,
    primaryIndex,
    clusteredIndex,
    fields,
    relations,
    indexes
  };
}

async function parsePartition(workerId, files) {
  const BATCH_SIZE = 1000;
  const tStartWorker = performance.now();
  let tableMap = new Map();
  let processed = 0;
  let totalProcessedInBatch = 0;
  let errors = 0;

  console.log(`[Worker ${workerId}] Iniciando partição com ${files.length} arquivos...`);

  for (const entry of files) {
    processed += 1;
    totalProcessedInBatch += 1;
    try {
      const file = await entry.handle.getFile();
      const xmlText = await file.text();
      const fragment = parseByRegex(xmlText, entry.path);
      
      if (fragment) {
        mergeFragment(tableMap, fragment);
      }
    } catch (e) {
      errors += 1;
    }

    if (totalProcessedInBatch >= BATCH_SIZE) {
      const tEndBatch = performance.now();
      self.postMessage({
        type: 'batch_result',
        workerId,
        processed: totalProcessedInBatch,
        errors,
        tables: finalizeAggTables(tableMap),
        durationMs: tEndBatch - tStartWorker // Tempo acumulado até aqui
      });
      tableMap = new Map();
      totalProcessedInBatch = 0;
      errors = 0;
    } else if (processed % 100 === 0) {
      self.postMessage({ type: 'progress', workerId, processed, errors });
    }
  }

  const tEndWorker = performance.now();
  const totalDuration = tEndWorker - tStartWorker;
  
  self.postMessage({
    type: 'result',
    workerId,
    processed,
    errors,
    tables: finalizeAggTables(tableMap),
    extensions: [],
    metrics: {
      totalMs: totalDuration,
      avgMsPerFile: (totalDuration / processed).toFixed(3)
    }
  });
}

self.onmessage = (evt) => {
  const msg = evt.data || {};
  if (msg.type !== 'parsePartition') return;
  parsePartition(Number(msg.workerId || 0), Array.isArray(msg.files) ? msg.files : [])
    .catch(err => {
      self.postMessage({
        type: 'error',
        workerId: Number(msg.workerId || 0),
        message: err?.message || 'Falha no metadata-worker.',
      });
    });
};
