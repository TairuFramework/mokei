import type { FetchLike } from '../transport.js'

export type ProtectedResourceMetadata = { resource: string; authorization_servers: Array<string> }
export type AuthServerMetadata = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  code_challenge_methods_supported?: Array<string>
}

export function parseResourceMetadataUrl(header: string | null): string | null {
  if (!header) return null
  const match = /resource_metadata="([^"]+)"/.exec(header)
  return match ? match[1] : null
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

function requireHttps(url: string, allowLoopback: boolean): void {
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
  resourceMetadataUrl?: string
  fetch: FetchLike
  selectAuthServer?: (servers: Array<string>) => string
}): Promise<{ prm: ProtectedResourceMetadata; as: AuthServerMetadata }> {
  const allowLoopback = isLoopbackHost(new URL(params.resource).hostname)
  const prmUrl = params.resourceMetadataUrl ?? wellKnownPRM(params.resource)
  requireHttps(prmUrl, allowLoopback)
  const prmRes = await params.fetch(prmUrl, { redirect: 'error' })
  if (!prmRes.ok) throw new Error(`protected-resource metadata HTTP ${prmRes.status}`)
  const prm = (await prmRes.json()) as ProtectedResourceMetadata
  if (prm.resource !== params.resource) {
    throw new Error(`metadata resource ${prm.resource} != requested ${params.resource}`)
  }
  if (!Array.isArray(prm.authorization_servers) || prm.authorization_servers.length === 0) {
    throw new Error('metadata has no authorization_servers')
  }
  const issuer = (params.selectAuthServer ?? ((s) => s[0]))(prm.authorization_servers)
  requireHttps(issuer, allowLoopback)
  const asUrl = wellKnownAS(issuer)
  const asRes = await params.fetch(asUrl, { redirect: 'error' })
  if (!asRes.ok) throw new Error(`authorization-server metadata HTTP ${asRes.status}`)
  const as = (await asRes.json()) as AuthServerMetadata
  if (as.issuer !== issuer) throw new Error(`AS issuer ${as.issuer} != ${issuer}`)
  requireHttps(as.authorization_endpoint, allowLoopback)
  requireHttps(as.token_endpoint, allowLoopback)
  const methods = as.code_challenge_methods_supported
  if (methods && !methods.includes('S256')) throw new Error('AS does not support PKCE S256')
  return { prm, as }
}
