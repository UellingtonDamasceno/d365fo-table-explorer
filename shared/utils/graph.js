/* =====================================================================
   shared/utils/graph.js
   Utilitários compartilhados para manipulação de grafos (Cytoscape)
   ===================================================================== */
'use strict';

(function () {
  const GraphUtils = {
    /**
     * Debounce: executa fn apenas N ms após o último call.
     *
     * @param {Function} fn
     * @param {number} wait
     * @returns {Function}
     */
    debounce(fn, wait = 100) {
      let t = null;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
      };
    },

    /**
     * Constrói dados de aresta para o Cytoscape.
     *
     * @param {string} id
     * @param {string} source
     * @param {string} target
     * @param {Object} rel
     * @returns {Object}
     */
    buildEdgeData(id, source, target, rel) {
      const { buildRelationLabel, mapCardinalitySymbol } = window.D365StringUtils;
      return {
        id,
        source,
        target,
        label: buildRelationLabel(rel),
        sourceCardinality: mapCardinalitySymbol(rel?.cardinality),
        targetCardinality: mapCardinalitySymbol(rel?.relatedTableCardinality),
      };
    },

    /**
     * Calcula o centro geométrico de um conjunto de nós Cytoscape.
     *
     * @param {Object[]} nodes - Array de nós Cytoscape com .position()
     * @returns {{ x: number, y: number } | null}
     */
    centerOfNodes(nodes) {
      if (!nodes || !nodes.length) return null;
      let sx = 0, sy = 0;
      nodes.forEach(n => {
        const p = n.position();
        sx += p.x;
        sy += p.y;
      });
      return { x: sx / nodes.length, y: sy / nodes.length };
    }
  };

  window.D365GraphUtils = GraphUtils;
  // Fallback para compatibilidade com código que usa D365Graph
  window.D365Graph = GraphUtils;
})();