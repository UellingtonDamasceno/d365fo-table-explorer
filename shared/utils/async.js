/* =====================================================================
   shared/utils/async.js
   Utilitários de temporização e controle de fluxo assíncrono
   ===================================================================== */
'use strict';

/**
 * Debounce: atrasa execução até N ms após o último call.
 *
 * @param {Function} fn
 * @param {number} wait - milissegundos
 * @returns {Function}
 */
function debounce(fn, wait = 100) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/**
 * Throttle: garante no máximo uma execução por N ms.
 *
 * @param {Function} fn
 * @param {number} limit - milissegundos
 * @returns {Function}
 */
function throttle(fn, limit = 100) {
  let lastCall = 0;
  return function (...args) {
    const now = performance.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      return fn.apply(this, args);
    }
  };
}

/**
 * Executa callback quando o thread principal está ocioso.
 * Fallback para setTimeout se requestIdleCallback não disponível.
 *
 * @param {Function} callback
 * @param {number} timeout - timeout máximo em ms
 */
function idleCallback(callback, timeout = 2000) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(callback, { timeout });
  } else {
    setTimeout(callback, 0);
  }
}

window.D365AsyncUtils = { debounce, throttle, idleCallback };