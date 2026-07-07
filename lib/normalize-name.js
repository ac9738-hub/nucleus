/** Lowercase, trim, collapse whitespace — shared name comparison helper. */
function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

module.exports = { normalizeName }
