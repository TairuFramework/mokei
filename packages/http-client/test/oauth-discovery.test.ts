import { describe, expect, test } from 'vitest'

import {
  authServerMetadataURLs,
  discover,
  fetchAuthServerMetadata,
  parseResourceMetadataURL,
  protectedResourceMetadataURLs,
} from '../src/oauth/discovery.js'

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
  expect(parseResourceMetadataURL(header)).toBe(
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
  const { prm, as } = await discover({ resource, fetch, grant: 'authorization_code' })
  expect(prm.resource).toBe(resource)
  expect(as.issuer).toBe('https://as.example.com')
})

test('rejects PRM whose resource does not match', async () => {
  const fetch = async (): Promise<Response> =>
    json({ resource: 'https://evil.test', authorization_servers: ['https://as.example.com'] })
  await expect(
    discover({
      resource,
      resourceMetadataURL: 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp',
      fetch,
      grant: 'authorization_code',
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
      resourceMetadataURL: 'http://localhost:9200/x',
      fetch,
      grant: 'authorization_code',
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
  const { prm, as } = await discover({
    resource: loopbackResource,
    fetch,
    grant: 'authorization_code',
  })
  expect(prm.resource).toBe(loopbackResource)
  expect(as.issuer).toBe('http://localhost:4000')
})

test('PRM and AS metadata fetches are made with redirect: "error" (SSRF/redirect guard)', async () => {
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
  await discover({ resource, fetch, grant: 'authorization_code' })
  expect(inits.length).toBe(2)
  for (const init of inits) {
    expect(init?.redirect).toBe('error')
  }
})

test('an oversized metadata response is rejected before being fully buffered', async () => {
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
  await expect(discover({ resource, fetch, grant: 'authorization_code' })).rejects.toThrow(
    /exceed/i,
  )
  // every OAuth subrequest carries a signal (the fetch's own deadline at minimum, combined
  // with a caller signal when one is given), so a hung metadata endpoint can't stall discovery
  // forever.
  expect(inits.length).toBeGreaterThan(0)
  for (const init of inits) {
    expect(init?.signal).toBeTruthy()
  }
})

test('an already-aborted signal is passed through to the metadata fetch and observed there', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    // A real fetch would itself reject on an aborted signal; simulate that here since the
    // injected `fetch` in these tests never actually touches the network.
    if (init?.signal?.aborted) throw init.signal.reason
    throw new Error(`unexpected fetch of ${url}`)
  }
  await expect(
    discover({ resource, fetch, grant: 'authorization_code', signal: controller.signal }),
  ).rejects.toThrow(/cancelled/)
})

test('RFC 8414 discovery inserts the well-known segment before a path-bearing issuer', async () => {
  const pathIssuer = 'https://as.example/tenant1'
  let fetchedAsURL: string | undefined
  const fetch = async (url: string): Promise<Response> => {
    if (url.includes('oauth-protected-resource')) {
      return json({ resource, authorization_servers: [pathIssuer] })
    }
    fetchedAsURL = url
    return json({
      issuer: pathIssuer,
      authorization_endpoint: `${pathIssuer}/authorize`,
      token_endpoint: `${pathIssuer}/token`,
      code_challenge_methods_supported: ['S256'],
    })
  }
  await discover({ resource, fetch, grant: 'authorization_code' })
  expect(fetchedAsURL).toBe('https://as.example/.well-known/oauth-authorization-server/tenant1')
})

// --- MCP discovery order, grant checks, issuer pin ---

const asBase = 'https://as.example.com'

function status(code: number): Response {
  return new Response('nope', { status: code })
}

/** Fake fetch answering from a URL -> Response map (404 otherwise); records every URL fetched. */
function route(routes: Record<string, () => Response>): {
  fetch: (url: string) => Promise<Response>
  urls: Array<string>
} {
  const urls: Array<string> = []
  return {
    urls,
    fetch: async (url: string) => {
      urls.push(url)
      const handler = routes[url]
      return handler == null ? status(404) : handler()
    },
  }
}

const prmRoot = 'https://mcp.example.com/.well-known/oauth-protected-resource'
const prmPath = `${prmRoot}/mcp`
const asOAuth = `${asBase}/.well-known/oauth-authorization-server`
const asOIDC = `${asBase}/.well-known/openid-configuration`

function asDoc(extra: Record<string, unknown> = {}, issuer = asBase): Response {
  return json({
    issuer,
    authorization_endpoint: `${asBase}/authorize`,
    token_endpoint: `${asBase}/token`,
    code_challenge_methods_supported: ['S256'],
    ...extra,
  })
}

const prmDoc =
  (servers: Array<string> = [asBase]) =>
  () =>
    json({ resource, authorization_servers: servers })

const code = 'authorization_code' as const

test('candidate URL orders', () => {
  expect(protectedResourceMetadataURLs('https://mcp.example.com/mcp')).toEqual([prmPath, prmRoot])
  expect(protectedResourceMetadataURLs('https://mcp.example.com/')).toEqual([prmRoot])
  expect(authServerMetadataURLs('https://as.example.com/p')).toEqual([
    `${asOAuth}/p`,
    `${asOIDC}/p`,
    'https://as.example.com/p/.well-known/openid-configuration',
  ])
  expect(authServerMetadataURLs(asBase)).toEqual([asOAuth, asOIDC])
})

describe('fallbacks', () => {
  test('PRM path-specific 404 falls back to root', async () => {
    const r = route({ [prmRoot]: prmDoc(), [asOAuth]: () => asDoc() })
    await discover({ resource, fetch: r.fetch, grant: code })
    expect(r.urls).toEqual([prmPath, prmRoot, asOAuth])
  })

  test('challenge URL is the only PRM candidate', async () => {
    const challenge = 'https://mcp.example.com/custom-prm'
    const r = route({ [prmRoot]: prmDoc() })
    await expect(
      discover({ resource, resourceMetadataURL: challenge, fetch: r.fetch, grant: code }),
    ).rejects.toMatchObject({ status: 404 })
    expect(r.urls).toEqual([challenge])
  })

  test('AS: OAuth 404 uses OIDC path insertion', async () => {
    const issuer = `${asBase}/p`
    const r = route({
      [prmPath]: prmDoc([issuer]),
      [`${asOIDC}/p`]: () => asDoc({}, issuer),
    })
    const { as } = await discover({ resource, fetch: r.fetch, grant: code })
    expect(as.issuer).toBe(issuer)
    expect(r.urls).toEqual([prmPath, `${asOAuth}/p`, `${asOIDC}/p`])
  })

  test('AS: both 404 uses OIDC path appending', async () => {
    const issuer = `${asBase}/p`
    const r = route({
      [prmPath]: prmDoc([issuer]),
      [`${issuer}/.well-known/openid-configuration`]: () => asDoc({}, issuer),
    })
    await discover({ resource, fetch: r.fetch, grant: code })
    expect(r.urls).toEqual([
      prmPath,
      `${asOAuth}/p`,
      `${asOIDC}/p`,
      `${issuer}/.well-known/openid-configuration`,
    ])
  })

  test('AS root issuer: OAuth then OIDC', async () => {
    const r = route({ [prmPath]: prmDoc(), [asOIDC]: () => asDoc() })
    await discover({ resource, fetch: r.fetch, grant: code })
    expect(r.urls).toEqual([prmPath, asOAuth, asOIDC])
  })

  test('405 and 410 also advance', async () => {
    const r = route({
      [prmPath]: () => status(405),
      [prmRoot]: prmDoc(),
      [asOAuth]: () => status(410),
      [asOIDC]: () => asDoc(),
    })
    await discover({ resource, fetch: r.fetch, grant: code })
    expect(r.urls).toEqual([prmPath, prmRoot, asOAuth, asOIDC])
  })

  test('all candidates missing rejects', async () => {
    const r = route({})
    await expect(discover({ resource, fetch: r.fetch, grant: code })).rejects.toMatchObject({
      status: 404,
    })
    expect(r.urls).toEqual([prmPath, prmRoot])
  })

  test('a server answering today URLs resolves with exactly two fetches', async () => {
    const r = route({ [prmPath]: prmDoc(), [asOAuth]: () => asDoc() })
    const { as } = await discover({ resource, fetch: r.fetch, grant: code })
    expect(as.token_endpoint).toBe(`${asBase}/token`)
    expect(r.urls).toEqual([prmPath, asOAuth])
  })
})

describe('terminal failures do not fetch further candidates', () => {
  test('PRM 500', async () => {
    const r = route({ [prmPath]: () => status(500), [prmRoot]: prmDoc() })
    await expect(discover({ resource, fetch: r.fetch, grant: code })).rejects.toMatchObject({
      status: 500,
    })
    expect(r.urls).toEqual([prmPath])
  })

  test('PRM unparsable body', async () => {
    const r = route({
      [prmPath]: () => new Response('not json', { status: 200 }),
      [prmRoot]: prmDoc(),
    })
    await expect(discover({ resource, fetch: r.fetch, grant: code })).rejects.toThrow(
      /not valid JSON/,
    )
    expect(r.urls).toEqual([prmPath])
  })

  test('PRM oversized body', async () => {
    const big = () => new Response(JSON.stringify({ pad: 'x'.repeat(2_000_000) }), { status: 200 })
    const r = route({ [prmPath]: big, [prmRoot]: prmDoc() })
    await expect(discover({ resource, fetch: r.fetch, grant: code })).rejects.toThrow(/exceed/i)
    expect(r.urls).toEqual([prmPath])
  })

  test('aborted signal', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    const urls: Array<string> = []
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      urls.push(url)
      if (init?.signal?.aborted) throw init.signal.reason
      return status(404)
    }
    await expect(
      discover({ resource, fetch, grant: code, signal: controller.signal }),
    ).rejects.toThrow(/cancelled/)
    expect(urls.length).toBe(1)
  })

  test('PRM resource mismatch', async () => {
    const r = route({
      [prmPath]: () => json({ resource: 'https://evil.test', authorization_servers: [asBase] }),
      [prmRoot]: prmDoc(),
    })
    await expect(discover({ resource, fetch: r.fetch, grant: code })).rejects.toThrow(/resource/i)
    expect(r.urls).toEqual([prmPath])
  })

  test('AS issuer mismatch', async () => {
    const r = route({
      [prmPath]: prmDoc(),
      [asOAuth]: () => asDoc({}, 'https://other.example.com'),
      [asOIDC]: () => asDoc(),
    })
    await expect(discover({ resource, fetch: r.fetch, grant: code })).rejects.toThrow(/issuer/i)
    expect(r.urls).toEqual([prmPath, asOAuth])
  })

  test('AS 500', async () => {
    const r = route({ [prmPath]: prmDoc(), [asOAuth]: () => status(500), [asOIDC]: () => asDoc() })
    await expect(discover({ resource, fetch: r.fetch, grant: code })).rejects.toMatchObject({
      status: 500,
    })
    expect(r.urls).toEqual([prmPath, asOAuth])
  })
})

describe('expectedIssuer', () => {
  test('absent from authorization_servers rejects before any AS fetch', async () => {
    const r = route({ [prmPath]: prmDoc([asBase]) })
    const pin = 'https://pinned.example.com'
    const error = await discover({
      resource,
      fetch: r.fetch,
      grant: 'client_credentials',
      expectedIssuer: pin,
    }).catch((e: Error) => e)
    expect((error as Error).message).toContain(pin)
    expect((error as Error).message).toContain(asBase)
    expect(r.urls).toEqual([prmPath])
  })

  test('selects the pinned server and ignores selectAuthServer', async () => {
    const other = 'https://other.example.com'
    const r = route({ [prmPath]: prmDoc([other, asBase]), [asOAuth]: () => asDoc() })
    const { as } = await discover({
      resource,
      fetch: r.fetch,
      grant: 'client_credentials',
      expectedIssuer: asBase,
      selectAuthServer: (s) => s[0] as string,
    })
    expect(as.issuer).toBe(asBase)
  })

  test('trailing-slash pin vs slashless metadata issuer rejects, naming both', async () => {
    const pin = `${asBase}/`
    const r = route({ [prmPath]: prmDoc([pin]), [asOAuth]: () => asDoc() })
    const error = await discover({
      resource,
      fetch: r.fetch,
      grant: 'client_credentials',
      expectedIssuer: pin,
    }).catch((e: Error) => e)
    expect((error as Error).message).toBe(`AS issuer ${asBase} != ${pin}`)
    expect(r.urls).toEqual([prmPath, asOAuth])
  })
})

describe('grant checks', () => {
  const noAuthz = () =>
    json({
      issuer: asBase,
      token_endpoint: `${asBase}/token`,
      code_challenge_methods_supported: ['plain'],
    })

  test('client_credentials accepts no authorization_endpoint and plain-only PKCE', async () => {
    const as = await fetchAuthServerMetadata({
      issuer: asBase,
      fetch: route({ [asOAuth]: noAuthz }).fetch,
      grant: 'client_credentials',
    })
    expect(as.token_endpoint).toBe(`${asBase}/token`)
  })

  test('authorization_code rejects missing authorization_endpoint', async () => {
    await expect(
      fetchAuthServerMetadata({
        issuer: asBase,
        fetch: route({
          [asOAuth]: () => json({ issuer: asBase, token_endpoint: `${asBase}/token` }),
        }).fetch,
        grant: code,
      }),
    ).rejects.toThrow(/authorization_endpoint/)
  })

  test('authorization_code rejects plain-only PKCE', async () => {
    await expect(
      fetchAuthServerMetadata({
        issuer: asBase,
        fetch: route({ [asOAuth]: () => asDoc({ code_challenge_methods_supported: ['plain'] }) })
          .fetch,
        grant: code,
      }),
    ).rejects.toThrow(/S256/)
  })

  test('client_credentials rejects insecure token_endpoint and revocation_endpoint', async () => {
    for (const extra of [
      { token_endpoint: 'http://as.example.com/token' },
      { revocation_endpoint: 'http://as.example.com/revoke' },
    ]) {
      await expect(
        fetchAuthServerMetadata({
          issuer: asBase,
          fetch: route({ [asOAuth]: () => asDoc(extra) }).fetch,
          grant: 'client_credentials',
        }),
      ).rejects.toThrow(/https/)
    }
  })
})
