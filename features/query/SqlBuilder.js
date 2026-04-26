/* =====================================================================
   features/query/SqlBuilder.js
   Geração de SQL puro — SEM HTML, SEM efeitos colaterais
   ===================================================================== */
'use strict';

/**
 * Determina a categoria de tipo de um campo para determinar formatação.
 *
 * @param {Object} fieldInfo - Objeto de campo com .type, .extendedDataType, .enumType
 * @returns {'enum'|'numeric'|'date'|'datetime'|'container'|'string'}
 */
function getFieldTypeCategory(fieldInfo) {
  if (!fieldInfo) return 'string';
  const type = (fieldInfo.type || '').replace('AxTableField', '');
  const edt = (fieldInfo.extendedDataType || fieldInfo.edt || '').toLowerCase();
  const enumType = (fieldInfo.enumType || '').toLowerCase();

  if (type === 'Enum' || enumType === 'noyes' || edt === 'noyesid') return 'enum';
  if (['Int', 'Int64', 'Real'].includes(type)) return 'numeric';
  if (type === 'Date') return 'date';
  if (type === 'DateTime') return 'datetime';
  if (type === 'Container') return 'container';
  return 'string';
}

/**
 * Retorna operadores válidos para uma categoria de tipo.
 *
 * @param {string} category
 * @returns {string[]}
 */
function getOperatorsForCategory(category) {
  const common = ['==', '!=', 'in'];
  const compare = ['>', '<', '>=', '<='];
  if (category === 'numeric' || category === 'date' || category === 'datetime')
    return [...common, ...compare];
  if (category === 'string') return [...common, 'like'];
  if (category === 'enum') return ['==', '!='];
  return common;
}

/**
 * Formata um valor de filtro para SQL.
 *
 * @param {string} value
 * @param {string} op
 * @param {string} category
 * @returns {{ value: string, op: string }}
 */
function formatSqlValue(value, op, category) {
  let val = value;
  let sqlOp = op === '==' ? '=' : op;

  if (category === 'numeric') {
    val = val || '0';
  } else if (category === 'enum') {
    val = val.includes('::')
      ? (val.split('::')[1] === 'Yes' ? '1' : '0')
      : val;
  } else if (op === 'in') {
    const list = val.split(',').map(x => x.trim()).filter(Boolean);
    val = `(${list.map(x => isNaN(x) ? `'${x.replace(/'/g, "''")}'` : x).join(', ')})`;
  } else {
    val = `'${val.replace(/'/g, "''")}'`;
  }

  return { value: val, op: sqlOp };
}

/**
 * Formata um valor de filtro para X++.
 *
 * @param {string} value
 * @param {string} op
 * @param {string} category
 * @param {string} fieldName - Para gerar nome do container
 * @param {number} filterIndex - Índice do filtro no array
 * @returns {{ value: string, op: string, containerDecl: string }}
 */
function formatXppValue(value, op, category, fieldName, filterIndex) {
  let val = value;
  let xppOp = op;
  let containerDecl = '';

  if (category === 'enum') {
    // Mantém como está: Enum::Value
  } else if (category === 'date' && val) {
    val = `str2Date('${val}', 321)`;
  } else if (category === 'datetime' && val) {
    val = `DateTimeUtil::parse('${val.replace('T', ' ')}:00')`;
  } else if (category === 'numeric') {
    val = val || '0';
  } else if (op === 'in') {
    const conName = `con${fieldName}${filterIndex}`;
    const items = value.split(',').map(x => x.trim()).filter(Boolean);
    const conContent = items.map(v => isNaN(v) ? `'${v}'` : v).join(', ');
    containerDecl = `container ${conName} = [${conContent}];`;
    val = conName;
  } else {
    val = `'${val.replace(/'/g, "''")}'`;
  }

  return { value: val, op: xppOp, containerDecl };
}

/**
 * Constrói a cláusula WHERE para SQL (string pura, sem HTML).
 *
 * @param {Array} filters - Array de { field, op, value, logic }
 * @param {Object[]} tableFields - Campos da tabela para inferir tipos
 * @param {string} alias - Alias da tabela (ex: 'ct')
 * @param {'sql'|'xpp'} lang
 * @returns {{ clause: string, containerDecls: string[] }}
 */
function buildWhereClause(filters, tableFields, alias, lang = 'sql') {
  if (!filters || !filters.length) return { clause: '', containerDecls: [] };

  const containerDecls = [];
  const parts = filters.map((f, i) => {
    const fieldInfo = (tableFields || []).find(fld => fld.name === f.field);
    const category = getFieldTypeCategory(fieldInfo);
    const fieldPrefix = alias ? `${alias}.` : '';

    let formatted;
    if (lang === 'xpp') {
      formatted = formatXppValue(f.value, f.op, category, f.field, i);
      if (formatted.containerDecl) containerDecls.push(formatted.containerDecl);
    } else {
      formatted = formatSqlValue(f.value, f.op, category);
    }

    const logicStr = i > 0 ? `${f.logic || (lang === 'sql' ? 'AND' : '&&')} ` : '';
    return `${logicStr}${fieldPrefix}${f.field} ${formatted.op} ${formatted.value}`;
  });

  return { clause: parts.join('\n    '), containerDecls };
}

/**
 * Constrói a cláusula ORDER BY (string pura, sem HTML).
 *
 * @param {Object} orderBy - { indexName: string }
 * @param {Object} tableSchema - Objeto de tabela com .indexes
 * @param {string} alias
 * @param {'sql'|'xpp'} lang
 * @returns {string}
 */
function buildOrderByClause(orderBy, tableSchema, alias, lang = 'sql') {
  if (!orderBy || !orderBy.indexName) return '';
  const idx = (tableSchema?.indexes || []).find(i => i.name === orderBy.indexName);
  if (!idx || !idx.fields.length) return '';
  const fieldPrefix = alias ? `${alias}.` : '';
  const kw = lang === 'sql' ? 'ORDER BY' : 'order by';
  return `${kw} ` + idx.fields.map(f => `${fieldPrefix}${f}`).join(', ');
}

/**
 * Constrói a projeção SELECT (array de strings 'alias.field').
 *
 * @param {string} tableName
 * @param {Set<string>} selectedFields
 * @param {string} alias
 * @param {boolean} includeSystem
 * @returns {string[]}
 */
function buildSelectProjection(tableName, selectedFields, alias, includeSystem = false) {
  const picked = selectedFields && selectedFields.size > 0 ? [...selectedFields] : [];
  let out = picked.length > 0 ? picked.map(f => `${alias}.${f}`) : [`${alias}.*`];
  if (includeSystem) {
    // Evitar duplicatas se já estiverem no Set
    if (!picked.some(f => f.toLowerCase() === 'dataareaid')) out.push(`${alias}.DataAreaId`);
    if (!picked.some(f => f.toLowerCase() === 'partition')) out.push(`${alias}.Partition`);
  }
  return out;
}

/**
 * Constrói as condições de JOIN entre duas tabelas.
 *
 * @param {string} sourceAlias
 * @param {string} targetAlias
 * @param {Object[]} constraints - [{field, relatedField}]
 * @param {boolean} includeSystem
 * @param {boolean} inferred - Se as constraints são inferidas
 * @param {'sql'|'xpp'} lang
 * @returns {string[]} Array de condições de join
 */
function buildJoinConditions(sourceAlias, targetAlias, constraints, includeSystem, inferred = false, lang = 'sql') {
  const op = lang === 'sql' ? '=' : '==';
  const conditions = constraints.map(c =>
    `${sourceAlias}.${c.field} ${op} ${targetAlias}.${c.relatedField}`
  );

  if (includeSystem) {
    conditions.push(
      `${sourceAlias}.DataAreaId ${op} ${targetAlias}.DataAreaId`,
      `${sourceAlias}.Partition ${op} ${targetAlias}.Partition`
    );
  }
  
  if (inferred) {
    conditions.push(lang === 'sql' ? '/* constraints inferidas por nome de campo */' : '// constraints inferidas por nome de campo');
  }
  if (!constraints.length) {
    conditions.push(lang === 'sql' ? '/* relacionamento sem constraints mapeadas */' : '// relacionamento sem constraints mapeadas');
  }

  return conditions;
}

/**
 * Infere constraints de join por coincidência de nomes de campos.
 * Tenta encontrar até 3 campos com nomes idênticos (case-insensitive).
 */
function inferConstraints(leftFields, rightFields) {
  const left = new Set((leftFields || []).map(f => (f.name || '').toLowerCase()).filter(Boolean));
  return (rightFields || [])
    .map(f => f.name || '')
    .filter(Boolean)
    .filter(n => left.has(n.toLowerCase()))
    .slice(0, 3)
    .map(n => ({ field: n, relatedField: n, inferred: true }));
}

/**
 * Resolve constraints de uma relação entre dois passos do path.
 * Tenta: constraints explícitas → busca por nome → inferência por campos.
 *
 * @param {Object} prevTableSchema
 * @param {Object} nextTableSchema
 * @param {Object} rel - Relação do step
 * @returns {{ constraints: Object[], inferred: boolean }}
 */
function resolveConstraints(prevTableSchema, nextTableSchema, rel) {
  const rank = (c) => {
    const f = String(c.field || '');
    const rf = String(c.relatedField || '');
    const tech = /^(DOM|DataAreaId|Partition)$/i.test(f) || /^(DOM|DataAreaId|Partition)$/i.test(rf);
    const biz = /(Id|Account|RecId)$/i.test(f) || /(Id|Account|RecId)$/i.test(rf);
    if (biz && !tech) return 0;
    if (biz) return 1;
    if (tech) return 3;
    return 2;
  };
  const prioritize = arr => arr.slice().sort((a, b) => rank(a) - rank(b));

  // 1. Constraints explícitas na relação
  let explicit = (rel?.constraints || []).filter(c => c.field && c.relatedField);
  explicit = prioritize(explicit);
  if (explicit.length > 0) return { constraints: explicit, inferred: false };

  // 2. Busca por nome da relação na tabela anterior
  if (rel?.name) {
    const byName = (prevTableSchema?.relations || [])
      .find(r => r.name === rel.name && r.relatedTable === nextTableSchema?.name);
    const byNameConstraints = prioritize(
      (byName?.constraints || []).filter(c => c.field && c.relatedField)
    );
    if (byNameConstraints.length > 0) return { constraints: byNameConstraints, inferred: false };
  }

  // 3. Inferência por nome de campo
  const inferred = inferConstraints(prevTableSchema?.fields, nextTableSchema?.fields);
  return { constraints: prioritize(inferred), inferred: inferred.length > 0 };
}

window.D365SqlBuilder = {
  getFieldTypeCategory,
  getOperatorsForCategory,
  buildWhereClause,
  buildOrderByClause,
  buildSelectProjection,
  buildJoinConditions,
  resolveConstraints,
  inferConstraints
};