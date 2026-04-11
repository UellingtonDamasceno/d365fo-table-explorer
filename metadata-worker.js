/* Worker: parse D365FO AxTable/AxTableExtension XML partitions */

let fastParser = null;

try {
  importScripts('../lib/fxp.min.js');
  if (self.FXP && self.FXP.XMLParser) {
    fastParser = new self.FXP.XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      attributeNamePrefix: '@_',
      parseTagValue: false,
      trimValues: true,
      cdataPropName: '__cdata',
    });
  }
} catch (_) {
  fastParser = null;
}

function toArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function strValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (typeof value === 'object') {
    if (typeof value['#text'] !== 'undefined') return String(value['#text']).trim();
    if (typeof value.__cdata !== 'undefined') return String(value.__cdata).trim();
  }
  return '';
}

function fileNameNoExt(path) {
  const raw = String(path || '').split(/[\\/]/).pop() || '';
  return raw.replace(/\.xml$/i, '');
}

function deriveContextFromPath(path) {
  const parts = String(path || '').split(/[\\/]+/).filter(Boolean);
  const axIndex = parts.findIndex(p => /^AxTable(Extension)?$/i.test(p));
  if (axIndex < 0) return { isRelevant: false, isExtension: false, model: 'Unknown' };
  return {
    isRelevant: true,
    isExtension: /Extension$/i.test(parts[axIndex]),
    model: (axIndex > 0 ? parts[axIndex - 1] : 'Unknown') || 'Unknown',
  };
}

function relationKey(rel) {
  const constraints = Array.isArray(rel?.constraints) ? rel.constraints : [];
  const cKey = constraints.map(c => `${c.field}=${c.relatedField}`).join('&');
  return `${rel?.name || ''}|${rel?.relatedTable || ''}|${cKey}`;
}

function createAggTable(name) {
  return {
    name,
    tableGroup: 'None',
    model: '',
    models: new Set(),
    fields: [],
    relations: [],
    _fieldByName: new Map(),
    _relByKey: new Map(),
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
    if (!existing.type && field.type) existing.type = String(field.type);
    if (!existing.extendedDataType && field.extendedDataType) existing.extendedDataType = String(field.extendedDataType);
    if (!existing.enumType && field.enumType) existing.enumType = String(field.enumType);
    mergeSourceModels(existing, field, model);
  });

  (fragment.relations || []).forEach(rel => {
    if (!rel?.relatedTable) return;
    const key = relationKey(rel);
    const existing = table._relByKey.get(key);
    if (!existing) {
      const copy = {
        name: String(rel?.name || ''),
        relatedTable: String(rel?.relatedTable || ''),
        cardinality: String(rel?.cardinality || ''),
        relatedTableCardinality: String(rel?.relatedTableCardinality || ''),
        relationshipType: String(rel?.relationshipType || ''),
        constraints: Array.isArray(rel?.constraints)
          ? rel.constraints.map(c => ({
              field: String(c?.field || ''),
              relatedField: String(c?.relatedField || ''),
            })).filter(c => c.field && c.relatedField)
          : [],
        sourceModels: [],
      };
      mergeSourceModels(copy, rel, model);
      table.relations.push(copy);
      table._relByKey.set(key, copy);
      return;
    }
    mergeSourceModels(existing, rel, model);
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
    out.push({
      name: t.name,
      tableGroup: t.tableGroup || 'None',
      model,
      models: models.length ? models : [model],
      fields,
      relations,
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

function parseByFastParser(xmlText, path) {
  if (!fastParser) return null;
  const parsed = fastParser.parse(xmlText);
  if (!parsed || typeof parsed !== 'object') return null;

  const rootName = parsed.AxTable ? 'AxTable' : (parsed.AxTableExtension ? 'AxTableExtension' : null);
  if (!rootName) return null;
  const rootRaw = parsed[rootName];
  const root = Array.isArray(rootRaw) ? rootRaw[0] : rootRaw;
  if (!root || typeof root !== 'object') return null;
  const ctx = deriveContextFromPath(path);
  const isExtension = rootName === 'AxTableExtension' || ctx.isExtension;
  const objectName = strValue(root?.Name) || fileNameNoExt(path);
  const baseName = isExtension && objectName.includes('.') ? objectName.split('.')[0] : objectName;
  if (!baseName) return null;

  const model = ctx.model || 'Unknown';
  const tableGroup = !isExtension ? (strValue(root?.TableGroup) || 'None') : 'None';

  const fields = [];
  const fieldNodes = toArray(root?.Fields?.AxTableField);
  fieldNodes.forEach(f => {
    const name = strValue(f?.Name);
    if (!name) return;
    const type = strValue(f?.['@_type'] || f?.['@_i:type']);
    fields.push({
      name,
      type,
      extendedDataType: strValue(f?.ExtendedDataType),
      enumType: strValue(f?.EnumType),
      sourceModels: [model],
    });
  });

  const relations = [];
  const relNodes = toArray(root?.Relations?.AxTableRelation);
  relNodes.forEach(r => {
    const relatedTable = strValue(r?.RelatedTable);
    if (!relatedTable) return;
    const constraints = toArray(r?.Constraints?.AxTableRelationConstraint)
      .filter(c => {
        const cType = strValue(c?.['@_type'] || c?.['@_i:type']);
        return !cType || cType === 'AxTableRelationConstraintField';
      })
      .map(c => ({
        field: strValue(c?.Field),
        relatedField: strValue(c?.RelatedField),
      }))
      .filter(c => c.field && c.relatedField);
    if (!constraints.length) return;
    relations.push({
      name: strValue(r?.Name),
      relatedTable,
      cardinality: strValue(r?.Cardinality),
      relatedTableCardinality: strValue(r?.RelatedTableCardinality),
      relationshipType: strValue(r?.RelationshipType),
      constraints,
      sourceModels: [model],
    });
  });

  return {
    name: baseName,
    isExtension,
    model,
    models: [model],
    tableGroup,
    fields,
    relations,
  };
}

function parseByRegex(xmlText, path) {
  const ctx = deriveContextFromPath(path);
  const isExt = /<AxTableExtension/i.test(xmlText) || ctx.isExtension;
  
  const extract = (regex, txt) => {
    const m = txt.match(regex);
    return m ? m[1].trim() : '';
  };

  const nameMatch = extract(/<Name>([^<]+)<\/Name>/i, xmlText);
  const objectName = nameMatch || fileNameNoExt(path);
  const baseName = isExt && objectName.includes('.') ? objectName.split('.')[0] : objectName;
  if (!baseName) return null;

  const model = ctx.model || 'Unknown';
  const tableGroup = !isExt ? (extract(/<TableGroup>([^<]+)<\/TableGroup>/i, xmlText) || 'None') : 'None';

  const fields = [];
  const fieldsMatch = xmlText.match(/<Fields>([\s\S]*?)<\/Fields>/i);
  if (fieldsMatch) {
    const fieldBlocks = fieldsMatch[1].match(/<AxTableField[^>]*>([\s\S]*?)<\/AxTableField[A-Za-z0-9]*>/gi) || [];
    fieldBlocks.forEach(fb => {
      const fName = extract(/<Name>([^<]+)<\/Name>/i, fb);
      if (!fName) return;
      
      let type = '';
      const typeMatch = fb.match(/(?:i:type|type)="([^"]+)"/i);
      if (typeMatch) type = typeMatch[1];
      else {
        const tagMatch = fb.match(/<AxTableField([A-Za-z0-9]+)/i);
        if (tagMatch) type = 'AxTableField' + tagMatch[1];
      }

      fields.push({
        name: fName,
        type: type,
        extendedDataType: extract(/<ExtendedDataType>([^<]+)<\/ExtendedDataType>/i, fb),
        enumType: extract(/<EnumType>([^<]+)<\/EnumType>/i, fb),
        sourceModels: [model]
      });
    });
  }

  const relations = [];
  const relsMatch = xmlText.match(/<Relations>([\s\S]*?)<\/Relations>/i);
  if (relsMatch) {
    const relBlocks = relsMatch[1].match(/<AxTableRelation>([\s\S]*?)<\/AxTableRelation>/gi) || [];
    relBlocks.forEach(rb => {
      const rTable = extract(/<RelatedTable>([^<]+)<\/RelatedTable>/i, rb);
      if (!rTable) return;

      const constraints = [];
      const constMatch = rb.match(/<Constraints>([\s\S]*?)<\/Constraints>/i);
      if (constMatch) {
        const cBlocks = constMatch[1].match(/<AxTableRelationConstraint[^>]*>([\s\S]*?)<\/AxTableRelationConstraint[A-Za-z0-9]*>/gi) || [];
        cBlocks.forEach(cb => {
          const typeMatch = cb.match(/(?:i:type|type)="([^"]+)"/i);
          if (typeMatch && typeMatch[1] !== 'AxTableRelationConstraintField') return;
          
          const cField = extract(/<Field>([^<]+)<\/Field>/i, cb);
          const cRelated = extract(/<RelatedField>([^<]+)<\/RelatedField>/i, cb);
          if (cField && cRelated) {
            constraints.push({ field: cField, relatedField: cRelated });
          }
        });
      }
      
      if (!constraints.length) return;

      relations.push({
        name: extract(/<Name>([^<]+)<\/Name>/i, rb),
        relatedTable: rTable,
        cardinality: extract(/<Cardinality>([^<]+)<\/Cardinality>/i, rb),
        relatedTableCardinality: extract(/<RelatedTableCardinality>([^<]+)<\/RelatedTableCardinality>/i, rb),
        relationshipType: extract(/<RelationshipType>([^<]+)<\/RelationshipType>/i, rb),
        constraints,
        sourceModels: [model]
      });
    });
  }

  return {
    name: baseName,
    isExtension: isExt,
    model,
    models: [model],
    tableGroup,
    fields,
    relations
  };
}

function parseXml(xmlText, path) {
  const fast = parseByFastParser(xmlText, path);
  if (fast) return fast;
  return parseByRegex(xmlText, path);
}

async function parsePartition(workerId, files) {
  const tableMap = new Map();
  const extMap = new Map();
  let processed = 0;
  let errors = 0;

  for (const entry of files) {
    processed += 1;
    try {
      const file = await entry.handle.getFile();
      const xmlText = await file.text();
      const fragment = parseXml(xmlText, entry.path);
      if (!fragment || !fragment.name) continue;
      mergeFragment(tableMap, fragment);
      if (fragment.isExtension) {
        const extKey = `${fragment.name}::${fragment.model}`;
        if (!extMap.has(extKey)) {
          extMap.set(extKey, {
            tableName: fragment.name,
            model: fragment.model || 'Unknown',
            files: 0,
            fieldsAdded: 0,
            relationsAdded: 0,
          });
        }
        const ext = extMap.get(extKey);
        ext.files += 1;
        ext.fieldsAdded += fragment.fields.length;
        ext.relationsAdded += fragment.relations.length;
      }
    } catch (_) {
      errors += 1;
    }

    if (processed % 25 === 0) {
      self.postMessage({ type: 'progress', workerId, processed, errors });
    }
  }

  self.postMessage({
    type: 'result',
    workerId,
    processed,
    errors,
    tables: finalizeAggTables(tableMap),
    extensions: finalizeExt(extMap),
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
        message: err?.message || 'Falha desconhecida no metadata-worker.',
      });
    });
};
