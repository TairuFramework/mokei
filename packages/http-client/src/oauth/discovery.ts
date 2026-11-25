import { fetchOAuthJSON, OAuthTokenError } from '@kokuin/oauth'
import type { Runtime } from '@sozai/runtime'

import type { FetchLike } from '../transport.js'

export type ProtectedResourceMetadata = { resource: string; authorization_servers: Array<string> }
export type AuthServerMetadata = {
  issuer: string
  /** Required for `authorization_code`, unused by `client_credentials`. */
  authorization_endpoint?: string
  token_endpoint: string
  code_challenge_methods_supported?: Array<string>
  /** RFC 7009 token revocation endpoint, when the authorisation server has one. */
  revocation_endpoint?: string
  grant_types_supported?: unknown
  token_endpoint_auth_methods_supported?: unknown
  token_endpoint_auth_signing_alg_values_supported?: unknown
}

/** The grant a discovery run serves; it selects which metadata checks apply. */
export type DiscoveryGrant = 'authorization_code' | 'client_credentials'

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

/** Statuses meaning "no document at this candidate URL": try the next candidate. */
const FALLBACK_STATUSES = [404, 405, 410]

/** Protected resource metadata candidates (RFC 9728): path-specific, then root. */
export function protectedResourceMetadataURLs(resource: string): Array<string> {
  const u = new URL(resource)
  const path = u.pathname === '/' ? '' : u.pathname
  const base = `${u.origin}/.well-known/oauth-protected-resource`
  return path === '' ? [base] : [`${base}${path}`, base]
}

/** Authorisation server metadata candidates: RFC 8414, OIDC path insertion, OIDC path appending. */
export function authServerMetadataURLs(issuer: string): Array<string> {
  const u = new URL(issuer)
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')
  const oauth = `${u.origin}/.well-known/oauth-authorization-server`
  const oidc = `${u.origin}/.well-known/openid-configuration`
  return path === ''
    ? [oauth, oidc]
    : [`${oauth}${path}`, `${oidc}${path}`, `${u.origin}${path}/.well-known/openid-configuration`]
}

/** Fetches candidates in order. Only 404/405/410 advance; any other failure is terminal. */
async function fetchFirstMetadata(
  fetch: FetchLike,
  urls: Array<string>,
  signal?: AbortSignal,
): Promise<unknown> {
  let last: unknown
  for (const url of urls) {
    try {
      return await fetchMetadata(fetch, url, signal)
    } catch (error) {
      if (error instanceof OAuthTokenError && FALLBACK_STATUSES.includes(error.status)) {
        last = error
        continue
      }
      throw error
    }
  }
  throw last
}

export async function discover(params: {
  resource: string
  resourceMetadataURL?: string
  fetch: FetchLike
  grant: DiscoveryGrant
  selectAuthServer?: (servers: Array<string>) => string
  /** Pins the authorisation server: it must be listed in the resource metadata, and
   * `selectAuthServer` is ignored. */
  expectedIssuer?: string
  /** Aborts every metadata fetch, in addition to their own bounded timeout. */
  signal?: AbortSignal
}): Promise<{ prm: ProtectedResourceMetadata; as: AuthServerMetadata }> {
  const allowLoopback = isLoopbackHost(new URL(params.resource).hostname)
  const prmURLs =
    params.resourceMetadataURL == null
      ? protectedResourceMetadataURLs(params.resource)
      : [params.resourceMetadataURL]
  for (const url of prmURLs) requireHTTPS(url, allowLoopback)
  const prm = (await fetchFirstMetadata(
    params.fetch,
    prmURLs,
    params.signal,
  )) as ProtectedResourceMetadata
  if (prm.resource !== params.resource) {
    throw new Error(`metadata resource ${prm.resource} != requested ${params.resource}`)
  }
  if (!Array.isArray(prm.authorization_servers) || prm.authorization_servers.length === 0) {
    throw new Error('metadata has no authorization_servers')
  }
  let issuer: string | undefined
  if (params.expectedIssuer == null) {
    issuer = (params.selectAuthServer ?? ((s) => s[0]))(prm.authorization_servers)
  } else {
    if (!prm.authorization_servers.includes(params.expectedIssuer)) {
      throw new Error(
        `expected issuer ${params.expectedIssuer} not in authorization_servers: ${prm.authorization_servers.join(', ')}`,
      )
    }
    issuer = params.expectedIssuer
  }
  if (issuer == null) {
    throw new Error('no authorization server selected')
  }
  const as = await fetchAuthServerMetadata({
    issuer,
    fetch: params.fetch,
    grant: params.grant,
    allowLoopback,
    signal: params.signal,
  })
  return { prm, as }
}

/**
 * Fetches and checks authorisation server metadata for `issuer` (RFC 8414 then OIDC fallbacks):
 * the document must name the same issuer and its `token_endpoint` and `revocation_endpoint` must
 * be https (http only on loopback when `allowLoopback`). `authorization_code` also requires an
 * https `authorization_endpoint` and PKCE S256 when challenge methods are listed;
 * `client_credentials` needs neither.
 */
export async function fetchAuthServerMetadata(params: {
  issuer: string
  fetch: FetchLike
  grant: DiscoveryGrant
  allowLoopback?: boolean
  signal?: AbortSignal
}): Promise<AuthServerMetadata> {
  const { issuer } = params
  const allowLoopback = params.allowLoopback ?? false
  requireHTTPS(issuer, allowLoopback)
  const urls = authServerMetadataURLs(issuer)
  for (const url of urls) requireHTTPS(url, allowLoopback)
  const as = (await fetchFirstMetadata(params.fetch, urls, params.signal)) as AuthServerMetadata
  if (as.issuer !== issuer) throw new Error(`AS issuer ${as.issuer} != ${issuer}`)
  requireHTTPS(as.token_endpoint, allowLoopback)
  if (as.revocation_endpoint != null) requireHTTPS(as.revocation_endpoint, allowLoopback)
  if (params.grant === 'authorization_code') {
    if (as.authorization_endpoint == null) throw new Error('AS has no authorization_endpoint')
    requireHTTPS(as.authorization_endpoint, allowLoopback)
    const methods = as.code_challenge_methods_supported
    if (methods && !methods.includes('S256')) throw new Error('AS does not support PKCE S256')
  }
  return as
}
