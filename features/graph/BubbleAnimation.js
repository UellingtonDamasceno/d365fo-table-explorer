/* =====================================================================
   features/graph/BubbleAnimation.js
   Animação de bolhas para nós do grafo Cytoscape
   Elimina race condition via estado self-contained
   ===================================================================== */
'use strict';

class BubbleAnimation {
  constructor() {
    this._cy = null;
    this._raf = null;
    this._phases = {};
    this._running = false;

    // Bind this to _loop to avoid losing context when passed to requestAnimationFrame
    this._loop = this._loop.bind(this);
  }

  /**
   * Inicia a animação de bolhas.
   * Idempotente — se já estiver rodando, não cria segundo loop.
   *
   * @param {Object} cy - Instância Cytoscape
   */
  start(cy) {
    if (!cy) return;
    if (this._running) return;   // GUARD: previne loop duplo

    this._cy = cy;
    this._running = true;
    this._phases = {};

    cy.nodes().forEach(n => {
      this._phases[n.id()] = {
        t:         Math.random() * Math.PI * 2,
        speed:     0.02 + Math.random() * 0.01,
        amplitude: 2 + Math.random() * 2,
        ox:        n.position('x'),
        oy:        n.position('y'),
      };
    });

    this._loop();
  }

  /**
   * Para a animação e restaura posições originais.
   */
  stop() {
    this._running = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    if (this._cy) {
      this._cy.nodes().forEach(n => {
        const p = this._phases[n.id()];
        if (p) n.position({ x: p.ox, y: p.oy });
      });
    }

    this._phases = {};
    this._cy = null;
  }

  /**
   * Atualiza a origem de um nó após drag.
   * Deve ser chamado no evento 'dragfree' do Cytoscape.
   *
   * @param {string} nodeId
   * @param {number} x
   * @param {number} y
   */
  updateOrigin(nodeId, x, y) {
    if (!this._phases[nodeId]) return;
    this._phases[nodeId].ox = x;
    this._phases[nodeId].oy = y;
    this._phases[nodeId].t = 0;
  }

  /**
   * Pausa o loop durante layout e reinicia após, com origens atualizadas.
   * Retorna uma função para chamar no layoutstop.
   *
   * @returns {Function} onLayoutStop callback
   */
  pauseForLayout() {
    if (!this._running) return () => {};
    this.stop();
    return (cy) => {
      // Reinicia com as novas posições pós-layout
      this.start(cy || this._cy);
    };
  }

  /** @returns {boolean} */
  get isRunning() { return this._running; }

  // ── PRIVADO ─────────────────────────────────────────────────────────

  _loop() {
    if (!this._running || !this._cy) return;

    this._cy.startBatch();
    this._cy.nodes().forEach(n => {
      if (n.grabbed()) return;
      const id = n.id();

      if (!this._phases[id]) {
        this._phases[id] = {
          t: Math.random() * Math.PI * 2,
          speed: 0.02 + Math.random() * 0.01,
          amplitude: 2 + Math.random() * 2,
          ox: n.position('x'),
          oy: n.position('y'),
        };
      }

      const p = this._phases[id];
      p.t += p.speed;
      n.position({
        x: p.ox + Math.sin(p.t) * p.amplitude,
        y: p.oy + Math.cos(p.t * 0.7) * p.amplitude,
      });
    });
    this._cy.endBatch();

    this._raf = requestAnimationFrame(this._loop);
  }
}

// Instância global singleton
const bubbleAnimation = new BubbleAnimation();
window.D365BubbleAnimation = bubbleAnimation;