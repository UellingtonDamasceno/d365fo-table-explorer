/* Graph helpers */
(function () {
  function debounce(fn, wait = 100) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  window.D365Graph = { debounce };
})();
