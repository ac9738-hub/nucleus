// Anthropic tool definitions for student artifacts (Synapse + shared docs).
// Functionality: JSON schemas for create/update/list/get/open artifact tools.
// Dependencies: consumed by app/synapse/client.js.

const ARTIFACT_TOOL_NAMES = new Set([
  'create_artifact',
  'update_artifact',
  'list_artifacts',
  'get_artifact',
  'open_artifact'
])

const ARTIFACT_TOOLS = [
  {
    name: 'create_artifact',
    description:
      'Create a student-specific artifact the user can preview, edit, and download. ' +
      'Supported types: docx, pptx, latex, chart, graph, table, html, flashcards. ' +
      'Use flashcards for term/definition study decks grounded in the Canvas graph or explicit card lists.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short artifact title shown in the artifact panel.' },
        type: {
          type: 'string',
          enum: ['docx', 'pptx', 'latex', 'chart', 'graph', 'table', 'html', 'flashcards'],
          description: 'Artifact format.'
        },
        workspace_id: { type: 'string', description: 'Optional workspace id.' },
        course_id: { type: 'string', description: 'Optional Canvas course id.' },
        description: { type: 'string', description: 'One-line summary.' },
        content: {
          type: 'object',
          description:
            'Type-specific payload. flashcards: {from_graph?, course_id?, node_types?, concept_ids?, max_cards?, cards:[{front,back,hint?,tags?,deck?}]}; ' +
            'table: {headers[], rows[][]}; chart: {chart_type, labels[], datasets[]}; ' +
            'html: {html, css?}; latex: {source}; graph: {nodes[], edges[]}.'
        }
      },
      required: ['title', 'type', 'content']
    }
  },
  {
    name: 'update_artifact',
    description: 'Update an existing student artifact by id. Rebuilds preview and download files.',
    input_schema: {
      type: 'object',
      properties: {
        artifact_id: { type: 'string', description: 'Artifact id from create_artifact or list_artifacts.' },
        title: { type: 'string' },
        description: { type: 'string' },
        content: { type: 'object', description: 'Replacement type-specific content.' }
      },
      required: ['artifact_id', 'content']
    }
  },
  {
    name: 'list_artifacts',
    description: 'List saved student artifacts, optionally filtered by workspace or course.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        course_id: { type: 'string' },
        type: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'get_artifact',
    description: 'Fetch metadata for one artifact by id.',
    input_schema: {
      type: 'object',
      properties: {
        artifact_id: { type: 'string' }
      },
      required: ['artifact_id']
    }
  },
  {
    name: 'open_artifact',
    description: 'Open an artifact in the workspace as a new tab and show preview in LUMI.',
    input_schema: {
      type: 'object',
      properties: {
        artifact_id: { type: 'string' }
      },
      required: ['artifact_id']
    }
  }
]

const SYNAPSE_ARTIFACT_SYSTEM_SUFFIX =
  'For deliverables the student should keep (study guides, slides, charts, tables, flashcards, LaTeX worksheets, formatted notes), ' +
  'use create_artifact or update_artifact instead of pasting long formatted output in chat. ' +
  'After creating an artifact, briefly tell the user what you made and that they can preview it or open it in a workspace tab.'

module.exports = {
  ARTIFACT_TOOL_NAMES,
  ARTIFACT_TOOLS,
  SYNAPSE_ARTIFACT_SYSTEM_SUFFIX
}
