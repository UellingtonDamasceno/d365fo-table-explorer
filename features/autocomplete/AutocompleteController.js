/* =====================================================================
   features/autocomplete/AutocompleteController.js
   Componente de Autocomplete Reutilizável - v2.1 (Modular e Seguro)
   ===================================================================== */
'use strict';

(function () {
  /**
   * Gerencia instâncias de autocomplete e listeners globais.
   */
  class AutocompleteController {
    constructor() {
      this._globalListenerActive = false;
      this._activeInstances = new Set();
      this._boundGlobalClick = this._onGlobalClick.bind(this);
    }

    /**
     * Garante que o listener global de clique está ativo.
     */
    _ensureGlobalListener() {
      if (this._globalListenerActive) return;
      this._globalListenerActive = true;
      document.addEventListener('click', this._boundGlobalClick);
    }

    /**
     * Remove o listener global se não houver mais instâncias ativas.
     */
    _checkGlobalListener() {
      if (this._activeInstances.size === 0 && this._globalListenerActive) {
        document.removeEventListener('click', this._boundGlobalClick);
        this._globalListenerActive = false;
      }
    }

    /**
     * Handler de clique global para fechar dropdowns ao clicar fora.
     */
    _onGlobalClick(e) {
      this._activeInstances.forEach(instance => instance.closeIfOutside(e.target));
    }

    /**
     * Cria uma nova instância de autocomplete.
     * 
     * @param {HTMLInputElement} input O campo de texto.
     * @param {Object} options Configurações.
     * @returns {Object} A instância criada.
     */
    create(input, options = {}) {
      if (!input) return null;

      const {
        getSuggestions,
        onSelect,
        maxResults = 10,
        minChars = 1,
      } = options;

      let currentFocus = -1;
      let container = null;

      this._ensureGlobalListener();

      const close = () => {
        if (container && container.parentNode) {
          container.parentNode.removeChild(container);
        }
        container = null;
        currentFocus = -1;
      };

      const getItems = () => {
        return container ? Array.from(container.querySelectorAll('div')) : [];
      };

      const setActive = (items) => {
        if (!items.length) return;
        items.forEach(i => i.classList.remove('autocomplete-active'));
        if (currentFocus >= items.length) currentFocus = 0;
        if (currentFocus < 0) currentFocus = items.length - 1;
        items[currentFocus].classList.add('autocomplete-active');
        items[currentFocus].scrollIntoView({ block: 'nearest' });
      };

      const onInput = () => {
        const val = input.value;
        close();
        if (!val || val.length < minChars) return;
        currentFocus = -1;

        const suggestions = getSuggestions(val).slice(0, maxResults);
        if (!suggestions.length) return;

        container = document.createElement('div');
        container.setAttribute('class', 'autocomplete-items');

        const longest = suggestions.reduce((a, b) => (a.length > b.length ? a : b), '');
        const minWidth = Math.min(600, Math.max(input.offsetWidth, longest.length * 8 + 24));
        container.style.minWidth = minWidth + 'px';

        suggestions.forEach(match => {
          const item = document.createElement('div');
          const safe = match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const reg = new RegExp('(' + safe + ')', 'gi');
          item.innerHTML = match.replace(reg, '<strong>$1</strong>');
          item.addEventListener('click', function () {
            input.value = match;
            close();
            if (onSelect) onSelect(match);
          });
          container.appendChild(item);
        });

        const wrapper = input.parentNode;
        if (wrapper) wrapper.appendChild(container);
      };

      const onKeydown = (e) => {
        const items = getItems();
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          currentFocus++;
          setActive(items);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          currentFocus--;
          setActive(items);
        } else if (e.key === 'Enter') {
          if (currentFocus > -1 && items[currentFocus]) {
            e.preventDefault();
            items[currentFocus].click();
          }
        } else if (e.key === 'Escape') {
          close();
        }
      };

      const instance = {
        closeIfOutside: (target) => {
          if (target !== input && target !== container && !container?.contains(target)) {
            close();
          }
        },
        destroy: () => {
          close();
          input.removeEventListener('input', onInput);
          input.removeEventListener('keydown', onKeydown);
          this._activeInstances.delete(instance);
          this._checkGlobalListener();
        }
      };

      input.addEventListener('input', onInput);
      input.addEventListener('keydown', onKeydown);

      this._activeInstances.add(instance);
      return instance;
    }
  }

  // Exportar instância global única
  window.D365Autocomplete = new AutocompleteController();
})();