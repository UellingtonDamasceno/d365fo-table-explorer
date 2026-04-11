/* Shortcut helpers */
(function () {
  function isInputElement(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || el.isContentEditable;
  }

  window.D365Shortcuts = { isInputElement };
})();
