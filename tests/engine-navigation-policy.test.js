'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const { isTrustedEngineSurfaceUrl } = require('../lib/engine-navigation-policy')

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-engine-policy-'))
}

test('trusted engine surfaces are limited to the app engine file and search cache', () => {
  const root = tempRoot()
  const enginePath = path.join(root, 'engine.html')
  const searchDir = path.join(root, 'engine-search-cache')
  const searchPath = path.join(searchDir, 'tab-1.html')
  fs.mkdirSync(searchDir, { recursive: true })
  fs.writeFileSync(enginePath, '<!doctype html>')
  fs.writeFileSync(searchPath, '<!doctype html>')

  assert.equal(isTrustedEngineSurfaceUrl(pathToFileURL(enginePath).href, root), true)
  assert.equal(isTrustedEngineSurfaceUrl(pathToFileURL(searchPath).href + '?v=1', root), true)
})

test('external and sibling lookalike pages are not trusted engine senders', () => {
  const root = tempRoot()
  const siblingDir = path.join(path.dirname(root), path.basename(root) + '-other', 'engine-search-cache')
  const siblingPath = path.join(siblingDir, 'tab-1.html')
  const sameRootOtherPath = path.join(root, 'not-engine.html')
  fs.mkdirSync(siblingDir, { recursive: true })
  fs.writeFileSync(siblingPath, '<!doctype html>')
  fs.writeFileSync(sameRootOtherPath, '<!doctype html>')

  assert.equal(isTrustedEngineSurfaceUrl('https://evil.example/engine.html', root), false)
  assert.equal(isTrustedEngineSurfaceUrl('nucleus://search?q=test', root), false)
  assert.equal(isTrustedEngineSurfaceUrl(pathToFileURL(siblingPath).href, root), false)
  assert.equal(isTrustedEngineSurfaceUrl(pathToFileURL(sameRootOtherPath).href, root), false)
})
