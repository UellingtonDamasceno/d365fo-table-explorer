/* =====================================================================
   features/query/QueryController.js
   Orquestração de geração de queries para UI
   ===================================================================== */
'use strict';

const QueryController = {
  /**
   * Gera e renderiza a query simples para uma única tabela.
   */
  genSimpleQuery(t, config, state) {
    const { buildWhereClause, buildOrderByClause, buildSelectProjection } = window.D365SqlBuilder;
    const { highlightSql, highlightXpp, renderQueryBlock } = window.D365QueryRenderer;
    const tableAlias = window.D365StringUtils.tableAlias;

    const alias = tableAlias(t.name);
    const pickedFields = state.selectedFieldsByTable[t.name] || new Set();
    const projection = buildSelectProjection(t.name, pickedFields, alias, config.includeSystemFields);
    
    const whereSql = buildWhereClause(state.tableFiltersByTable[t.name], t.fields, alias, 'sql');
    const orderSql = buildOrderByClause(state.tableOrderByByTable[t.name], t, alias, 'sql');
    const sqlRaw = `SELECT\n    ${projection.join(',\n    ')}\nFROM ${t.name} AS ${alias}${whereSql.clause ? `\nWHERE ${whereSql.clause}` : ''}${orderSql ? `\n${orderSql}` : ''}`;
    
    const whereXpp = buildWhereClause(state.tableFiltersByTable[t.name], t.fields, alias, 'xpp');
    const orderXpp = buildOrderByClause(state.tableOrderByByTable[t.name], t, alias, 'xpp');
    const xppPicked = [...pickedFields];
    const xppSelectExpr = xppPicked.length ? xppPicked.join(', ') : alias;
    const xppRaw = `${whereXpp.containerDecls.length ? `// Declarations\n${whereXpp.containerDecls.join('\n')}\n\n` : ''}select ${xppSelectExpr}\n    from ${t.name}${whereXpp.clause ? `\n    where ${whereXpp.clause}` : ''}${orderXpp ? `\n    ${orderXpp}` : ''};`;

    const output = document.getElementById('query-output');
    const pathLabel = document.getElementById('query-path-label');
    const toggleBtn = document.getElementById('toggle-while-select-btn');
    const hint = document.getElementById('query-hint');
    const accordion = document.getElementById('query-accordion');

    if (output) output.innerHTML = renderQueryBlock(highlightSql(sqlRaw), highlightXpp(xppRaw));
    if (pathLabel) pathLabel.textContent = `Tabela: ${t.name}`;
    if (toggleBtn) toggleBtn.classList.add('hidden');
    if (hint) hint.classList.add('hidden');
    if (accordion) accordion.classList.add('hidden');
    if (output) output.classList.remove('hidden');
  },

  /**
   * Renderiza o accordion de queries para um caminho (path) de tabelas.
   */
  renderQueryAccordion(path, config, state, whileSelectMode) {
    const accordion = document.getElementById('query-accordion');
    const hint = document.getElementById('query-hint');
    const output = document.getElementById('query-output');
    if (!accordion || !path || path.length < 2) return;

    const { buildWhereClause, buildOrderByClause, buildSelectProjection, buildJoinConditions, resolveConstraints } = window.D365SqlBuilder;
    const { highlightSql, highlightXpp, renderQueryBlock } = window.D365QueryRenderer;
    const tableAlias = window.D365StringUtils.tableAlias;
    const getTable = (name) => window.D365TableStore.get(name);

    hint.classList.add('hidden');
    output.classList.add('hidden');
    accordion.classList.remove('hidden');

    const buildAliasMap = (subPath) => {
      const aliases = {};
      const used = new Set();
      subPath.forEach((step, i) => {
        let a = tableAlias(step.table);
        if (used.has(a)) a += (i + 1);
        used.add(a);
        aliases[step.table] = a;
      });
      return aliases;
    };

    const buildSqlForPath = (subPath) => {
      const aliases = buildAliasMap(subPath);
      const first = subPath[0];
      const projection = subPath.flatMap(step => buildSelectProjection(step.table, state.selectedFieldsByTable[step.table], aliases[step.table], config.includeSystemFields));
      let sqlLines = [`SELECT ${projection.join(', ')}\nFROM ${first.table} AS ${aliases[first.table]}`];
      
      for (let i = 1; i < subPath.length; i++) {
        const step = subPath[i];
        const a = aliases[step.table];
        const rel = subPath[i].relation;
        const prevTable = getTable(subPath[i - 1].table);
        const nextTable = getTable(step.table);
        const resolved = resolveConstraints(prevTable, nextTable, rel);
        const joinConds = buildJoinConditions(aliases[subPath[i-1].table], a, resolved.constraints, config.includeSystemFields, resolved.inferred);
        sqlLines.push(`    INNER JOIN ${step.table} AS ${a}\n        ON ${joinConds.join('\n        AND ')}`);
      }

      const whereParts = subPath.map(step => buildWhereClause(state.tableFiltersByTable[step.table], getTable(step.table)?.fields, aliases[step.table], 'sql').clause).filter(Boolean);
      if (whereParts.length > 0) sqlLines.push(`WHERE ${whereParts.join('\n  AND ')}`);

      const lastStep = subPath[subPath.length - 1];
      const orderSql = buildOrderByClause(state.tableOrderByByTable[lastStep.table], getTable(lastStep.table), aliases[lastStep.table], 'sql');
      if (orderSql) sqlLines.push(orderSql);

      return sqlLines.join('\n');
    };

    const buildXppForPath = (subPath) => {
      const aliases = buildAliasMap(subPath);
      const containerDecls = [];
      subPath.forEach(step => {
        const res = buildWhereClause(state.tableFiltersByTable[step.table], getTable(step.table)?.fields, aliases[step.table], 'xpp');
        if (res.containerDecls.length) containerDecls.push(...res.containerDecls);
      });

      const xppSelect = subPath.map((step, i) => {
        const a = aliases[step.table];
        const picked = state.selectedFieldsByTable[step.table] || new Set();
        const fieldChunk = picked.size ? [...picked].join(', ') : a;
        const whereRes = buildWhereClause(state.tableFiltersByTable[step.table], getTable(step.table)?.fields, a, 'xpp');

        if (i === 0) {
          const selectKw = whileSelectMode ? 'while select' : 'select firstOnly';
          return `${selectKw} ${fieldChunk}${whereRes.clause ? `\n    where ${whereRes.clause}` : ''}`;
        }

        const rel = subPath[i].relation;
        const prevTable = getTable(subPath[i - 1].table);
        const nextTable = getTable(step.table);
        const resolved = resolveConstraints(prevTable, nextTable, rel);
        const joinConds = buildJoinConditions(aliases[subPath[i-1].table], a, resolved.constraints, config.includeSystemFields, resolved.inferred, 'xpp');
        
        const joinHeader = `    join ${fieldChunk}`;
        let fullJoinWhere = joinConds.join('\n        && ');
        if (whereRes.clause) fullJoinWhere += (fullJoinWhere ? `\n        && ` : '') + whereRes.clause;
        return !fullJoinWhere ? joinHeader : `${joinHeader}\n    where ${fullJoinWhere}`;
      });

      const varDecls = subPath.map(step => `    ${step.table} ${aliases[step.table]};`).join('\n');
      const suffix = whileSelectMode ? '\n{\n    // TODO: Sua lógica aqui\n}' : ';';
      return `// Declarations\n${varDecls}${containerDecls.length ? '\n' + containerDecls.join('\n') : ''}\n\n// Query\n${xppSelect.join('\n')}${suffix}`;
    };

    // Render Individual Queries
    const sect1Items = path.map(step => {
      const alias = tableAlias(step.table);
      const picked = state.selectedFieldsByTable[step.table] || new Set();
      const projection = buildSelectProjection(step.table, picked, alias, config.includeSystemFields);
      const sql = `SELECT\n    ${projection.join(',\n    ')}\nFROM ${step.table} AS ${alias}`;
      const xppSelectExpr = picked.size ? [...picked].join(', ') : alias;
      const xpp = `// Declaration\n${step.table} ${alias};\n\n// Query\nselect firstOnly ${xppSelectExpr};`;
      return `<div class="accordion-item"><button class="accordion-header">${window.D365DomUtils.esc(step.table)}</button><div class="accordion-body">${renderQueryBlock(highlightSql(sql), highlightXpp(xpp))}</div></div>`;
    }).join('');

    // Render Partial Query
    const currentTableName = state.currentDetail?.name;
    const k = path.findIndex(s => s.table === currentTableName);
    let sect2Content = (currentTableName && k > 0)
      ? renderQueryBlock(highlightSql(buildSqlForPath(path.slice(0, k + 1))), highlightXpp(buildXppForPath(path.slice(0, k + 1))))
      : '<p style="font-size:12px;color:#6b7280">Abra uma tabela do caminho no painel de detalhes para ver a query parcial.</p>';

    accordion.innerHTML = `
      <div class="accordion-item"><button class="accordion-header open">📋 Queries Individuais</button><div class="accordion-body open">${sect1Items}</div></div>
      <div class="accordion-item"><button class="accordion-header">🔍 Query Parcial</button><div class="accordion-body">${sect2Content}</div></div>
      <div class="accordion-item"><button class="accordion-header">🔗 Query Completa</button><div class="accordion-body">${renderQueryBlock(highlightSql(buildSqlForPath(path)), highlightXpp(buildXppForPath(path)))}</div></div>`;

    accordion.querySelectorAll('.accordion-header').forEach(hdr => {
      hdr.addEventListener('click', () => {
        hdr.classList.toggle('open');
        hdr.nextElementSibling.classList.toggle('open');
      });
    });
  }
};

window.D365QueryController = QueryController;