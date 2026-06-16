import { timingSafeEqual } from 'node:crypto'

export type GateOptions = { token: string; allowedHosts: Set<string> }

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  // Length check first: timingSafeEqual throws on unequal lengths.
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** Host:port values we accept on the Host/Origin headers for a given bind. */
export function buildAllowedHosts(host: string, port: number): Set<string> {
  const hosts = new Set<string>([`${host}:${port}`])
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
    hosts.add(`127.0.0.1:${port}`)
    hosts.add(`localhost:${port}`)
    hosts.add(`[::1]:${port}`)
  }
  return hosts
}

/**
 * Gate an /api request. Host-header allowlist defeats DNS rebinding; the
 * Origin check defeats classic CSRF when present; the bearer token defeats a
 * blind cross-origin fetch that cannot read the token.
 */
export function verifyApiRequest(request: Request, opts: GateOptions): boolean {
  const host = request.headers.get('host')
  if (host == null || !opts.allowedHosts.has(host)) {
    return false
  }
  const origin = request.headers.get('origin')
  if (origin != null) {
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      return false
    }
    if (!opts.allowedHosts.has(originHost)) {
      return false
    }
  }
  const auth = request.headers.get('authorization')
  const prefix = 'Bearer '
  return auth != null && auth.startsWith(prefix) && safeEqual(auth.slice(prefix.length), opts.token)
}
