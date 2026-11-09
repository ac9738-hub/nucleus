'use strict'

const path = require('path')
const { fileURLToPath } = require('url')

function isPathInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function isTrustedEngineSurfaceUrl(value, appRoot) {
  if (!value) return false

  let url
  try {
    url = new URL(String(value))
  } catch (_error) {
    return false
  }

  if (url.protocol !== 'file:') return false

  let filePath
  try {
    filePath = path.resolve(fileURLToPath(url))
  } catch (_error) {
    return false
  }

  const root = path.resolve(appRoot || path.join(__dirname, '..'))
  const enginePath = path.join(root, 'engine.html')
  const searchCachePath = path.join(root, 'engine-search-cache')

  return filePath === enginePath || isPathInside(searchCachePath, filePath)
}

module.exports = {
  isTrustedEngineSurfaceUrl
}
