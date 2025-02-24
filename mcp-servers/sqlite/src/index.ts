import { DatabaseSync } from 'node:sqlite'
import { parseArgs } from 'node:util'
import { type Schema, createTool, serve } from '@mokei/context-server'

const args = parseArgs({
  options: {
    db: { type: 'string' },
  },
})

const db = new DatabaseSync(args.values.db ?? ':memory:')

const toolInputSchema = {
  type: 'object',
  properties: {
    sql: { type: 'string', description: 'A SQL string to compile to a prepared statement' },
    parameters: {
      type: 'object',
      additionalProperties: {
        anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
      },
      description: 'An object of parameter values',
    },
  },
  required: ['sql'],
  additionalProperties: false,
} as const satisfies Schema

serve({
  name: 'sqlite',
  version: '0.1.0',
  tools: {
    sqlite_all: createTool(
      'This method executes a prepared statement and returns all results as an array of objects',
      toolInputSchema,
      (req) => {
        const results = db.prepare(req.input.sql).all(req.input.parameters ?? {})
        return { content: [{ type: 'text', text: JSON.stringify(results) }], isError: false }
      },
    ),
    sqlite_get: createTool(
      'This method executes a prepared statement and returns the first result as an object',
      toolInputSchema,
      (req) => {
        const result = db.prepare(req.input.sql).get(req.input.parameters ?? {})
        return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }
      },
    ),
    sqlite_run: createTool(
      'This method executes a prepared statement and returns an object summarizing the resulting changes',
      toolInputSchema,
      (req) => {
        const changes = db.prepare(req.input.sql).run(req.input.parameters ?? {})
        return { content: [{ type: 'text', text: JSON.stringify(changes) }], isError: false }
      },
    ),
  },
})
