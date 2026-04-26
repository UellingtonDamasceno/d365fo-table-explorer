/* =====================================================================
   features/dashboard/DashboardController.js
   Análise de metadados e relatórios de telemetria
   ===================================================================== */
'use strict';

const DashboardController = {
  /**
   * Renderiza os cartões e gráficos do dashboard.
   */
  render(sourceTables, config, inboundRelIndex) {
    const esc = window.D365DomUtils.esc;
    if (!sourceTables.length) return;

    const totalTables = sourceTables.length;
    const totalFields = sourceTables.reduce((n, t) => n + (t.fields?.length || 0), 0);
    const totalRelations = sourceTables.reduce((n, t) => n + (t.relations?.length || 0), 0);
    const avgDensity = totalTables ? (totalRelations / totalTables).toFixed(2) : '0.00';
    
    const modelCounts = {};
    sourceTables.forEach(t => {
      const models = Array.isArray(t.models) && t.models.length ? t.models : [t.model || 'Unknown'];
      const uniqueModels = [...new Set(models.map(m => String(m || '').trim()).filter(Boolean))];
      uniqueModels.forEach(m => {
        modelCounts[m] = (modelCounts[m] || 0) + 1;
      });
    });
    const totalModels = Object.keys(modelCounts).length;

    const cards = document.getElementById('dashboard-cards');
    if (cards) {
      cards.innerHTML = `
        <div class="dashboard-card"><div class="n">${totalTables.toLocaleString()}</div><div class="l">Tabelas</div></div>
        <div class="dashboard-card"><div class="n">${totalFields.toLocaleString()}</div><div class="l">Campos</div></div>
        <div class="dashboard-card"><div class="n">${totalRelations.toLocaleString()}</div><div class="l">Relações</div></div>
        <div class="dashboard-card"><div class="n">${avgDensity}</div><div class="l">Densidade média</div></div>
        <div class="dashboard-card"><div class="n">${totalModels.toLocaleString()}</div><div class="l">Modelos</div></div>`;
    }

    const scopedNames = new Set(sourceTables.map(t => t.name));
    
    // Group Distribution
    const groupCounts = {};
    sourceTables.forEach(t => groupCounts[t.tableGroup || 'None'] = (groupCounts[t.tableGroup || 'None'] || 0) + 1);
    const groupRows = Object.entries(groupCounts).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<div class="dash-item"><span>${esc(k)}</span><span>${v}</span></div>`).join('');
    const groupDist = document.getElementById('dash-group-dist');
    if (groupDist) groupDist.innerHTML = `<div class="dash-list">${groupRows}</div>`;

    // Model Distribution
    const modelRows = Object.entries(modelCounts).sort((a, b) => b[1] - a[1]).slice(0, 30)
      .map(([k, v]) => `<div class="dash-item"><span>${esc(k)}</span><span>${v}</span></div>`).join('');
    const modelDist = document.getElementById('dash-model-dist');
    if (modelDist) modelDist.innerHTML = `<div class="dash-list">${modelRows}</div>`;

    // Top Connected
    const connected = sourceTables.map(t => ({
      name: t.name,
      score: (t.relations?.filter(r => scopedNames.has(r.relatedTable)).length || 0) +
        ((inboundRelIndex.get ? (inboundRelIndex.get(t.name) || []) : (inboundRelIndex[t.name] || [])).filter(r => scopedNames.has(r.from)).length || 0),
    })).sort((a, b) => b.score - a.score).slice(0, 10);
    const topConnected = document.getElementById('dash-top-connected');
    if (topConnected) {
      topConnected.innerHTML = `<div class="dash-list">${
        connected.map(x => `<div class="dash-item"><a class="dash-link" data-table="${esc(x.name)}">${esc(x.name)}</a><span>${x.score}</span></div>`).join('')
      }</div>`;
    }

    // Top Fields
    const fieldTop = sourceTables.map(t => ({ name: t.name, score: t.fields?.length || 0 }))
      .sort((a, b) => b.score - a.score).slice(0, 10);
    const topFields = document.getElementById('dash-top-fields');
    if (topFields) {
      topFields.innerHTML = `<div class="dash-list">${
        fieldTop.map(x => `<div class="dash-item"><a class="dash-link" data-table="${esc(x.name)}">${esc(x.name)}</a><span>${x.score}</span></div>`).join('')
      }</div>`;
    }

    // Enums
    const enumCounts = {};
    sourceTables.forEach(t => (t.fields || []).forEach(f => {
      const en = f.enumType || (String(f.type || '').toLowerCase().includes('enum') ? (f.edt || 'Enum') : '');
      if (en) enumCounts[en] = (enumCounts[en] || 0) + 1;
    }));
    const enums = Object.entries(enumCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const dashEnums = document.getElementById('dash-enums');
    if (dashEnums) {
      dashEnums.innerHTML = `<div class="dash-list">${
        enums.map(([k, v]) => `<div class="dash-item"><span>${esc(k)}</span><span>${v}</span></div>`).join('')
      }</div>`;
    }

    // Orphans
    const orphans = sourceTables.filter(t =>
      ((t.relations?.filter(r => scopedNames.has(r.relatedTable)).length || 0) +
      ((inboundRelIndex[t.name] || []).filter(r => scopedNames.has(r.from)).length || 0)) === 0
    ).slice(0, 200);
    const dashOrphans = document.getElementById('dash-orphans');
    if (dashOrphans) {
      dashOrphans.innerHTML = `<div class="dash-list">${
        orphans.map(t => `<div class="dash-item"><a class="dash-link" data-table="${esc(t.name)}">${esc(t.name)}</a><span>0</span></div>`).join('')
      }</div>`;
    }
  },

  /**
   * Renderiza o modal de telemetria.
   */
  renderTelemetry(telemetry) {
    const content = document.getElementById('telemetry-content');
    if (!content) return;

    if (!telemetry) {
      content.innerHTML = '<p style="color:var(--text-muted);font-style:italic">Nenhum dado de telemetria disponível.</p>';
      return;
    }

    const workerRows = telemetry.workerMetrics.map(m => `
      <tr>
        <td>Worker ${m.workerId}</td>
        <td>${m.files.toLocaleString()}</td>
        <td>${m.errors}</td>
        <td>${m.totalMs.toFixed(2)}ms</td>
        <td>${m.avgMs}ms</td>
      </tr>`).join('');

    content.innerHTML = `
      <div class="telemetry-summary">
        <div class="telemetry-summary-item"><span>Tempo Total:</span><span>${telemetry.totalTimeSec}s</span></div>
        <div class="telemetry-summary-item"><span>Varredura de Disco:</span><span>${(telemetry.scanTimeMs / 1000).toFixed(2)}s</span></div>
        <div class="telemetry-summary-item"><span>Parsing/Merge XML:</span><span>${(telemetry.parseTimeMs / 1000).toFixed(2)}s</span></div>
        <div class="telemetry-summary-item"><span>Total de Arquivos:</span><span>${telemetry.fileCount.toLocaleString()}</span></div>
        <div class="telemetry-summary-item"><span>Vazão Média:</span><span>${(telemetry.fileCount / telemetry.totalTimeSec).toFixed(2)} f/s</span></div>
      </div>
      <table class="telemetry-table">
        <thead><tr><th>Thread</th><th>Arquivos</th><th>Erros</th><th>CPU Total</th><th>Média/Arquivo</th></tr></thead>
        <tbody>${workerRows}</tbody>
      </table>`;
  }
};

window.D365DashboardController = DashboardController;