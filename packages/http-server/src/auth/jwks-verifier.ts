import {
  type AuthInfo,
  assertStandardClaims,
  decodeJWT,
  type OAuthTokenVerifier,
  scopesFromClaim,
  TokenVerificationError,
} from './verifier.js'

/**
 * A minimal fetch-shaped type, declared locally so this file does not depend on
 * `@mokei/http-client` (server packages must not depend on client packages).
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

type AlgParams =
  | { name: 'RSASSA-PKCS1-v1_5'; hash: 'SHA-256' }
  | { name: 'ECDSA'; hash: 'SHA-256'; namedCurve: 'P-256' }

/**
 * Allowlisted JWS algorithms. Anything else must be rejected before any key
 * import happens, to prevent algorithm-confusion attacks (e.g. an attacker
 * claiming `alg: none` or `alg: HS256` to bypass asymmetric signature checks).
 */
const ALG_PARAMS: Record<string, AlgParams> = {
  RS256: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
  ES256: { name: 'ECDSA', hash: 'SHA-256', namedCurve: 'P-256' },
}

const DEFAULT_JWKS_TTL_SECONDS = 300
const MAX_JWKS_KEYS = 50
const DEFAULT_TOLERANCE_SECONDS = 30
const DEFAULT_MIN_REFRESH_INTERVAL_SECONDS = 30

/** Default deadline for the AS-metadata/JWKS fetches, in milliseconds. */
const DEFAULT_FETCH_TIMEOUT_MS = 30_000

/** Default cap on the AS-metadata/JWKS response bodies, in bytes. */
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000

/** `JsonWebKey` per lib.dom.d.ts omits `kid`, which JWKS keys carry per RFC 7517. */
type Jwk = JsonWebKey & { kid?: string }

export type JWKSVerifierConfig = {
  /** Expected token issuer. Also used for RFC 8414 discovery when `jwksURI` is not set. */
  issuer: string
  /** JWKS endpoint URI. When omitted, discovered via RFC 8414 metadata on `issuer`. */
  jwksURI?: string
  /** Injectable fetch, defaults to `globalThis.fetch`. */
  fetch?: FetchLike
  /** Clock-skew tolerance for `exp`/`nbf` checks, in seconds. Defaults to 30. */
  toleranceSeconds?: number
  /** Minimum seconds between forced JWKS refreshes (unknown-kid rotation recovery). Defaults to 30. */
  minRefreshIntervalSeconds?: number
  /** Clock source, returning epoch seconds. Defaults to `Date.now()`-based. */
  now?: () => number
  /** Deadline for the AS-metadata/JWKS fetches, in milliseconds. Defaults to 30,000. */
  fetchTimeoutMs?: number
  /** Cap on the AS-metadata/JWKS response bodies, in bytes. Defaults to 1,000,000. */
  maxResponseBytes?: number
}

type CachedJWKS = {
  keys: Array<Jwk>
  fetchedAt: number
  ttlSeconds: number
}

function defaultNow(): number {
  return Math.floor(Date.now() / 1000)
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

/** Requires `url` to be https, allowing http only for a loopback host. */
function requireHTTPS(url: string): void {
  const u = new URL(url)
  if (u.protocol === 'https:') return
  if (u.protocol === 'http:' && isLoopbackHost(u.hostname)) return
  throw new TokenVerificationError('invalid_token', `OAuth endpoint must be https: ${url}`)
}

/** RFC 8414: insert the well-known segment before the issuer's own path, not append it. */
function wellKnownAS(issuer: string): string {
  const u = new URL(issuer)
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')
  return `${u.origin}/.well-known/oauth-authorization-server${path}`
}

function parseMaxAge(cacheControl: string | null): number | undefined {
  if (cacheControl == null) return undefined
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl)
  if (match == null) return undefined
  const seconds = Number(match[1])
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

/** Concatenate a list of `Uint8Array` chunks into one contiguous buffer. */
function concatUint8(chunks: Array<Uint8Array>): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * Read `res`'s body up to `maxBytes`, throwing before any oversized body is fully buffered.
 *
 * The `content-length` header (when present) is checked first as a cheap fast-path; the running
 * total is checked again on every chunk since a response can omit or lie about that header (e.g.
 * chunked transfer-encoding).
 */
async function readCappedText(res: Response, url: string, maxBytes: number): Promise<string> {
  const contentLength = Number(res.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new TokenVerificationError(
      'invalid_token',
      `response from ${url} exceeds ${maxBytes} bytes`,
    )
  }
  const body = res.body
  if (body == null) return ''
  const reader = body.getReader()
  const chunks: Array<Uint8Array> = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value != null) {
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new TokenVerificationError(
          'invalid_token',
          `response from ${url} exceeds ${maxBytes} bytes`,
        )
      }
      chunks.push(value)
    }
  }
  return new TextDecoder().decode(concatUint8(chunks))
}

/**
 * Parse a capped `Response` body as JSON, converting a non-JSON body into a
 * `TokenVerificationError` so callers that only catch that type never see a raw `SyntaxError`.
 * The byte cap runs before parsing, so an oversized body is never buffered.
 */
async function parseJSONResponse(res: Response, url: string, maxBytes: number): Promise<unknown> {
  const text = await readCappedText(res, url, maxBytes)
  try {
    return JSON.parse(text)
  } catch (cause) {
    const error = new TokenVerificationError(
      'invalid_token',
      `response from ${url} is not valid JSON`,
    )
    error.cause = cause
    throw error
  }
}

/**
 * A verifier for OAuth 2.0 access tokens (JWTs) signed with RS256 or ES256,
 * verified against a JWKS fetched from the authorization server.
 */
export function createJWKSVerifier(config: JWKSVerifierConfig): OAuthTokenVerifier {
  const fetchFn: FetchLike = config.fetch ?? (globalThis.fetch as FetchLike)
  const toleranceSeconds = config.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  const minRefreshInterval =
    config.minRefreshIntervalSeconds ?? DEFAULT_MIN_REFRESH_INTERVAL_SECONDS
  const now = config.now ?? defaultNow
  const fetchTimeoutMs = config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  const maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES

  let cache: CachedJWKS | undefined
  let inflight: Promise<CachedJWKS> | undefined
  let resolvedJWKSURI: string | undefined
  let lastForcedRefreshAt = 0

  async function discoverJWKSURI(): Promise<string> {
    if (config.jwksURI != null) return config.jwksURI
    if (resolvedJWKSURI != null) return resolvedJWKSURI
    const metadataURL = wellKnownAS(config.issuer)
    requireHTTPS(metadataURL)
    const res = await fetchFn(metadataURL, {
      redirect: 'error',
      signal: AbortSignal.timeout(fetchTimeoutMs),
    })
    if (!res.ok) {
      throw new TokenVerificationError(
        'invalid_token',
        `failed to discover JWKS URI from ${metadataURL}: HTTP ${res.status}`,
      )
    }
    const metadata = (await parseJSONResponse(res, metadataURL, maxResponseBytes)) as {
      issuer?: unknown
      jwks_uri?: unknown
    }
    if (metadata.issuer !== config.issuer) {
      throw new TokenVerificationError('invalid_token', 'issuer mismatch in AS metadata')
    }
    if (typeof metadata.jwks_uri !== 'string' || metadata.jwks_uri.length === 0) {
      throw new TokenVerificationError(
        'invalid_token',
        `authorization server metadata at ${metadataURL} is missing jwks_uri`,
      )
    }
    resolvedJWKSURI = metadata.jwks_uri
    return resolvedJWKSURI
  }

  async function fetchJWKS(): Promise<CachedJWKS> {
    const uri = await discoverJWKSURI()
    requireHTTPS(uri)
    const res = await fetchFn(uri, {
      redirect: 'error',
      signal: AbortSignal.timeout(fetchTimeoutMs),
    })
    if (!res.ok) {
      throw new TokenVerificationError(
        'invalid_token',
        `failed to fetch JWKS from ${uri}: HTTP ${res.status}`,
      )
    }
    const body = (await parseJSONResponse(res, uri, maxResponseBytes)) as { keys?: unknown }
    if (!Array.isArray(body.keys)) {
      throw new TokenVerificationError('invalid_token', 'JWKS response is missing a keys array')
    }
    if (body.keys.length > MAX_JWKS_KEYS) {
      throw new TokenVerificationError(
        'invalid_token',
        `JWKS contains too many keys (${body.keys.length} > ${MAX_JWKS_KEYS})`,
      )
    }
    const ttlSeconds = parseMaxAge(res.headers.get('cache-control')) ?? DEFAULT_JWKS_TTL_SECONDS
    return { keys: body.keys as Array<Jwk>, fetchedAt: now(), ttlSeconds }
  }

  /**
   * Get the cached JWKS, refreshing it (single-flight) if absent, expired, or forced.
   *
   * A forced refresh (unknown-kid rotation recovery) is rate-limited to one per
   * `minRefreshInterval` once a cache exists, so an attacker sending tokens with ever-changing
   * `kid`s cannot force a network fetch per request. A cold cache and the first forced refresh in
   * a window are always allowed; a second within the window returns the cached JWKS.
   */
  async function getJWKS(forceRefresh: boolean): Promise<CachedJWKS> {
    if (!forceRefresh && cache != null && now() - cache.fetchedAt < cache.ttlSeconds) {
      return cache
    }
    if (forceRefresh && cache != null && now() - lastForcedRefreshAt < minRefreshInterval) {
      return cache
    }
    if (inflight != null) return inflight
    if (forceRefresh) lastForcedRefreshAt = now()
    const promise = fetchJWKS()
      .then((fetched) => {
        cache = fetched
        return fetched
      })
      .finally(() => {
        inflight = undefined
      })
    inflight = promise
    return promise
  }

  function selectJWK(keys: Array<Jwk>, kid: unknown): Jwk | undefined {
    if (typeof kid === 'string') {
      return keys.find((key) => key.kid === kid)
    }
    if (keys.length === 1) return keys[0]
    return undefined
  }

  function matchesAlg(jwk: Jwk, alg: 'RS256' | 'ES256'): boolean {
    if (alg === 'RS256' && jwk.kty !== 'RSA') return false
    if (alg === 'ES256' && (jwk.kty !== 'EC' || jwk.crv !== 'P-256')) return false
    if (jwk.use != null && jwk.use !== 'sig') return false
    if (jwk.key_ops != null && !jwk.key_ops.includes('verify')) return false
    if (jwk.alg != null && jwk.alg !== alg) return false
    return true
  }

  async function importVerifyKey(jwk: Jwk, algParams: AlgParams): Promise<CryptoKey> {
    return crypto.subtle.importKey('jwk', jwk, algParams, false, ['verify'])
  }

  /**
   * Verify against the cached (or refreshed) JWKS, reporting separately whether a matching key was
   * `found`. A signature failure against a `found` key is a genuine bad signature, not a rotation
   * signal: the caller must not refetch for it, or an attacker could force one unauthenticated
   * JWKS fetch per request by sending garbage signed with a valid `kid`.
   */
  async function findKeyAndVerify(
    header: Record<string, unknown>,
    algParams: AlgParams,
    alg: 'RS256' | 'ES256',
    signingInput: Uint8Array,
    signature: Uint8Array,
    forceRefresh: boolean,
  ): Promise<{ found: boolean; verified: boolean }> {
    const jwks = await getJWKS(forceRefresh)
    const jwk = selectJWK(jwks.keys, header.kid)
    if (jwk == null) return { found: false, verified: false }
    // A resolved `kid` is not a rotation signal (rotated keys carry a new `kid`, RFC 7517), so an
    // alg/kty mismatch is a bad token, not a stale cache: report `found: true` so the caller
    // rejects without a refetch.
    if (!matchesAlg(jwk, alg)) return { found: true, verified: false }
    // A malformed JWK makes `importKey`/`verify` throw instead of returning false. Treat that like
    // a signature failure (`found: true`, `verified: false`): it must not escape as an HTTP 500,
    // and `found: true` keeps the amplification guard intact — the caller only refetches when no
    // key is found.
    try {
      const key = await importVerifyKey(jwk, algParams)
      // The BufferSource casts below only reconcile a typed-array generics mismatch between this
      // package's `lib` setting and `@sozai/codec`; the buffers are always plain ArrayBuffers.
      const verified = await crypto.subtle.verify(
        algParams,
        key,
        signature as BufferSource,
        signingInput as BufferSource,
      )
      return { found: true, verified }
    } catch {
      return { found: true, verified: false }
    }
  }

  return {
    async verifyAccessToken(token: string, ctx: { resource: string }): Promise<AuthInfo> {
      const { header, payload, signingInput, signature } = decodeJWT(token)

      // Algorithm allowlist gate MUST run before any key import/lookup, to prevent
      // algorithm-confusion attacks (e.g. `alg: none` or an HMAC alg used against
      // an RSA/EC public key material).
      const alg = header.alg
      if (typeof alg !== 'string' || !(alg === 'RS256' || alg === 'ES256')) {
        throw new TokenVerificationError('invalid_token', `unsupported JWT alg: ${String(alg)}`)
      }
      const algParams = ALG_PARAMS[alg]
      if (algParams == null) {
        throw new TokenVerificationError('invalid_token', `unsupported JWT alg: ${alg}`)
      }

      let result = await findKeyAndVerify(header, algParams, alg, signingInput, signature, false)
      if (!result.found) {
        // Unknown kid: possibly a rotation. Force one JWKS refresh and retry. (A found-but-failed
        // key is not retried — see findKeyAndVerify.)
        result = await findKeyAndVerify(header, algParams, alg, signingInput, signature, true)
      }
      if (!result.verified) {
        throw new TokenVerificationError('invalid_token', 'JWT signature verification failed')
      }

      assertStandardClaims(payload, {
        resource: ctx.resource,
        issuer: config.issuer,
        now: now(),
        toleranceSeconds,
      })

      if (typeof payload.sub !== 'string') {
        throw new TokenVerificationError('invalid_token', 'token missing sub')
      }

      // `assertStandardClaims` enforces expiry only when `exp` is present; this verifier requires
      // `exp` on every token (unlike the DID verifier's own @kokuin/token backstop).
      if (typeof payload.exp !== 'number') {
        throw new TokenVerificationError('invalid_token', 'token missing exp')
      }

      return {
        subject: payload.sub,
        scopes: scopesFromClaim(payload),
        expiresAt: payload.exp,
        raw: payload,
      }
    },
  }
}
