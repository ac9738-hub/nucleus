'use strict'

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escapeHtml }
}

if (typeof window !== 'undefined') {
  window.escapeHtml = escapeHtml
}
