/* Search helpers */
(function () {
  function createSafeRegex(pattern) {
    if (!pattern) return null;
    try { return new RegExp(pattern, 'i'); } catch { return null; }
  }

  function centerOfNodes(nodes) {
    if (!nodes || nodes.length === 0) return null;
    let sx = 0, sy = 0;
    nodes.forEach(n => {
      const p = n.position();
      sx += p.x;
      sy += p.y;
    });
    return { x: sx / nodes.length, y: sy / nodes.length };
  }

  window.D365Search = { createSafeRegex, centerOfNodes };
})();
