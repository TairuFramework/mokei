import { ContextServer, type ServerConfig } from '@mokei/context-server'
import { expect } from 'vitest'

import type { OAuthTokenVerifier } from '../src/auth/verifier.js'
import { serveHTTP } from '../src/serve.js'

export const RESOURCE = 'http://127.0.0.1/mcp'
export const RESOURCE_METADATA_URL = 'http://127.0.0.1/.well-known/oauth-protected-resource/mcp'

const SERVER_CONFIG: ServerConfig = {
  name: 'auth-integration-test',
  version: '1.0.0',
  protocolVersions: ['2026-07-28'],
  tools: {
    echo: {
      description: 'Echo',
      inputSchema: { type: 'object' },
      handler: async () => ({ content: [] }),
    },
  },
}

export async function startGatedMCP(
  verifier: OAuthTokenVerifier,
  authorizationServer: string,
): Promise<{ server: ReturnType<typeof serveHTTP>; baseURL: string }> {
  const server = serveHTTP({
    createServer: ({ transport }) => new ContextServer({ ...SERVER_CONFIG, transport }),
    port: 0,
    hostname: '127.0.0.1',
    auth: {
      verifier,
      resource: RESOURCE,
      resourceMetadataURL: RESOURCE_METADATA_URL,
      authorizationServers: [authorizationServer],
      requiredScopes: ['read', 'write'],
    },
  })

  try {
    const address = server.server.address()
    const port =
      address && typeof address !== 'string'
        ? address.port
        : await new Promise<number>((resolve, reject) => {
            server.server.once('error', reject)
            server.server.once('listening', () => {
              server.server.off('error', reject)
              const listening = server.server.address()
              resolve((listening as { port: number }).port)
            })
          })
    return { server, baseURL: `http://127.0.0.1:${port}` }
  } catch (error) {
    await server.dispose()
    throw error
  }
}

export function requestToolsList(baseURL: string, token?: string): Promise<Response> {
  return fetch(`${baseURL}/mcp`, {
    method: 'POST',
    signal: AbortSignal.timeout(3_000),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2026-07-28',
      ...(token == null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'auth-test', version: '1.0.0' },
        },
      },
    }),
  })
}

export async function expectToolsList(response: Response): Promise<void> {
  expect(response.status).toBe(200)
  const events = (await response.text())
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line.slice(6).trim() !== '')
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
  expect(events).toHaveLength(1)
  expect(events[0]?.error).toBeUndefined()
  expect(events[0]?.result).toEqual(
    expect.objectContaining({
      resultType: 'complete',
      tools: [expect.objectContaining({ name: 'echo' })],
    }),
  )
}

export function expectBearerChallenge(response: Response, status: 401 | 403, error?: string): void {
  expect(response.status).toBe(status)
  const challenge = response.headers.get('WWW-Authenticate')
  expect(challenge).toMatch(/^Bearer /)
  expect(challenge).toContain(`resource_metadata="${RESOURCE_METADATA_URL}"`)
  if (error != null) expect(challenge).toContain(`error="${error}"`)
}

export function corruptSignature(token: string): string {
  const [header, payload, signature, extra] = token.split('.')
  if (header == null || payload == null || signature == null || extra != null) {
    throw new Error('expected a three-part signed token')
  }
  return `${header}.${payload}.${signature.at(0) === 'A' ? 'B' : 'A'}${signature.slice(1)}`
}
