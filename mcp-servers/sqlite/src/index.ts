import { DatabaseSync } from 'node:sqlite'
import { type Schema, serve } from '@mokei/context-server'

const db = new DatabaseSync(':memory:')

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
  specification: {
    tools: {
      sqlite_all: {
        description:
          'This method executes a prepared statement and returns all results as an array of objects',
        input: toolInputSchema,
      },
      sqlite_get: {
        description:
          'This method executes a prepared statement and returns the first result as an object',
        input: toolInputSchema,
      },
      sqlite_run: {
        description:
          'This method executes a prepared statement and returns an object summarizing the resulting changes',
        input: toolInputSchema,
      },
    },
  },
  tools: {
    sqlite_all: (ctx) => {
      const results = db.prepare(ctx.input.sql).all(ctx.input.parameters ?? {})
      return { content: [{ type: 'text', text: JSON.stringify(results) }], isError: false }
    },
    sqlite_get: (ctx) => {
      const result = db.prepare(ctx.input.sql).get(ctx.input.parameters ?? {})
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }
    },
    sqlite_run: (ctx) => {
      const changes = db.prepare(ctx.input.sql).run(ctx.input.parameters ?? {})
      return { content: [{ type: 'text', text: JSON.stringify(changes) }], isError: false }
    },
  },
})
