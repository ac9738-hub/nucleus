const assert = require('assert')
const fs = require('fs')
const path = require('path')
const test = require('node:test')

const ROOT = path.join(__dirname, '..')

function collectSourceFiles(relativePath) {
  const fullPath = path.join(ROOT, relativePath)
  const stat = fs.statSync(fullPath)
  if (stat.isFile()) return [fullPath]

  const files = []
  for (const entry of fs.readdirSync(fullPath, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const child = path.join(relativePath, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(child))
    } else if (/\.(js|html)$/.test(entry.name)) {
      files.push(path.join(ROOT, child))
    }
  }
  return files
}

test('navigation debug ingest has no hardcoded localhost sink', () => {
  const files = [
    'main.js',
    'index.html',
    'preload.js',
    'web-preload.js',
    'app',
    'lib',
    'renderer'
  ].flatMap(collectSourceFiles)

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const label = path.relative(ROOT, file)

    assert(!source.includes('127.0.0.1:7283'), `${label} must not POST data to a hardcoded local listener`)
    assert(!source.includes('c1155abf-8302-4940-9722-19bb0cae0569'), `${label} must not ship a fixed debug ingest id`)
  }

  const mainSource = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8')
  assert(mainSource.includes('NUCLEUS_NAV_DEBUG_INGEST_URL'), 'main process debug ingest should require an explicit opt-in URL')
})
