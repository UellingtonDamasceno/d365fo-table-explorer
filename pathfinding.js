/* Pathfinding helpers */
(function () {
  function shouldUseWhileSelect(rel) {
    return ['ZeroMore', 'OneMore'].includes(rel?.relatedTableCardinality);
  }

  window.D365Pathfinding = { shouldUseWhileSelect };
})();
