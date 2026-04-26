/* =====================================================================
   shared/utils/dom.js
   Utilitários puros de DOM — sem dependências de estado de aplicação
   ===================================================================== */
'use strict';

/**
 * Escapa caracteres HTML para prevenir XSS.
 * Substitui a função esc() global em app.js.
 *
 * @param {*} str - Valor a ser escapado (qualquer tipo)
 * @returns {string} String com entidades HTML seguras
 *
 * @example
 * esc('<script>') // → '&lt;script&gt;'
 * esc(null)       // → ''
 * esc(42)         // → '42'
 */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Alterna uma classe CSS em um elemento com base numa condição.
 *
 * @param {HTMLElement} el
 * @param {string} className
 * @param {boolean} condition
 */
function toggleClass(el, className, condition) {
  if (!el) return;
  el.classList.toggle(className, !!condition);
}

/**
 * Mostra ou esconde um elemento usando a classe 'hidden'.
 *
 * @param {HTMLElement|string} elOrId - Elemento ou ID do elemento
 * @param {boolean} visible
 */
function setVisible(elOrId, visible) {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (!el) return;
  el.classList.toggle('hidden', !visible);
}

/**
 * Obtém elemento por ID com type-safety implícito.
 * Centraliza getElementById para facilitar mocking em testes.
 *
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function byId(id) {
  return document.getElementById(id);
}

/**
 * Copia o texto de um elemento pre para o clipboard.
 * 
 * @param {string} id - ID do elemento pre
 * @param {HTMLElement} btn - Botão que disparou a ação para feedback
 */
function copyCode(id, btn) {
  const pre = document.getElementById(id);
  if (!pre) return;
  const text = pre.textContent;
  navigator.clipboard.writeText(text).then(() => {
    const oldText = btn.innerHTML;
    btn.innerHTML = '✅ Copiado!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = oldText;
      btn.classList.remove('copied');
    }, 2000);
  });
}

/**
 * Expõe como módulo global e como export para futuro ES module.
 */
window.D365DomUtils = { esc, toggleClass, setVisible, byId, copyCode };