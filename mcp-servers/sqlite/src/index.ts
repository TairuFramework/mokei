import type { DatabaseSync } from 'node:sqlite'
import {
  createTool,
  type ExtractServerTypes,
  type Schema,
  type ServerConfig,
  type ToolDefinitions,
} from '@mokei/context-server'

/**
 * JSON Schema for SQLite tool inputs.
 */
export const toolInputSchema = {
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

/**
 * Create SQLite tool definitions bound to a specific database instance.
 *
 * @example
 * ```typescript
 * import { DatabaseSync } from 'node:sqlite'
 * import { createSQLiteTools } from '@mokei/mcp-sqlite'
 *
 * const db = new DatabaseSync(':memory:')
 * const tools = createSQLiteTools(db)
 * ```
 */
export function createSQLiteTools(db: DatabaseSync): ToolDefinitions {
  return {
    sqlite_all: createTool(
      'This method executes a prepared statement and returns all results as an array of objects',
      toolInputSchema,
      (req) => {
        const results = db.prepare(req.arguments.sql).all(req.arguments.parameters ?? {})
        return { content: [{ type: 'text', text: JSON.stringify(results) }], isError: false }
      },
    ),
    sqlite_get: createTool(
      'This method executes a prepared statement and returns the first result as an object',
      toolInputSchema,
      (req) => {
        const result = db.prepare(req.arguments.sql).get(req.arguments.parameters ?? {})
        return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }
      },
    ),
    sqlite_run: createTool(
      'This method executes a prepared statement and returns an object summarizing the resulting changes',
      toolInputSchema,
      (req) => {
        const changes = db.prepare(req.arguments.sql).run(req.arguments.parameters ?? {})
        return { content: [{ type: 'text', text: JSON.stringify(changes) }], isError: false }
      },
    ),
  }
}

/**
 * Create a server config for the SQLite MCP server.
 *
 * @example
 * ```typescript
 * import { DatabaseSync } from 'node:sqlite'
 * import { createSQLiteConfig } from '@mokei/mcp-sqlite'
 * import { ContextServer } from '@mokei/context-server'
 *
 * const db = new DatabaseSync(':memory:')
 * const config = createSqliteConfig(db)
 * const server = new ContextServer({ ...config, transport })
 * ```
 */
export function createSQLiteConfig(db: DatabaseSync): ServerConfig {
  return {
    name: 'sqlite',
    version: '0.1.0',
    tools: createSQLiteTools(db),
  }
}

/**
 * Type-safe context types for the SQLite MCP server.
 *
 * Use this type when creating a client to connect to this server:
 *
 * @example
 * ```typescript
 * import type { SQLiteServerTypes } from '@mokei/mcp-sqlite'
 * import { ContextClient } from '@mokei/context-client'
 *
 * const client = new ContextClient<SqliteServerTypes>({ transport })
 * await client.initialize()
 *
 * // Now tool calls are fully typed:
 * const result = await client.callTool({
 *   name: 'sqlite_all',
 *   arguments: { sql: 'SELECT * FROM users' }
 * })
 * ```
 */
export type SQLiteServerTypes = ExtractServerTypes<ReturnType<typeof createSQLiteConfig>>
