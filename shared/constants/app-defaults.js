/* =====================================================================
   shared/constants/app-defaults.js
   Configuração padrão da aplicação — fonte única de verdade
   ===================================================================== */
'use strict';

const APP_DEFAULTS = Object.freeze({
  layout:                   'breadthfirst',
  nodeRepulsion:            8000,
  idealEdgeLength:          120,
  autoZoomFont:             true,
  showRelationName:         true,
  showMultiplicity:         false,
  bubbleMode:               false,
  directionalHighlight:     false,
  strictDirection:          false,
  maxDepth:                 8,
  dashboardUseSidebarFilter: true,
  includeSystemFields:      false,
});

const VIRTUAL_SCROLL_ITEM_HEIGHT = 40; // px — altura de cada item da lista

const GRAPH_CONSTANTS = Object.freeze({
  MIN_NODE_WIDTH:  100,
  MAX_NODE_WIDTH:  180,
  NODE_HEIGHT:     34,
  CHARS_PER_PX:    7.5,
  NODE_PADDING:    16,
  MAX_LABEL_CHARS: 20,
  LABEL_TRUNCATE:  18,
});

const UNDO_MAX_STACK_SIZE = 10;

window.D365AppDefaults = {
  APP_DEFAULTS,
  VIRTUAL_SCROLL_ITEM_HEIGHT,
  GRAPH_CONSTANTS,
  UNDO_MAX_STACK_SIZE,
};