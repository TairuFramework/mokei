import { ContextServer, createTool } from '@mokei/context-server'
import { afterEach, describe, expect, test } from 'vitest'

import { createHTTPHandler, type HTTPHandler } from '../src/handler.js'
import { decodeHeaderValue, validateStandardHeaders } from '../src/headers.js'

const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'headers-test', version: '1.0.0' },
}

/** A tool name a header cannot carry raw, so its Mcp-Name is Base64-wrapped. */
const CAFE = 'caf\u00e9'

let handler: HTTPHandler | undefined
const calls: Array<string> = []

afterEach(async () => {
  await handler?.dispose()
  handler = undefined
  calls.length = 0
})

function start(): HTTPHandler {
  handler = createHTTPHandler({
    createServer: ({ transport }) =>
      new ContextServer({
        name: 'headers',
        version: '1.0.0',
        protocolVersions: ['2025-11-25', '2026-07-28'],
        transport,
        tools: {
          [CAFE]: createTool({
            description: 'A name a header cannot carry raw',
            inputSchema: { type: 'object' } as const,
            handler: () => {
              calls.push('café')
              return { content: [] }
            },
          }),
          echo: createTool({
            description: 'Echo',
            inputSchema: { type: 'object' } as const,
            handler: () => {
              calls.push('echo')
              return { content: [] }
            },
          }),
        },
      }),
  })
  return handler
}

function post(body: Record<string, unknown>, headers: Record<string, string>): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function toolCall(name: string): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name, arguments: {}, _meta: META },
  }
}

const VERSION = { 'MCP-Protocol-Version': '2026-07-28' }

async function expectMismatch(response: Response, header: string, detail: string): Promise<void> {
  expect(response.status).toBe(400)
  const body = (await response.json()) as {
    id: unknown
    error: { code: number; message: string; data: { mismatch: { header: string; body: string } } }
  }
  expect(body.id).toBe(3)
  expect(body.error.code).toBe(-32020)
  expect(body.error.message).toMatch(/^Bad Request: the request headers and body disagree/)
  expect(body.error.data.mismatch.header).toBe(header)
  expect(body.error.data.mismatch.body).toContain(detail)
}

describe('SEP-2243 standard request headers on 2026-07-28', () => {
  test('a request whose headers agree with the body is served', async () => {
    const response = await start().handleRequest(
      post(toolCall('echo'), { ...VERSION, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'echo' }),
    )
    expect(response.status).toBe(200)
    await response.text()
    expect(calls).toEqual(['echo'])
  })

  test('a Base64-wrapped Mcp-Name is decoded before the comparison', async () => {
    const wrapped = `=?base64?${Buffer.from('café').toString('base64')}?=`
    const response = await start().handleRequest(
      post(toolCall('café'), { ...VERSION, 'Mcp-Method': 'tools/call', 'Mcp-Name': wrapped }),
    )
    expect(response.status).toBe(200)
    await response.text()
    expect(calls).toEqual(['café'])
  })

  test.each([
    ['MCP-Protocol-Version', { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'echo' }, 'absent'],
    ['Mcp-Method', { ...VERSION, 'Mcp-Name': 'echo' }, 'absent'],
    ['Mcp-Name', { ...VERSION, 'Mcp-Method': 'tools/call' }, 'absent'],
    [
      'Mcp-Method',
      { ...VERSION, 'Mcp-Method': 'tools/list', 'Mcp-Name': 'echo' },
      'Mcp-Method header names tools/list',
    ],
    [
      'Mcp-Name',
      { ...VERSION, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'other' },
      'Mcp-Name header names "other"',
    ],
    [
      'Mcp-Name',
      { ...VERSION, 'Mcp-Method': 'tools/call', 'Mcp-Name': '=?base64?not base64?=' },
      'invalid Base64',
    ],
  ])('rejects a request with a bad %s header (%#)', async (header, headers, detail) => {
    const response = await start().handleRequest(post(toolCall('echo'), headers))
    await expectMismatch(response, header, detail)
    expect(calls).toEqual([])
  })

  test('a method without an Mcp-Name source needs only Mcp-Method', async () => {
    const response = await start().handleRequest(
      post(
        { jsonrpc: '2.0', id: 3, method: 'tools/list', params: { _meta: META } },
        { ...VERSION, 'Mcp-Method': 'tools/list' },
      ),
    )
    expect(response.status).toBe(200)
    await response.text()
  })

  test('notifications are checked for disagreement, never for absence', async () => {
    const notification = {
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 9, _meta: META },
    }
    const server = start()
    expect((await server.handleRequest(post(notification, {}))).status).toBe(202)
    const mismatched = await server.handleRequest(
      post(notification, { 'Mcp-Method': 'notifications/progress' }),
    )
    expect(mismatched.status).toBe(400)
    const body = (await mismatched.json()) as { id: unknown; error: { code: number } }
    expect(body.id).toBeNull()
    expect(body.error.code).toBe(-32020)
  })

  test('2025-11-25 session traffic is not checked', async () => {
    const response = await start().handleRequest(
      post(
        {
          jsonrpc: '2.0',
          id: 0,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' },
          },
        },
        { 'Mcp-Method': 'something/else' },
      ),
    )
    expect(response.status).toBe(200)
    await response.text()
  })
})

describe('validateStandardHeaders', () => {
  test('passes tasks/get only with a matching Mcp-Name taskId', () => {
    const body = { jsonrpc: '2.0', id: 1, method: 'tasks/get', params: { taskId: 't1' } }
    const request = (name?: string) =>
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          ...VERSION,
          'Mcp-Method': 'tasks/get',
          ...(name == null ? {} : { 'Mcp-Name': name }),
        },
      })
    const check = (name?: string) =>
      validateStandardHeaders({ request: request(name), body, protocolVersion: '2026-07-28' })
    expect(check('t1')).toBeNull()
    expect(check('t2')?.status).toBe(400)
    expect(check()?.status).toBe(400)
  })

  test('a request whose body lacks the mirrored field needs no Mcp-Name', () => {
    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { ...VERSION, 'Mcp-Method': 'tools/call' },
    })
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }
    expect(validateStandardHeaders({ request, body, protocolVersion: '2026-07-28' })).toBeNull()
  })
})

describe('decodeHeaderValue', () => {
  test('passes plain values through and decodes the Base64 sentinel', () => {
    expect(decodeHeaderValue('echo')).toBe('echo')
    expect(decodeHeaderValue('=?base64?Y2Fmw6k=?=')).toBe('café')
    expect(decodeHeaderValue('=?base64??=')).toBe('')
  })

  test('rejects non-canonical Base64 and invalid UTF-8', () => {
    expect(decodeHeaderValue('=?base64?Y2Fmw6k?=')).toBeUndefined()
    expect(decodeHeaderValue('=?base64?not base64?=')).toBeUndefined()
    expect(decodeHeaderValue('=?base64?/w==?=')).toBeUndefined()
  })
})
