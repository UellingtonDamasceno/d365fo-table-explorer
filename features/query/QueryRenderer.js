/* =====================================================================
   features/query/QueryRenderer.js
   Aplica syntax highlighting ao SQL/X++ gerado pelo SqlBuilder
   ===================================================================== */
'use strict';

const KEYWORDS_SQL = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'INNER JOIN', 'ON', 'ORDER BY', 'AS', 'NOT', 'IN', 'LIKE'];
const KEYWORDS_XPP = ['select', 'while select', 'from', 'where', 'join', 'order by', 'firstOnly', 'crossCompany', '&&', '||'];    

/**
 * Aplica syntax highlighting em SQL puro.
 *
 * @param {string} sql - SQL puro sem HTML
 * @returns {string} HTML com spans de highlighting
 */
function highlightSql(sql) {
  if (!sql) return '';
  let result = sql
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Keywords
  const kwPattern = KEYWORDS_SQL
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  result = result.replace(new RegExp(`\\b(${kwPattern})\\b`, 'g'), '<span class="kw">$1</span>');

  // Tables (heurística: após FROM ou JOIN)
  result = result.replace(/\b(FROM|JOIN)\b\s+([A-Za-z0-9_]+)/gi, '$1 <span class="tbl">$2</span>');
  // Aliases (heurística: após AS)
  result = result.replace(/\b(AS)\b\s+([A-Za-z0-9_]+)/gi, '$1 <span class="tbl">$2</span>');

  // Fields (heurística: alias.field)
  result = result.replace(/([A-Za-z0-9_]+\.)([A-Za-z0-9_]+|\*)/g, '$1<span class="fld">$2</span>');

  return result;
}

/**
 * Aplica syntax highlighting em X++.
 *
 * @param {string} xpp
 * @returns {string}
 */
function highlightXpp(xpp) {
  if (!xpp) return '';
  let result = xpp
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Keywords
  const kwPattern = KEYWORDS_XPP
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  result = result.replace(new RegExp(`\\b(${kwPattern})\\b`, 'g'), '<span class="kw">$1</span>');

  // Tables and Aliases in declarations
  result = result.replace(/^(\s*)([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+);/gm, '$1<span class="tbl">$2</span> <span class="tbl">$3</span>;');

  // Fields (alias.field)
  result = result.replace(/([A-Za-z0-9_]+\.)([A-Za-z0-9_]+)/g, '$1<span class="fld">$2</span>');

  // Comments
  result = result.replace(/(\/\/[^\n]*)/g, '<span class="cm">$1</span>');

  return result;
}

/**
 * Renderiza um bloco de código com botão de cópia.
 *
 * @param {string} sqlHtml - HTML já com highlighting
 * @param {string} xppHtml - HTML já com highlighting
 * @returns {string} HTML do bloco completo
 */
function renderQueryBlock(sqlHtml, xppHtml) {
  const sqlId = 'sql-output-' + Math.random().toString(36).substr(2, 5);
  const xppId = 'xpp-output-' + Math.random().toString(36).substr(2, 5);
  
  return `
<h4 class="query-lang-label">SQL</h4>
<div class="code-block">
  <pre class="query-pre" id="${sqlId}">${sqlHtml}</pre>
  <button class="copy-btn" onclick="window.D365DomUtils.copyCode('${sqlId}', this)">📋 Copiar</button>
</div>
<h4 class="query-lang-label" style="margin-top:14px">X++ (select statement)</h4>
<div class="code-block">
  <pre class="query-pre" id="${xppId}">${xppHtml}</pre>
  <button class="copy-btn" onclick="window.D365DomUtils.copyCode('${xppId}', this)">📋 Copiar</button>
</div>`;
}

window.D365QueryRenderer = { highlightSql, highlightXpp, renderQueryBlock };