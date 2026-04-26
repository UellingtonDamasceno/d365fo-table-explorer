/* =====================================================================
   features/pathfinding/PathfindingController.js
   Orquestração da UI de pathfinding e rotas alternativas
   ===================================================================== */
'use strict';

const PathfindingController = {
  /**
   * Executa a busca de caminho simples (com waypoints).
   */
  findPath(config, state, callbacks) {
    const from = document.getElementById('path-from').value;
    const to = document.getElementById('path-to').value;
    const waypoints = [...document.querySelectorAll('#waypoints-container input')].map(i => i.value).filter(Boolean);
    const stops = [from, ...waypoints, to];
    
    let fullPath = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const seg = window.D365BfsEngine.bfs(stops[i], stops[i+1], { 
        strict: config.strictDirection,
        maxDepth: config.maxDepth 
      });
      if (!seg) {
        alert(`Caminho não encontrado: ${stops[i]} -> ${stops[i+1]}`);
        return;
      }
      fullPath = fullPath.length ? fullPath.concat(seg.slice(1)) : seg;
    }

    if (callbacks.onPathFound) {
      callbacks.onPathFound(fullPath);
    }
  },

  /**
   * Encontra e renderiza rotas alternativas no modal.
   */
  findAltRoutes(config) {
    const from = document.getElementById('path-from').value;
    const to = document.getElementById('path-to').value;
    if (!from || !to) {
      alert('Selecione origem e destino para ver rotas alternativas.');
      return;
    }

    const routes = window.D365BfsEngine.bfsMultiple(from, to, { 
      strict: config.strictDirection, 
      maxDepth: config.maxDepth 
    });
    
    this.renderAltRoutes(routes, config);
  },

  /**
   * Renderiza a lista de rotas alternativas no DOM.
   */
  renderAltRoutes(routes, config) {
    const resultEl = document.getElementById('path-result');
    if (!resultEl) return;
    
    resultEl.classList.remove('hidden');
    if (routes.length === 0) {
      resultEl.innerHTML = '<div style="padding:10px;color:var(--text-muted)">Nenhuma rota encontrada.</div>';
      return;
    }

    const esc = window.D365DomUtils.esc;
    const items = routes.map((route, i) => {
      const hops = route.length - 1;
      const label = route.map(s => s.table).join(' → ');
      return `<div class="alt-route-item" data-idx="${i}" style="cursor:pointer;padding:8px;border-bottom:1px solid var(--border);font-size:12px;">
        <span style="font-weight:bold;color:var(--primary)">${hops} salto${hops !== 1 ? 's' : ''}:</span> ${esc(label)}
      </div>`;
    }).join('');

    resultEl.innerHTML = `
      <div style="font-weight:bold;margin-bottom:8px;font-size:11px;text-transform:uppercase;color:var(--text-muted)">🔀 Rotas Alternativas (${routes.length})</div>
      <div class="alt-routes-list">${items}</div>`;

    // Eventos de clique nas rotas
    resultEl.querySelectorAll('.alt-route-item').forEach(el => {
      el.onclick = () => {
        const route = routes[parseInt(el.dataset.idx)];
        // Dispara evento global ou callback para o app gerenciar a adição ao grafo
        const event = new CustomEvent('d365:pathSelected', { detail: { path: route } });
        window.dispatchEvent(event);
      };
    });
  }
};

window.D365PathfindingController = PathfindingController;
