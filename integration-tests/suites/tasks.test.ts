import type { ContextClient } from '@mokei/context-client'
import {
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
  TASKS_EXTENSION,
} from '@mokei/context-protocol'
import { createHTTPClient } from '@mokei/http-client'
import { type OAuthTokenVerifier, TokenVerificationError } from '@mokei/http-server'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  MOKEI_STDIO_SERVER_TASKS_PATH,
  spawnMokeiStdioClient,
  spawnMokeiStdioSubscriptionClient,
  startMokeiTasksHTTPServer,
  type TasksHTTPServer,
} from '../support/interop/servers.ts'
import {
  TASK_CANCEL_TOOL,
  TASK_COMPLETE_TOOL,
  TASK_INPUT_TOOL,
  taskResult,
} from '../support/interop/tasks-fixture.ts'

const clients: Array<{ dispose: () => Promise<void> }> = []
const servers: Array<TasksHTTPServer> = []

afterEach(async () => {
  for (const client of clients.splice(0).reverse()) await client.dispose()
  for (const server of servers.splice(0).reverse()) await server.dispose()
})

async function stdio() {
  const spawned = await spawnMokeiStdioClient(MOKEI_STDIO_SERVER_TASKS_PATH, '2026-07-28')
  clients.push(spawned)
  return spawned.client
}

async function http() {
  const server = await startMokeiTasksHTTPServer()
  servers.push(server)
  const client = createHTTPClient({ url: server.url, protocolVersion: '2026-07-28' })
  clients.push(client)
  return { client, server }
}

async function taskID(client: ContextClient, name: string): Promise<string> {
  const result = await client.callTool({ name, arguments: {}, task: 'handle' })
  expect(result.resultType).toBe('task')
  if (result.resultType !== 'task' || typeof result.taskId !== 'string') {
    throw new Error('Expected task handle')
  }
  return result.taskId
}

describe('mokei tasks over stdio', () => {
  test('returns final task content by default and exposes a handle', async () => {
    const client = await stdio()
    expect((await client.callTool({ name: TASK_COMPLETE_TOOL, arguments: {} })).content).toEqual(
      taskResult('completed').content,
    )
    const id = await taskID(client, TASK_COMPLETE_TOOL)
    expect((await client.tasks.wait(id)).content).toEqual(taskResult('completed').content)
  })

  test('fulfils elicitation input inside a task', async () => {
    const spawned = await spawnMokeiStdioClient(MOKEI_STDIO_SERVER_TASKS_PATH, '2026-07-28', {
      elicit: ({ params }) => {
        expect(params.message).toBe('What is your name?')
        return { action: 'accept', content: { name: 'Ada' } }
      },
    })
    clients.push(spawned)
    expect(
      (await spawned.client.callTool({ name: TASK_INPUT_TOOL, arguments: {} })).content,
    ).toEqual(taskResult('hello: Ada').content)
  })

  test('cancels a task and receives a status notification on its listen', async () => {
    const spawned = await spawnMokeiStdioSubscriptionClient(MOKEI_STDIO_SERVER_TASKS_PATH)
    clients.push(spawned)
    const client = spawned.client
    const id = await taskID(client, TASK_CANCEL_TOOL)
    const statuses: Array<string> = []
    const waiting = client.tasks.wait(id, { onStatus: (status) => statuses.push(status.status) })
    waiting.catch(() => {})
    await vi.waitFor(() => expect(statuses).toContain('working'))
    await client.tasks.cancel(id)
    await expect(waiting).rejects.toThrow()
    expect((await client.tasks.get(id)).status).toBe('cancelled')
    expect(statuses).toContain('cancelled')
    expect(spawned.received).toContainEqual(
      expect.objectContaining({
        method: 'notifications/tasks',
        params: expect.objectContaining({ taskId: id, status: 'cancelled' }),
      }),
    )
  })
})

describe('mokei tasks over HTTP', () => {
  test('keeps a task after its creating POST server is disposed', async () => {
    const { client, server } = await http()
    const id = await taskID(client, TASK_COMPLETE_TOOL)
    await server.completionStarted
    await server.creatingPOSTDisposed
    expect((await client.tasks.get(id)).status).toBe('working')
    server.releaseCompletion()
    expect((await client.tasks.wait(id)).content).toEqual(taskResult('completed').content)
    expect((await client.tasks.get(id)).status).toBe('completed')
    expect((await client.callTool({ name: TASK_COMPLETE_TOOL, arguments: {} })).content).toEqual(
      taskResult('completed').content,
    )
  })

  test('returns final content after a task listen notification', async () => {
    const { client, server } = await http()
    const id = await taskID(client, TASK_COMPLETE_TOOL)
    const statuses: Array<string> = []
    const waiting = client.tasks.wait(id, { onStatus: (status) => statuses.push(status.status) })
    await vi.waitFor(() => expect(statuses).toContain('working'))
    server.releaseCompletion()
    expect((await waiting).content).toEqual(taskResult('completed').content)
    expect(statuses).toContain('completed')
  })

  test('fulfils elicitation input and cancels another task', async () => {
    const { server } = await http()
    const client = createHTTPClient({
      url: server.url,
      protocolVersion: '2026-07-28',
      elicit: () => ({ action: 'accept', content: { name: 'Ada' } }),
    })
    clients.push(client)
    expect((await client.callTool({ name: TASK_INPUT_TOOL, arguments: {} })).content).toEqual(
      taskResult('hello: Ada').content,
    )
    const id = await taskID(client, TASK_CANCEL_TOOL)
    await client.tasks.cancel(id)
    expect((await client.tasks.get(id)).status).toBe('cancelled')
  })
})

describe('bearer owned HTTP tasks', () => {
  const verifier: OAuthTokenVerifier = {
    async verifyAccessToken(token) {
      if (token !== 'alice' && token !== 'bob') {
        throw new TokenVerificationError({ code: 'invalid_token', message: 'Unknown token' })
      }
      return { issuer: 'https://issuer.example', subject: token, scopes: ['read'] }
    },
  }

  test('hides another subject’s task from get and omits it from listen acknowledgement', async () => {
    const server = await startMokeiTasksHTTPServer({
      verifier,
      resource: 'http://127.0.0.1/mcp',
      resourceMetadataURL: 'http://127.0.0.1/.well-known/oauth-protected-resource/mcp',
      authorizationServers: ['https://as.example'],
    })
    servers.push(server)
    const alice = createHTTPClient({
      url: server.url,
      protocolVersion: '2026-07-28',
      auth: { type: 'bearer', token: 'alice' },
    })
    const bob = createHTTPClient({
      url: server.url,
      protocolVersion: '2026-07-28',
      auth: { type: 'bearer', token: 'bob' },
    })
    clients.push(alice, bob)
    const id = await taskID(alice, TASK_COMPLETE_TOOL)
    expect((await alice.tasks.get(id)).taskId).toBe(id)
    await expect(bob.tasks.get(id)).rejects.toThrow('Task not found')

    const abort = new AbortController()
    const response = await fetch(server.url, {
      method: 'POST',
      signal: abort.signal,
      headers: {
        Authorization: 'Bearer bob',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'subscriptions/listen',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'subscriptions/listen',
        params: {
          notifications: { taskIds: [id] },
          _meta: {
            [META_PROTOCOL_VERSION]: '2026-07-28',
            [META_CLIENT_CAPABILITIES]: { extensions: { [TASKS_EXTENSION]: {} } },
          },
        },
      }),
    })
    expect(response.status).toBe(200)
    const reader = response.body?.getReader()
    if (reader == null) throw new Error('Expected listen stream')
    try {
      let stream = ''
      while (!stream.split('\n').some((line) => line.startsWith('data: {'))) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error('Listen closed before acknowledgement')
        stream += new TextDecoder().decode(chunk.value)
      }
      const data = stream.split('\n').find((line) => line.startsWith('data: {'))
      if (data == null) throw new Error('Missing acknowledgement')
      const frame = JSON.parse(data.slice(6)) as Record<string, unknown>
      expect(frame).toMatchObject({
        method: 'notifications/subscriptions/acknowledged',
        params: { notifications: { taskIds: [] } },
      })
    } finally {
      abort.abort()
      await reader.cancel().catch(() => {})
    }
  })
})
