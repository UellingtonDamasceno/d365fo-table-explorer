/* =====================================================================
   shared/utils/dom-ui.js
   Gerenciamento de comportamentos de UI (Collapse, Resize, Tooltips)
   ===================================================================== */
'use strict';

const DomUI = {
  /**
   * Alterna o estado do colapso da sidebar.
   */
  toggleSidebarCollapse() {
    const sidebar = document.querySelector('.sidebar');
    const btn = document.getElementById('toggle-sidebar-btn');
    const collapsed = sidebar.classList.toggle('collapsed');
    if (btn) {
      btn.textContent = collapsed ? '▶' : '◀';
      btn.title = collapsed ? 'Expandir sidebar' : 'Minimizar sidebar';
    }
    // Dispara redimensionamento do grafo após a transição
    setTimeout(() => window.cy?.resize(), 220);
  },

  /**
   * Alterna o estado do colapso do painel de detalhes.
   */
  toggleDetailCollapse() {
    const panel = document.getElementById('detail-panel');
    const btn = document.getElementById('toggle-detail-btn');
    if (!panel) return;
    const collapsed = panel.classList.toggle('collapsed');
    if (btn) {
      btn.textContent = collapsed ? '◀' : '▶';
      btn.title = collapsed ? 'Expandir painel' : 'Minimizar painel';
    }
    const resizer = document.getElementById('detail-resizer');
    if (resizer) resizer.style.display = collapsed ? 'none' : '';
    setTimeout(() => window.cy?.resize(), 220);
  },

  /**
   * Inicializa os resizers de drag-and-drop.
   */
  initResizers(onSidebarResize) {
    // Sidebar Resize
    const sResizer = document.getElementById('sidebar-resizer');
    const sidebar = document.querySelector('.sidebar');
    if (sResizer && sidebar) {
      let dragging = false, startX = 0, startW = 0;
      sResizer.addEventListener('mousedown', e => {
        dragging = true; startX = e.clientX; startW = sidebar.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      });
      document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const w = Math.max(200, Math.min(500, startW + e.clientX - startX));
        sidebar.style.width = w + 'px';
        if (onSidebarResize) onSidebarResize();
      });
      document.addEventListener('mouseup', () => {
        dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      });
    }

    // Detail Panel Resize
    const dResizer = document.getElementById('detail-resizer');
    const panel = document.getElementById('detail-panel');
    if (dResizer && panel) {
      let dragging = false, startX = 0, startW = 0;
      dResizer.addEventListener('mousedown', e => {
        dragging = true; startX = e.clientX; startW = panel.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      });
      document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const delta = startX - e.clientX;
        const w = Math.max(300, Math.min(600, startW + delta));
        panel.style.width = w + 'px';
      });
      document.addEventListener('mouseup', () => {
        dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      });
    }
  },

  /**
   * Gerenciamento de Tooltips do Grafo.
   */
  showTooltip(t, x, y) {
    const nameEl = document.getElementById('tt-name');
    const groupEl = document.getElementById('tt-group');
    const fieldsEl = document.getElementById('tt-fields');
    const relsEl = document.getElementById('tt-rels');
    const tooltip = document.getElementById('hover-tooltip');
    
    if (nameEl) nameEl.textContent = t.name;
    if (groupEl) groupEl.textContent = t.tableGroup;
    if (fieldsEl) fieldsEl.textContent = t.fields?.length || 0;
    if (relsEl) relsEl.textContent = t.relations?.length || 0;
    
    if (tooltip) {
      tooltip.classList.remove('hidden');
      this.updateTooltipPos(x, y);
    }
  },

  hideTooltip() {
    document.getElementById('hover-tooltip')?.classList.add('hidden');
  },

  updateTooltipPos(x, y) {
    const el = document.getElementById('hover-tooltip');
    if (!el || el.classList.contains('hidden')) return;
    const tw = el.offsetWidth || 240;
    const th = el.offsetHeight || 100;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let lx = x + 15;
    let ly = y + 10;
    if (lx + tw > vw) lx = x - tw - 10;
    if (ly + th > vh) ly = y - th - 10;
    el.style.left = lx + 'px';
    el.style.top = ly + 'px';
  }
};

window.D365DomUI = DomUI;