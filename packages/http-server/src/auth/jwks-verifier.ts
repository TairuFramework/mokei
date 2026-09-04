import {
  type AuthInfo,
  assertStandardClaims,
  decodeJwt,
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

/** `JsonWebKey` per lib.dom.d.ts omits `kid`, which JWKS keys carry per RFC 7517. */
type Jwk = JsonWebKey & { kid?: string }

export type JWKSVerifierConfig = {
  /** Expected token issuer. Also used for RFC 8414 discovery when `jwksUri` is not set. */
  issuer: string
  /** JWKS endpoint URI. When omitted, discovered via RFC 8414 metadata on `issuer`. */
  jwksUri?: string
  /** Injectable fetch, defaults to `globalThis.fetch`. */
  fetch?: FetchLike
  /** Clock-skew tolerance for `exp`/`nbf` checks, in seconds. Defaults to 30. */
  toleranceSeconds?: number
  /** Clock source, returning epoch seconds. Defaults to `Date.now()`-based. */
  now?: () => number
}

type CachedJwks = {
  keys: Array<Jwk>
  fetchedAt: number
  ttlSeconds: number
}

function defaultNow(): number {
  return Math.floor(Date.now() / 1000)
}

function parseMaxAge(cacheControl: string | null): number | undefined {
  if (cacheControl == null) return undefined
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl)
  if (match == null) return undefined
  const seconds = Number(match[1])
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

/**
 * Parse a fetch `Response` body as JSON, converting a non-JSON body into a
 * `TokenVerificationError` instead of letting a raw `SyntaxError` escape —
 * callers that only catch `TokenVerificationError` for verification failures
 * should never see an unrelated parse error type.
 */
async function parseJsonResponse(res: Response, url: string): Promise<unknown> {
  try {
    return await res.json()
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
  const now = config.now ?? defaultNow

  let cache: CachedJwks | undefined
  let inflight: Promise<CachedJwks> | undefined
  let resolvedJwksUri: string | undefined

  async function discoverJwksUri(): Promise<string> {
    if (config.jwksUri != null) return config.jwksUri
    if (resolvedJwksUri != null) return resolvedJwksUri
    const metadataUrl = `${config.issuer}/.well-known/oauth-authorization-server`
    const res = await fetchFn(metadataUrl)
    if (!res.ok) {
      throw new TokenVerificationError(
        'invalid_token',
        `failed to discover JWKS URI from ${metadataUrl}: HTTP ${res.status}`,
      )
    }
    const metadata = (await parseJsonResponse(res, metadataUrl)) as { jwks_uri?: unknown }
    if (typeof metadata.jwks_uri !== 'string' || metadata.jwks_uri.length === 0) {
      throw new TokenVerificationError(
        'invalid_token',
        `authorization server metadata at ${metadataUrl} is missing jwks_uri`,
      )
    }
    resolvedJwksUri = metadata.jwks_uri
    return resolvedJwksUri
  }

  async function fetchJwks(): Promise<CachedJwks> {
    const uri = await discoverJwksUri()
    const res = await fetchFn(uri)
    if (!res.ok) {
      throw new TokenVerificationError(
        'invalid_token',
        `failed to fetch JWKS from ${uri}: HTTP ${res.status}`,
      )
    }
    const body = (await parseJsonResponse(res, uri)) as { keys?: unknown }
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

  /** Get the cached JWKS, refreshing it (single-flight) if absent, expired, or forced. */
  async function getJwks(forceRefresh: boolean): Promise<CachedJwks> {
    if (!forceRefresh && cache != null && now() - cache.fetchedAt < cache.ttlSeconds) {
      return cache
    }
    if (inflight != null) return inflight
    const promise = fetchJwks()
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

  function selectJwk(keys: Array<Jwk>, kid: unknown): Jwk | undefined {
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
    return true
  }

  async function importVerifyKey(jwk: Jwk, algParams: AlgParams): Promise<CryptoKey> {
    return crypto.subtle.importKey('jwk', jwk, algParams, false, ['verify'])
  }

  async function findKeyAndVerify(
    header: Record<string, unknown>,
    algParams: AlgParams,
    alg: 'RS256' | 'ES256',
    signingInput: Uint8Array,
    signature: Uint8Array,
    forceRefresh: boolean,
  ): Promise<boolean> {
    const jwks = await getJwks(forceRefresh)
    const jwk = selectJwk(jwks.keys, header.kid)
    if (jwk == null) return false
    if (!matchesAlg(jwk, alg)) return false
    const key = await importVerifyKey(jwk, algParams)
    // `decodeJwt` yields Uint8Array views over freshly allocated ArrayBuffers (never
    // SharedArrayBuffer); the cast below only reconciles a typed-array generics
    // mismatch between this package's `lib` setting and `@sozai/codec`'s declared
    // return type, not an actual buffer-kind narrowing.
    return crypto.subtle.verify(
      algParams,
      key,
      signature as BufferSource,
      signingInput as BufferSource,
    )
  }

  return {
    async verifyAccessToken(token: string, ctx: { resource: string }): Promise<AuthInfo> {
      const { header, payload, signingInput, signature } = decodeJwt(token)

      // Algorithm allowlist gate MUST run before any key import/lookup, to prevent
      // algorithm-confusion attacks (e.g. `alg: none` or an HMAC alg used against
      // an RSA/EC public key material).
      const alg = header.alg
      if (typeof alg !== 'string' || !(alg === 'RS256' || alg === 'ES256')) {
        throw new TokenVerificationError('invalid_token', `unsupported JWT alg: ${String(alg)}`)
      }
      const algParams = ALG_PARAMS[alg]

      let verified = await findKeyAndVerify(header, algParams, alg, signingInput, signature, false)
      if (!verified) {
        // Unknown kid or a failed verification could indicate key rotation: force
        // exactly one JWKS refresh and retry before giving up.
        verified = await findKeyAndVerify(header, algParams, alg, signingInput, signature, true)
      }
      if (!verified) {
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

      const expiresAt = typeof payload.exp === 'number' ? payload.exp : undefined
      return {
        subject: payload.sub,
        scopes: scopesFromClaim(payload),
        expiresAt,
        raw: payload,
      }
    },
  }
}
