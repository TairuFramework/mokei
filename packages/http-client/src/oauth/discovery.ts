import type { FetchLike } from '../transport.js'
import { fetchOAuthJSON } from './fetch.js'

export type ProtectedResourceMetadata = { resource: string; authorization_servers: Array<string> }
export type AuthServerMetadata = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  code_challenge_methods_supported?: Array<string>
}

export function parseResourceMetadataURL(header: string | null): string | null {
  if (!header) return null
  const match = /resource_metadata="([^"]+)"/.exec(header)
  return match?.[1] ?? null
}

function isLoopbackHost(hostname: string): boolean {
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
  const prm = (await fetchOAuthJSON(params.fetch, prmURL, {
    signal: params.signal,
    errorLabel: 'protected-resource metadata',
  })) as ProtectedResourceMetadata
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
  requireHTTPS(issuer, allowLoopback)
  const asURL = wellKnownAS(issuer)
  const as = (await fetchOAuthJSON(params.fetch, asURL, {
    signal: params.signal,
    errorLabel: 'authorization-server metadata',
  })) as AuthServerMetadata
  if (as.issuer !== issuer) throw new Error(`AS issuer ${as.issuer} != ${issuer}`)
  requireHTTPS(as.authorization_endpoint, allowLoopback)
  requireHTTPS(as.token_endpoint, allowLoopback)
  const methods = as.code_challenge_methods_supported
  if (methods && !methods.includes('S256')) throw new Error('AS does not support PKCE S256')
  return { prm, as }
}
