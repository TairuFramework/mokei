import { DatabaseSync } from 'node:sqlite'
import { DirectTransports } from '@enkaku/transport'
import { ContextClient } from '@mokei/context-client'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { ContextServer } from '@mokei/context-server'
import { describe, expect, test } from 'vitest'

import { createSQLiteConfig, type SQLiteServerTypes } from '../src/index.js'

describe('SQLite MCP server', () => {
  test('sqlite_run creates table', async () => {
    const db = new DatabaseSync(':memory:')
    const config = createSQLiteConfig(db)
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const server = new ContextServer({ ...config, transport: transports.server })

    const client = new ContextClient<SQLiteServerTypes>({ transport: transports.client })

    const result = await client.callTool({
      name: 'sqlite_run',
      arguments: {
        sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
      },
    })

    expect(result.isError).toBe(false)
    expect(result.content[0]).toMatchObject({ type: 'text' })

    await server.dispose()
  })

  test('sqlite_run inserts data and returns changes', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')

    const config = createSQLiteConfig(db)
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const server = new ContextServer({ ...config, transport: transports.server })

    const client = new ContextClient<SQLiteServerTypes>({ transport: transports.client })

    const result = await client.callTool({
      name: 'sqlite_run',
      arguments: {
        sql: 'INSERT INTO users (name) VALUES (:name)',
        parameters: { name: 'Alice' },
      },
    })

    expect(result.isError).toBe(false)
    const changes = JSON.parse((result.content[0] as { text: string }).text)
    expect(changes.changes).toBe(1)

    await server.dispose()
  })

  test('sqlite_get returns single row', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
    db.exec("INSERT INTO users (name) VALUES ('Alice'), ('Bob')")

    const config = createSQLiteConfig(db)
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const server = new ContextServer({ ...config, transport: transports.server })

    const client = new ContextClient<SQLiteServerTypes>({ transport: transports.client })

    const result = await client.callTool({
      name: 'sqlite_get',
      arguments: {
        sql: 'SELECT * FROM users WHERE name = :name',
        parameters: { name: 'Alice' },
      },
    })

    expect(result.isError).toBe(false)
    const row = JSON.parse((result.content[0] as { text: string }).text)
    expect(row).toMatchObject({ id: 1, name: 'Alice' })

    await server.dispose()
  })

  test('sqlite_all returns all rows', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
    db.exec("INSERT INTO users (name) VALUES ('Alice'), ('Bob'), ('Charlie')")

    const config = createSQLiteConfig(db)
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const server = new ContextServer({ ...config, transport: transports.server })

    const client = new ContextClient<SQLiteServerTypes>({ transport: transports.client })

    const result = await client.callTool({
      name: 'sqlite_all',
      arguments: { sql: 'SELECT * FROM users ORDER BY id' },
    })

    expect(result.isError).toBe(false)
    const rows = JSON.parse((result.content[0] as { text: string }).text)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ name: 'Alice' })
    expect(rows[1]).toMatchObject({ name: 'Bob' })
    expect(rows[2]).toMatchObject({ name: 'Charlie' })

    await server.dispose()
  })
})
