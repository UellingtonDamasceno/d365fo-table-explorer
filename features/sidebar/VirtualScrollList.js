/* =====================================================================
   features/sidebar/VirtualScrollList.js
   Virtual scroll com pool de elementos DOM — zero memory leak de listeners
   ===================================================================== */
'use strict';

class VirtualScrollList {
  /**
   * @param {HTMLElement} container - Elemento com overflow-y: auto
   * @param {HTMLElement} inner - Elemento filho que define altura total
   * @param {Object} options
   * @param {number} options.itemHeight - Altura fixa de cada item em px
   * @param {Function} options.renderItem - (item, element) => void — preenche o elemento com os dados
   * @param {Function} options.onItemClick - (item, event) => void
   * @param {Function} options.onItemHover - (item, x, y) => void
   * @param {Function} options.onItemLeave - () => void
   * @param {Function} options.onItemMove - (x, y) => void
   * @param {number} [options.overscan=2] - Itens extras acima/abaixo da viewport
   */
  constructor(container, inner, options = {}) {
    this._container = container;
    this._inner = inner;
    this._itemHeight = options.itemHeight || 40;
    this._renderItem = options.renderItem || (() => {});
    this._onItemClick = options.onItemClick || (() => {});
    this._onItemHover = options.onItemHover || (() => {});
    this._onItemLeave = options.onItemLeave || (() => {});
    this._onItemMove = options.onItemMove || (() => {});
    this._overscan = options.overscan ?? 2;

    /** @type {any[]} Dataset atual */
    this._items = [];
    /** @type {{ start: number, end: number }} */
    this._viewport = { start: -1, end: -1 };
    /** @type {HTMLElement[]} Pool de elementos DOM reutilizáveis */
    this._pool = [];

    // ── Event handlers com referências fixas (para removeEventListener) ──
    this._onScroll = () => this.render();
    this._onClick = (e) => {
      const item = e.target.closest('[data-vs-index]');
      if (!item) return;
      const idx = parseInt(item.dataset.vsIndex, 10);
      if (!isNaN(idx) && this._items[idx]) this._onItemClick(this._items[idx], e);
    };
    this._onMouseover = (e) => {
      const item = e.target.closest('[data-vs-index]');
      if (!item) return;
      const idx = parseInt(item.dataset.vsIndex, 10);
      if (!isNaN(idx) && this._items[idx]) this._onItemHover(this._items[idx], e.clientX, e.clientY);
    };
    this._onMouseout = (e) => {
      if (e.target.closest('[data-vs-index]')) this._onItemLeave();
    };
    this._onMousemove = (e) => {
      if (e.target.closest('[data-vs-index]')) this._onItemMove(e.clientX, e.clientY);
    };

    // Registrar listeners — UM listener por evento, com delegation
    this._container.addEventListener('scroll', this._onScroll, { passive: true });
    this._inner.addEventListener('click', this._onClick);
    this._inner.addEventListener('mouseover', this._onMouseover);
    this._inner.addEventListener('mouseout', this._onMouseout);
    this._inner.addEventListener('mousemove', this._onMousemove);
  }

  /**
   * Atualiza o dataset e re-renderiza.
   *
   * @param {any[]} items
   */
  setItems(items) {
    this._items = items || [];
    this._container.scrollTop = 0;
    this._viewport = { start: -1, end: -1 };
    this._inner.style.height = (this._items.length * this._itemHeight) + 'px';
    this.render(true);
  }

  /**
   * Re-renderiza a viewport atual.
   *
   * @param {boolean} [force=false]
   */
  render(force = false) {
    const scrollTop = this._container.scrollTop;
    const clientH = this._container.clientHeight;
    const total = this._items.length;

    const start = Math.max(0, Math.floor(scrollTop / this._itemHeight) - this._overscan);
    const end = Math.min(total, Math.ceil((scrollTop + clientH) / this._itemHeight) + this._overscan);

    if (!force && start === this._viewport.start && end === this._viewport.end) return;
    this._viewport = { start, end };

    // Remover elementos fora da viewport do DOM
    const keepIndices = new Set();
    for (let i = start; i < end; i++) keepIndices.add(i);

    // Limpar inner de itens fora da range atual
    [...this._inner.children].forEach(el => {
      const idx = parseInt(el.dataset.vsIndex, 10);
      if (!keepIndices.has(idx)) {
        this._inner.removeChild(el);
        this._pool.push(el);
      }
    });

    // Mapear índices já no DOM
    const inDom = new Map();
    [...this._inner.children].forEach(el => {
      inDom.set(parseInt(el.dataset.vsIndex, 10), el);
    });

    // Adicionar/atualizar itens na range
    for (let i = start; i < end; i++) {
      if (inDom.has(i)) {
        // Já está no DOM — pode atualizar classes dinâmicas
        this._renderItem(this._items[i], inDom.get(i), i);
        continue;
      }

      // Reutilizar do pool ou criar novo
      const el = this._pool.pop() || this._createPoolElement();
      el.dataset.vsIndex = i;
      el.style.top = (i * this._itemHeight) + 'px';
      this._renderItem(this._items[i], el, i);
      this._inner.appendChild(el);
    }
  }

  /**
   * Atualiza classes dinâmicas sem re-render completo.
   * Útil para atualizar estado 'active' e 'in-graph'.
   */
  refresh() {
    this.render(true);
  }

  /**
   * Libera todos os recursos.
   */
  destroy() {
    this._container.removeEventListener('scroll', this._onScroll);
    this._inner.removeEventListener('click', this._onClick);
    this._inner.removeEventListener('mouseover', this._onMouseover);
    this._inner.removeEventListener('mouseout', this._onMouseout);
    this._inner.removeEventListener('mousemove', this._onMousemove);
    this._inner.innerHTML = '';
    this._pool = [];
    this._items = [];
  }

  // ── PRIVADO ─────────────────────────────────────────────────────────

  _createPoolElement() {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.right = '0';
    el.style.height = this._itemHeight + 'px';
    return el;
  }
}

window.D365VirtualScrollList = VirtualScrollList;