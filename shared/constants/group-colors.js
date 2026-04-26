/* =====================================================================
   shared/constants/group-colors.js
   Mapeamento de TableGroup → cores e tags CSS
   ===================================================================== */
'use strict';

const GROUP_COLORS = Object.freeze({
  'Main':              Object.freeze({ bg: '#1d4ed8', border: '#3b82f6', tag: 'tag-blue'   }),
  'Transaction':       Object.freeze({ bg: '#b45309', border: '#f59e0b', tag: 'tag-orange' }),
  'TransactionHeader': Object.freeze({ bg: '#92400e', border: '#d97706', tag: 'tag-orange' }),
  'TransactionLine':   Object.freeze({ bg: '#7c3aed', border: '#a78bfa', tag: 'tag-purple' }),
  'Group':             Object.freeze({ bg: '#15803d', border: '#22c55e', tag: 'tag-green'  }),
  'WorksheetHeader':   Object.freeze({ bg: '#6d28d9', border: '#8b5cf6', tag: 'tag-purple' }),
  'WorksheetLine':     Object.freeze({ bg: '#0e7490', border: '#06b6d4', tag: 'tag-teal'   }),
  'Staging':           Object.freeze({ bg: '#374151', border: '#6b7280', tag: 'tag-gray'   }),
  'Parameter':         Object.freeze({ bg: '#065f46', border: '#10b981', tag: 'tag-green'  }),
  'Framework':         Object.freeze({ bg: '#1f2937', border: '#4b5563', tag: 'tag-gray'   }),
  'Reference':         Object.freeze({ bg: '#78350f', border: '#d97706', tag: 'tag-yellow' }),
  'None':              Object.freeze({ bg: '#1e2130', border: '#3d4468', tag: 'tag-gray'   }),
});

/**
 * Retorna a configuração de cor para um TableGroup.
 * Nunca lança — retorna 'None' como fallback.
 *
 * @param {string} group
 * @returns {{ bg: string, border: string, tag: string }}
 */
function groupColor(group) {
  return GROUP_COLORS[group] || GROUP_COLORS['None'];
}

window.D365GroupColors = { GROUP_COLORS, groupColor };