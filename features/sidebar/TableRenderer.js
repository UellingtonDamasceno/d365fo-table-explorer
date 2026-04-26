/* =====================================================================
   features/sidebar/TableRenderer.js
   Renderização de detalhes da tabela (campos, relações, breadcrumbs, filtros)
   ===================================================================== */
'use strict';

const TableRenderer = {
  /**
   * Determina a categoria do tipo de campo para UI de filtros.
   */
  getFieldTypeCategory(f) {
    if (!f) return 'string';
    const type = (f.type || '').replace('AxTableField', '');
    const edt = (f.extendedDataType || f.edt || '').toLowerCase();
    const enumType = (f.enumType || '').toLowerCase();

    if (type === 'Enum' || enumType === 'noyes' || edt === 'noyesid') return 'enum';
    if (['Int', 'Int64', 'Real'].includes(type)) return 'numeric';
    if (type === 'Date') return 'date';
    if (type === 'DateTime') return 'datetime';
    if (type === 'Container') return 'container';
    return 'string';
  },

  /**
   * Retorna os operadores disponíveis para uma categoria de campo.
   */
  getOperatorsForType(category) {
    const common = ['==', '!=', 'in'];
    const compare = ['>', '<', '>=', '<='];
    if (category === 'numeric' || category === 'date' || category === 'datetime') return [...common, ...compare];
    if (category === 'string') return [...common, 'like'];
    if (category === 'enum') return ['==', '!='];
    if (category === 'container') return ['==', '!=', 'in'];
    return common;
  },

  /**
   * Renderiza a lista de campos em uma tabela HTML.
   */
  renderFields(fields, tableName, selectedSet) {
    if (!fields || !fields.length) return '';

    return fields.map(f => {
      const type = (f.type || '').replace(/^AxTableField/, '');
      const edt = f.edt || f.extendedDataType || f.enumType || '';
      const sourceModel = (f.sourceModels || [])[0] || 'Base';
      const checked = selectedSet ? selectedSet.has(f.name) : false;

      return `
        <tr class="field-row" tabindex="0">
          <td><input class="field-select-cb" type="checkbox" data-field="${window.D365DomUtils.esc(f.name)}" ${checked ? 'checked' : ''} /></td>
          <td>${window.D365DomUtils.esc(f.name)}</td>
          <td><span class="type-badge">${window.D365DomUtils.esc(type)}</span></td>
          <td>${edt ? `<span class="edt-badge">${window.D365DomUtils.esc(edt)}</span>` : '<span class="no">—</span>'}</td>
          <td><span class="table-group-tag">${window.D365DomUtils.esc(sourceModel)}</span></td>
        </tr>`;
    }).join('');
  },

  /**
   * Renderiza cards de relações.
   */
  renderRelations(relations) {
    if (!relations || !relations.length) return '';

    return relations.map(r => {
      const constraintsHtml = (r.constraints || []).map(c => `
        <div class="nav-constraint">
          <span>${window.D365DomUtils.esc(c.field)}</span>
          <span class="nav-constraint-arrow">→</span>
          <span>${window.D365DomUtils.esc(c.relatedField)}</span>
        </div>
      `).join('');

      return `
        <div class="nav-card" data-related="${window.D365DomUtils.esc(r.relatedTable)}">
          <div class="nav-card-top">
            <span class="nav-name">${window.D365DomUtils.esc(r.name || r.relatedTable)}</span>
            ${r.cardinality ? `<span class="cardinality-badge">${window.D365DomUtils.esc(r.cardinality)}</span>` : ''}
          </div>
          <div>
            <span style="font-size:11px;color:var(--text-muted)">→ </span>
            <span class="nav-related">${window.D365DomUtils.esc(r.relatedTable)}</span>
          </div>
          ${constraintsHtml ? `<div class="nav-card-constraints">${constraintsHtml}</div>` : ''}
        </div>`;
    }).join('');
  },

  /**
   * Renderiza o HTML das condições de filtro.
   */
  renderFilterItems(t, filters) {
    const esc = window.D365DomUtils.esc;
    
    return filters.map((f, i) => {
      const fieldInfo = t.fields.find(fld => fld.name === f.field);
      const category = this.getFieldTypeCategory(fieldInfo);
      const ops = this.getOperatorsForType(category);
      
      let valueInputHtml = '';
      const isMultiValue = f.op === 'in';

      if (category === 'enum' && !isMultiValue) {
        const isNoYes = (fieldInfo?.enumType || '').toLowerCase() === 'noyes' || (fieldInfo?.extendedDataType || '').toLowerCase() === 'noyesid';
        if (isNoYes) {
          valueInputHtml = `<select class="f-val">
            <option value="NoYes::No" ${f.value.includes('No') ? 'selected' : ''}>No</option>
            <option value="NoYes::Yes" ${f.value.includes('Yes') ? 'selected' : ''}>Yes</option>
          </select>`;
        } else {
          valueInputHtml = `<input type="text" class="f-val" value="${esc(f.value)}" placeholder="Enum value..." />`;
        }
      } else if (category === 'date' && !isMultiValue) {
        valueInputHtml = `<input type="date" class="f-val" value="${esc(f.value)}" />`;
      } else if (category === 'datetime' && !isMultiValue) {
        valueInputHtml = `<input type="datetime-local" class="f-val" value="${esc(f.value)}" />`;
      } else if (category === 'numeric' && !isMultiValue) {
        valueInputHtml = `<input type="number" class="f-val" value="${esc(f.value)}" step="any" placeholder="0.00" />`;
      } else {
        const placeholder = isMultiValue ? 'val1, val2, val3...' : (category === 'container' ? 'val1, val2...' : 'Valor...');
        valueInputHtml = `<input type="text" class="f-val" value="${esc(f.value)}" placeholder="${placeholder}" autocomplete="off" />`;
      }

      return `
      <div class="filter-group" data-idx="${i}">
        <div class="filter-group-row">
          ${i > 0 ? `
            <select class="f-logic">
              <option value="&&" ${f.logic === '&&' ? 'selected' : ''}>&&</option>
              <option value="||" ${f.logic === '||' ? 'selected' : ''}>||</option>
            </select>
          ` : ''}
          <div class="autocomplete-wrapper f-field-wrapper">
            <input type="text" class="f-field" value="${esc(f.field)}" placeholder="Campo..." autocomplete="off" />
          </div>
          <button class="btn btn-ghost btn-xs remove-filter-btn" title="Remover filtro">✕</button>
        </div>

        <div class="filter-group-row">
          <select class="f-op">
            ${ops.map(o => `<option value="${o}" ${f.op === o ? 'selected' : ''}>${o.replace('>', '&gt;').replace('<', '&lt;')}</option>`).join('')}
          </select>
          ${valueInputHtml}
        </div>
      </div>`;
    }).join('');
  },

  /**
   * Constrói HTML de breadcrumbs.
   */
  renderBreadcrumbs(history, current) {
    if (!current) return '';
    let html = '';
    history.forEach((t, i) => {
      html += `<span class="breadcrumb-item" data-idx="${i}">${window.D365DomUtils.esc(t.name)}</span>`;
      html += `<span class="breadcrumb-sep"> > </span>`;
    });
    html += `<span class="breadcrumb-current">${window.D365DomUtils.esc(current.name)}</span>`;
    
    if (history.length > 0) {
      html += `<button class="btn btn-ghost btn-sm add-trail-btn" id="add-trail-to-graph-btn" title="Adicionar todas as tabelas deste caminho ao grafo">📌 Fixar trilha</button>`;
    }
    return html;
  }
};

window.D365TableRenderer = TableRenderer;