/* UI helpers */
(function () {
  function ensureVisibleInContainer(container, itemTop, itemBottom) {
    if (!container) return;
    const cTop = container.scrollTop;
    const cBottom = cTop + container.clientHeight;
    if (itemTop < cTop) container.scrollTop = itemTop;
    else if (itemBottom > cBottom) container.scrollTop = itemBottom - container.clientHeight;
  }

  window.D365UI = { ensureVisibleInContainer };
})();
