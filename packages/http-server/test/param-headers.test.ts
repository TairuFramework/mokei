import { ContextServer, type ToolDefinitions } from '@mokei/context-server'
import { createHTTPClient } from '@mokei/http-client'
import { afterEach, describe, expect, test } from 'vitest'

import { createHTTPHandler, type HTTPHandler } from '../src/handler.js'
import { validateParamHeaders } from '../src/headers.js'
import { serveHTTP } from '../src/serve.js'
import { statelessHeaders } from './mcp-headers.js'

const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'param-test', version: '1.0.0' },
}

function deployTool(header: string, calls: Array<unknown>): ToolDefinitions {
  return {
    deploy: {
      description: 'Deploy to a region',
      inputSchema: {
        type: 'object',
        properties: {
          region: { type: 'string', 'x-mcp-header': header },
          replicas: { type: 'integer', 'x-mcp-header': 'Replicas' },
          note: { type: 'string' },
        },
      },
      handler: async ({ input }) => {
        calls.push(input)
        return { content: [] }
      },
    },
  }
}

let handler: HTTPHandler | undefined
let served: Awaited<ReturnType<typeof serveHTTP>> | undefined

afterEach(async () => {
  await handler?.dispose()
  handler = undefined
  await served?.dispose()
  served = undefined
})

function start(calls: Array<unknown>): HTTPHandler {
  handler = createHTTPHandler({
    createServer: ({ transport }) =>
      new ContextServer({
        name: 'params',
        version: '1.0.0',
        protocolVersions: ['2026-07-28'],
        transport,
        tools: deployTool('Region', calls),
      }),
  })
  return handler
}

function call(args: Record<string, unknown>, headers: Record<string, string>): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...statelessHeaders('tools/call', { name: 'deploy' }),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'deploy', arguments: args, _meta: META },
    }),
  })
}

async function expectParamMismatch(response: Response, header: string, detail: string) {
  expect(response.status).toBe(400)
  const body = (await response.json()) as {
    id: unknown
    error: { code: number; data: { mismatch: { header: string; body: string } } }
  }
  expect(body.id).toBe(5)
  expect(body.error.code).toBe(-32020)
  expect(body.error.data.mismatch.header).toBe(header)
  expect(body.error.data.mismatch.body).toContain(detail)
}

describe('Mcp-Param-* headers on 2026-07-28 tools/call', () => {
  test('matching headers are served', async () => {
    const calls: Array<unknown> = []
    const response = await start(calls).handleRequest(
      call(
        { region: 'eu-west-1', replicas: 3 },
        { 'Mcp-Param-Region': 'eu-west-1', 'mcp-param-replicas': '3' },
      ),
    )
    expect(response.status).toBe(200)
    await response.text()
    expect(calls).toEqual([{ region: 'eu-west-1', replicas: 3 }])
  })

  test('absent and null arguments need no header; a stray header is ignored', async () => {
    const calls: Array<unknown> = []
    const response = await start(calls).handleRequest(
      call({ region: null, note: 'x' }, { 'Mcp-Param-Replicas': '9' }),
    )
    expect(response.status).toBe(200)
    await response.text()
    expect(calls).toHaveLength(1)
  })

  test('Base64-wrapped values are decoded and numbers compare numerically', async () => {
    const calls: Array<unknown> = []
    const wrapped = `=?base64?${Buffer.from('région').toString('base64')}?=`
    const response = await start(calls).handleRequest(
      call(
        { region: 'région', replicas: 3 },
        { 'Mcp-Param-Region': wrapped, 'Mcp-Param-Replicas': '3.0' },
      ),
    )
    expect(response.status).toBe(200)
    await response.text()
    expect(calls).toHaveLength(1)
  })

  test.each([
    ['missing', {}, 'absent'],
    ['different', { 'Mcp-Param-Region': 'us-east-1' }, 'decodes to "us-east-1"'],
    ['badly encoded', { 'Mcp-Param-Region': '=?base64?%%%?=' }, 'invalid Base64'],
  ])('a %s header is rejected before the tool runs', async (_label, headers, detail) => {
    const calls: Array<unknown> = []
    const response = await start(calls).handleRequest(
      call({ region: 'eu-west-1' }, headers as Record<string, string>),
    )
    await expectParamMismatch(response, 'Mcp-Param-Region', detail)
    expect(calls).toEqual([])
  })

  test('a numeric header that differs from the body is rejected', async () => {
    const calls: Array<unknown> = []
    const response = await start(calls).handleRequest(
      call({ replicas: 3 }, { 'Mcp-Param-Replicas': '4' }),
    )
    await expectParamMismatch(response, 'Mcp-Param-Replicas', 'replicas=3')
    expect(calls).toEqual([])
  })
})

describe('validateParamHeaders', () => {
  const request = (headers: Record<string, string> = {}) =>
    new Request('http://localhost/mcp', { method: 'POST', headers })
  const body = (name: string, args: unknown) => ({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  })

  test('skips unknown tools and tools whose annotations are invalid', () => {
    const invalid = {
      type: 'object',
      properties: { list: { type: 'array', items: { type: 'string', 'x-mcp-header': 'L' } } },
    }
    const server = {
      toolInputSchema: (name: string) => (name === 'bad' ? invalid : undefined),
    }
    expect(
      validateParamHeaders({ request: request(), body: body('nope', { a: 1 }), server }),
    ).toBeNull()
    expect(
      validateParamHeaders({ request: request(), body: body('bad', { list: ['x'] }), server }),
    ).toBeNull()
  })

  test('checks only tools/call requests', () => {
    const server = { toolInputSchema: () => ({ type: 'object' }) }
    const notification = { jsonrpc: '2.0', method: 'tools/call', params: { name: 'x' } }
    expect(validateParamHeaders({ request: request(), body: notification, server })).toBeNull()
  })
})

test('the client recovers when the server renames a header after tools/list', async () => {
  // The server's schema moves under the client: its cached annotation names `Region`, the
  // server now expects `Zone`. The `-32020` naming `Mcp-Param-Zone` makes the client refresh
  // `tools/list` and re-send once, so the caller sees an ordinary result.
  const calls: Array<unknown> = []
  let header = 'Region'
  served = await serveHTTP({
    createServer: ({ transport }) =>
      new ContextServer({
        name: 'params',
        version: '1.0.0',
        protocolVersions: ['2026-07-28'],
        transport,
        tools: deployTool(header, calls),
      }),
    port: 0,
    hostname: '127.0.0.1',
  })
  const client = createHTTPClient({
    url: `${served.server.url}/mcp`,
    protocolVersion: '2026-07-28',
  })
  try {
    await client.listTools()
    header = 'Zone'
    const result = await client.callTool({ name: 'deploy', arguments: { region: 'eu-west-1' } })
    expect(result.isError).not.toBe(true)
    expect(calls).toEqual([{ region: 'eu-west-1' }])
  } finally {
    await client.dispose()
  }
})
