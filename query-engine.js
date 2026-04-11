/* Query helpers */
(function () {
  function inferConstraints(leftFields, rightFields) {
    const left = new Set((leftFields || []).map(f => (f.name || '').toLowerCase()).filter(Boolean));
    return (rightFields || [])
      .map(f => f.name || '')
      .filter(Boolean)
      .filter(n => left.has(n.toLowerCase()))
      .slice(0, 3)
      .map(n => ({ field: n, relatedField: n, inferred: true }));
  }

  window.D365Query = { inferConstraints };
})();
