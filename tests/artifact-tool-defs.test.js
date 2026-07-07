const test = require('node:test')
const assert = require('node:assert/strict')
const {
  ARTIFACT_TOOL_NAMES,
  ARTIFACT_TOOLS,
  SYNAPSE_ARTIFACT_SYSTEM_SUFFIX
} = require('../lib/artifact-tool-defs')

test('artifact tool defs include core artifact actions', () => {
  assert.ok(ARTIFACT_TOOL_NAMES.has('create_artifact'))
  assert.ok(ARTIFACT_TOOL_NAMES.has('open_artifact'))
  assert.equal(ARTIFACT_TOOLS.length, 5)
  const createTool = ARTIFACT_TOOLS.find(item => item.name === 'create_artifact')
  assert.ok(createTool)
  assert.deepEqual(createTool.input_schema.required, ['title', 'type', 'content'])
  assert.ok(createTool.input_schema.properties.type.enum.includes('flashcards'))
})

test('synapse artifact system suffix mentions create_artifact', () => {
  assert.match(SYNAPSE_ARTIFACT_SYSTEM_SUFFIX, /create_artifact/)
  assert.match(SYNAPSE_ARTIFACT_SYSTEM_SUFFIX, /flashcards/)
})
