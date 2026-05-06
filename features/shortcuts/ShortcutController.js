/* =====================================================================
   features/shortcuts/ShortcutController.js
   Gerenciamento de atalhos de teclado globais
   ===================================================================== */
'use strict';

(function () {
  /**
   * Inicializa os listeners de teclado.
   * Chamado no final do carregamento do app.
   */
  function init() {
    console.log('🚀 ShortcutController: Sistema de atalhos inicializado.');
    window.addEventListener('keydown', handleGlobalKeyDown);
  }

  /**
   * Handler principal de atalhos.
   * @param {KeyboardEvent} e
   */
  function handleGlobalKeyDown(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const alt = e.altKey;
    const code = e.code;
    const key = e.key.toLowerCase();

    // Evitar atalhos se estiver em um campo de texto
    const tag = e.target.tagName;
    const isEditable = e.target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (isEditable && key !== 'escape') {
      return;
    }

    // Delete / Backspace: Remover selecionados
    if (code === 'Delete' || code === 'Backspace') {
      const selected = window.cy?.nodes(':selected');
      if (selected && selected.length > 0) {
        e.preventDefault();
        window.pushUndo?.();
        
        // Se deletar tabelas que estão no HUD, limpa o HUD
        if (window.querySequence) {
          window.querySequence.length = 0;
          if (typeof window.updateHud === 'function') window.updateHud();
        }

        selected.remove();
        window.updateGraphStats?.();
        window.renderVS?.();
      }
    }

    // Ctrl + F: Focar busca no canvas
    if (ctrl && code === 'KeyF') {
      e.preventDefault();
      const inp = document.getElementById('canvas-search-input');
      if (inp) {
        inp.focus();
        inp.select();
      }
    }

    // Ctrl + , : Abrir configurações
    if (ctrl && key === ',') {
      e.preventDefault();
      document.getElementById('open-settings-btn')?.click();
    }

    // Ctrl + B: Alternar bolha
    if (ctrl && code === 'KeyB') {
      e.preventDefault();
      document.getElementById('bubble-anim-btn')?.click();
    }

    // Ctrl + S: Exportar grafo (JSON)
    if (ctrl && !alt && code === 'KeyS') {
      e.preventDefault();
      window.exportGraph();
    }

    // Ctrl + O: Importar grafo
    if (ctrl && code === 'KeyO') {
      e.preventDefault();
      document.getElementById('import-graph-btn')?.click();
    }

    // Ctrl + L: Limpar grafo
    if (ctrl && !alt && code === 'KeyL') {
      e.preventDefault();
      if (confirm('Limpar grafo?')) window.clearGraph();
    }

    // Ctrl + Z: Desfazer
    if (ctrl && code === 'KeyZ') {
      e.preventDefault();
      window.undoAction?.();
    }

    // Ctrl + Alt + L: Forçar Layout
    if (ctrl && alt && code === 'KeyL') {
      e.preventDefault();
      e.stopPropagation();
      if (typeof window.applyLayout === 'function') {
        window.applyLayout();
      }
    }

    // Ctrl + Alt + P: Exportar Imagem
    if (ctrl && alt && code === 'KeyP') {
      e.preventDefault();
      if (typeof window.exportImage === 'function') {
        window.exportImage();
      }
    }

    // Escape: Fechar modais e painéis, limpar HUD
    if (key === 'escape') {
      // 1. Se estiver em um campo editável, retira o foco
      if (isEditable) {
        e.target.blur();
      }

      // 2. Se houver modais abertos, fecha-os
      const modals = document.querySelectorAll('.shortcuts-modal:not(.hidden)');
      if (modals.length) {
        modals.forEach(m => m.classList.add('hidden'));
        return;
      } 
      
      // 3. Limpa HUD e seleção do grafo (sempre que ESC for pressionado e não houver modal)
      if (window.cy) {
        window.cy.batch(() => {
          window.cy.nodes().removeClass('cy-node-queued');
          window.cy.nodes().unselect();
        });
        
        if (window.querySequence) {
          window.querySequence.length = 0; // Limpa o conteúdo do array original
          if (typeof window.updateHud === 'function') window.updateHud();
        }
      }
      
      // 4. Fecha o painel lateral de detalhes
      if (typeof window.closeDetail === 'function') {
        window.closeDetail();
      }
    }
  }

  window.D365Shortcuts = { init };
})();