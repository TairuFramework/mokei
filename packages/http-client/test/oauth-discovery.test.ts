import { expect, test } from 'vitest'

import { discover, parseResourceMetadataUrl } from '../src/oauth/discovery.js'

const resource = 'https://mcp.example.com/mcp'

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('parses resource_metadata from WWW-Authenticate', () => {
  const header =
    'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"'
  expect(parseResourceMetadataUrl(header)).toBe(
    'https://mcp.example.com/.well-known/oauth-protected-resource/mcp',
  )
})

test('discovers and validates PRM resource + AS issuer', async () => {
  const fetch = async (url: string): Promise<Response> => {
    if (url.includes('oauth-protected-resource')) {
      return json({ resource, authorization_servers: ['https://as.example.com'] })
    }
    if (url === 'https://as.example.com/.well-known/oauth-authorization-server') {
      return json({
        issuer: 'https://as.example.com',
        authorization_endpoint: 'https://as.example.com/authorize',
        token_endpoint: 'https://as.example.com/token',
        code_challenge_methods_supported: ['S256'],
      })
    }
    throw new Error(`unexpected ${url}`)
  }
  const { prm, as } = await discover({ resource, fetch })
  expect(prm.resource).toBe(resource)
  expect(as.issuer).toBe('https://as.example.com')
})

test('rejects PRM whose resource does not match', async () => {
  const fetch = async (): Promise<Response> =>
    json({ resource: 'https://evil.test', authorization_servers: ['https://as.example.com'] })
  await expect(
    discover({
      resource,
      resourceMetadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp',
      fetch,
    }),
  ).rejects.toThrow(/resource/i)
})
