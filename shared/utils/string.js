/* =====================================================================
   shared/utils/string.js
   Utilitários de manipulação de strings — sem dependências externas
   ===================================================================== */
'use strict';

/**
 * Gera um alias curto para uma tabela a partir do seu nome PascalCase.
 * Extrai as primeiras letras de cada segmento de palavra.
 *
 * @param {string} name - Nome da tabela (ex: "SalesTable", "VendInvoiceJour")
 * @returns {string} Alias de 2-3 caracteres (ex: "st", "vij")
 *
 * @example
 * tableAlias('SalesTable')     // → 'st'
 * tableAlias('CustTable')      // → 'ct'
 * tableAlias('VendInvoiceJour') // → 'vij'
 * tableAlias('ProjTable')       // → 'pt'
 */
function tableAlias(name) {
  if (!name) return 'x';
  const parts = name.replace(/([A-Z])/g, ' $1').trim().split(' ').filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, 3).map(p => p[0].toLowerCase()).join('');
  return name.slice(0, 2).toLowerCase();
}

/**
 * Trunca uma string e adiciona reticências se ultrapassar maxLen.
 *
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

/**
 * Mapeia símbolo de cardinalidade D365 para notação UML.
 *
 * @param {string} raw - Valor vindo do XML (ex: 'ZeroOne', 'ZeroMore')
 * @returns {string} Símbolo UML (ex: '0..1', '0..*')
 */
function mapCardinalitySymbol(raw) {
  const MAP = {
    ZeroOne: '0..1',
    ExactlyOne: '1..1',
    ZeroMore: '0..*',
    OneMore: '1..*',
  };
  return MAP[raw] || '';
}

/**
 * Constrói o label de uma relação a partir das constraints.
 *
 * @param {Object} rel - Objeto de relação com .name e .constraints
 * @returns {string}
 */
function buildRelationLabel(rel) {
  const constraints = rel?.constraints || [];
  const mapped = constraints.slice(0, 2).map(c =>
    c.field === c.relatedField ? c.field : `${c.field}=${c.relatedField}`
  ).join(', ');
  return rel?.name || mapped || '';
}

/**
 * Cria uma RegExp segura — retorna null em vez de lançar para padrões inválidos.
 *
 * @param {string} pattern
 * @param {string} flags
 * @returns {RegExp|null}
 */
function createSafeRegex(pattern, flags = 'i') {
  if (!pattern) return null;
  try { return new RegExp(pattern, flags); } catch { return null; }
}

window.D365StringUtils = {
  tableAlias,
  truncate,
  mapCardinalitySymbol,
  buildRelationLabel,
  createSafeRegex,
};