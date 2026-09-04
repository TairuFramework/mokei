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

test('rejects a loopback-http resource_metadata challenge when the resource itself is https (SSRF guard)', async () => {
  const fetch = async (url: string): Promise<Response> => {
    throw new Error(`should not fetch ${url}`)
  }
  await expect(
    discover({
      resource,
      resourceMetadataUrl: 'http://localhost:9200/x',
      fetch,
    }),
  ).rejects.toThrow(/https/i)
})

test('allows loopback-http metadata when the protected resource itself is loopback', async () => {
  const loopbackResource = 'http://localhost:3000/mcp'
  const fetch = async (url: string): Promise<Response> => {
    if (url.includes('oauth-protected-resource')) {
      return json({
        resource: loopbackResource,
        authorization_servers: ['http://localhost:4000'],
      })
    }
    if (url === 'http://localhost:4000/.well-known/oauth-authorization-server') {
      return json({
        issuer: 'http://localhost:4000',
        authorization_endpoint: 'http://localhost:4000/authorize',
        token_endpoint: 'http://localhost:4000/token',
        code_challenge_methods_supported: ['S256'],
      })
    }
    throw new Error(`unexpected ${url}`)
  }
  const { prm, as } = await discover({ resource: loopbackResource, fetch })
  expect(prm.resource).toBe(loopbackResource)
  expect(as.issuer).toBe('http://localhost:4000')
})

test('H5: PRM and AS metadata fetches are made with redirect: "error" (SSRF/redirect guard)', async () => {
  const inits: Array<RequestInit | undefined> = []
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    inits.push(init)
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
  await discover({ resource, fetch })
  expect(inits.length).toBe(2)
  for (const init of inits) {
    expect(init?.redirect).toBe('error')
  }
})

test('J3: an oversized metadata response is rejected before being fully buffered', async () => {
  const inits: Array<RequestInit | undefined> = []
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    inits.push(init)
    if (url.includes('oauth-protected-resource')) {
      // No `Content-Length` header: forces the streamed-byte-count path (rather than the
      // content-length fast path) to be what catches the oversized body.
      return new Response(JSON.stringify({ resource, padding: 'x'.repeat(2_000_000) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`unexpected ${url}`)
  }
  await expect(discover({ resource, fetch })).rejects.toThrow(/exceeds/i)
  // J1: every OAuth subrequest carries a signal (the fetch's own deadline at minimum, combined
  // with a caller signal when one is given), so a hung metadata endpoint can't stall discovery
  // forever.
  expect(inits.length).toBeGreaterThan(0)
  for (const init of inits) {
    expect(init?.signal).toBeTruthy()
  }
})

test('J1: an already-aborted signal is passed through to the metadata fetch and observed there', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    // A real fetch would itself reject on an aborted signal; simulate that here since the
    // injected `fetch` in these tests never actually touches the network.
    if (init?.signal?.aborted) throw init.signal.reason
    throw new Error(`unexpected fetch of ${url}`)
  }
  await expect(discover({ resource, fetch, signal: controller.signal })).rejects.toThrow(
    /cancelled/,
  )
})

test('RFC 8414 discovery inserts the well-known segment before a path-bearing issuer', async () => {
  const pathIssuer = 'https://as.example/tenant1'
  let fetchedAsUrl: string | undefined
  const fetch = async (url: string): Promise<Response> => {
    if (url.includes('oauth-protected-resource')) {
      return json({ resource, authorization_servers: [pathIssuer] })
    }
    fetchedAsUrl = url
    return json({
      issuer: pathIssuer,
      authorization_endpoint: `${pathIssuer}/authorize`,
      token_endpoint: `${pathIssuer}/token`,
      code_challenge_methods_supported: ['S256'],
    })
  }
  await discover({ resource, fetch })
  expect(fetchedAsUrl).toBe('https://as.example/.well-known/oauth-authorization-server/tenant1')
})
