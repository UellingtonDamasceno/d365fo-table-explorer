/* Lightweight state module */
(function () {
  const APP_CONFIG_KEY = 'd365fo-table-explorer:config:v2';
  const DEFAULT_CONFIG = {
    layout: 'cose',
    nodeRepulsion: 8000,
    idealEdgeLength: 120,
    autoZoomFont: true,
    showRelationName: true,
    showMultiplicity: false,
    bubbleMode: false,
    directionalHighlight: false,
    strictDirection: false,
    maxDepth: 8,
    dashboardUseSidebarFilter: true,
    includeSystemFields: false,
  };

  function normalizeConfig(raw) {
    const merged = { ...DEFAULT_CONFIG, ...(raw || {}) };
    // Backward compatibility
    if (typeof merged.showRelationName !== 'boolean' && typeof merged.showEdgeLabels === 'boolean') {
      merged.showRelationName = merged.showEdgeLabels;
    }
    if (typeof merged.showMultiplicity !== 'boolean' && typeof merged.showCardinality === 'boolean') {
      merged.showMultiplicity = merged.showCardinality;
    }
    merged.maxDepth = Math.max(1, Math.min(20, Number(merged.maxDepth) || 8));
    return merged;
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem(APP_CONFIG_KEY);
      if (!raw) return { ...DEFAULT_CONFIG };
      return normalizeConfig(JSON.parse(raw));
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem(APP_CONFIG_KEY, JSON.stringify(normalizeConfig(cfg)));
  }

  window.D365State = { APP_CONFIG_KEY, DEFAULT_CONFIG, normalizeConfig, loadConfig, saveConfig };
})();
