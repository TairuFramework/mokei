import { fetchOAuthJSON } from '@kokuin/oauth'
import type { Runtime } from '@sozai/runtime'

import type { FetchLike } from '../transport.js'

export type ProtectedResourceMetadata = { resource: string; authorization_servers: Array<string> }
export type AuthServerMetadata = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  code_challenge_methods_supported?: Array<string>
  /** RFC 7009 token revocation endpoint, when the authorisation server has one. */
  revocation_endpoint?: string
}

export function parseResourceMetadataURL(header: string | null): string | null {
  if (!header) return null
  const match = /resource_metadata="([^"]+)"/.exec(header)
  return match?.[1] ?? null
}

export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  )
}

function requireHTTPS(url: string, allowLoopback: boolean): void {
  const u = new URL(url)
  if (u.protocol === 'https:') return
  if (allowLoopback && u.protocol === 'http:' && isLoopbackHost(u.hostname)) return
  throw new Error(`OAuth endpoint must be https: ${url}`)
}

/** GETs an OAuth metadata document through `fetch` (kokuin `fetchOAuthJSON`: bounded deadline,
 * size cap, `redirect: 'error'`). An empty body is an error, not a document. */
function fetchMetadata(fetch: FetchLike, url: string, signal?: AbortSignal): Promise<unknown> {
  return fetchOAuthJSON({
    runtime: { fetch: fetch as Runtime['fetch'] },
    url,
    method: 'GET',
    allowEmpty: false,
    signal,
  })
}

function wellKnownPRM(resource: string): string {
  const u = new URL(resource)
  const path = u.pathname === '/' ? '' : u.pathname
  return `${u.origin}/.well-known/oauth-protected-resource${path}`
}

function wellKnownAS(issuer: string): string {
  const u = new URL(issuer)
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')
  return `${u.origin}/.well-known/oauth-authorization-server${path}`
}

export async function discover(params: {
  resource: string
  resourceMetadataURL?: string
  fetch: FetchLike
  selectAuthServer?: (servers: Array<string>) => string
  /** Aborts both metadata fetches, in addition to their own bounded timeout. */
  signal?: AbortSignal
}): Promise<{ prm: ProtectedResourceMetadata; as: AuthServerMetadata }> {
  const allowLoopback = isLoopbackHost(new URL(params.resource).hostname)
  const prmURL = params.resourceMetadataURL ?? wellKnownPRM(params.resource)
  requireHTTPS(prmURL, allowLoopback)
  const prm = (await fetchMetadata(
    params.fetch,
    prmURL,
    params.signal,
  )) as ProtectedResourceMetadata
  if (prm.resource !== params.resource) {
    throw new Error(`metadata resource ${prm.resource} != requested ${params.resource}`)
  }
  if (!Array.isArray(prm.authorization_servers) || prm.authorization_servers.length === 0) {
    throw new Error('metadata has no authorization_servers')
  }
  const issuer = (params.selectAuthServer ?? ((s) => s[0]))(prm.authorization_servers)
  if (issuer == null) {
    throw new Error('no authorization server selected')
  }
  const as = await fetchAuthServerMetadata({
    issuer,
    fetch: params.fetch,
    allowLoopback,
    signal: params.signal,
  })
  return { prm, as }
}

/**
 * Fetches and checks RFC 8414 metadata for `issuer`: the document must name the same issuer, its
 * endpoints must be https (http only on loopback when `allowLoopback`), and it must support PKCE
 * S256 when it lists challenge methods. A `revocation_endpoint` is checked the same way.
 */
export async function fetchAuthServerMetadata(params: {
  issuer: string
  fetch: FetchLike
  allowLoopback?: boolean
  signal?: AbortSignal
}): Promise<AuthServerMetadata> {
  const { issuer } = params
  const allowLoopback = params.allowLoopback ?? false
  requireHTTPS(issuer, allowLoopback)
  const as = (await fetchMetadata(
    params.fetch,
    wellKnownAS(issuer),
    params.signal,
  )) as AuthServerMetadata
  if (as.issuer !== issuer) throw new Error(`AS issuer ${as.issuer} != ${issuer}`)
  requireHTTPS(as.authorization_endpoint, allowLoopback)
  requireHTTPS(as.token_endpoint, allowLoopback)
  if (as.revocation_endpoint != null) requireHTTPS(as.revocation_endpoint, allowLoopback)
  const methods = as.code_challenge_methods_supported
  if (methods && !methods.includes('S256')) throw new Error('AS does not support PKCE S256')
  return as
}
