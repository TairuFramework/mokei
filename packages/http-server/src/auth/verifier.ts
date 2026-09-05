import { fromB64U } from '@sozai/codec'

export type AuthInfo = { subject: string; scopes: Array<string>; expiresAt?: number; raw?: unknown }

/**
 * A pluggable verifier for OAuth 2.0 bearer access tokens.
 *
 * Error-typing contract: `verifyAccessToken` MUST throw {@link TokenVerificationError} for every
 * credential-validation failure (bad signature, expired/malformed token, wrong audience/issuer).
 * Any other thrown error is treated as operational (network/DNS, an unexpected crypto exception)
 * and propagates as-is: `createBearerAuthGate` rethrows non-`TokenVerificationError`s as HTTP 500.
 * This fail-closed default is deliberate — normalizing every error to 401 would mask an AS outage
 * or verifier bug as an ordinary auth failure. A custom verifier must re-throw positively
 * identified credential problems as `TokenVerificationError`, but must not blanket-convert.
 */
export type OAuthTokenVerifier = {
  verifyAccessToken(token: string, ctx: { resource: string }): Promise<AuthInfo>
}

export class TokenVerificationError extends Error {
  code: 'invalid_token' | 'insufficient_scope'
  constructor(code: 'invalid_token' | 'insufficient_scope', message: string) {
    super(message)
    this.name = 'TokenVerificationError'
    this.code = code
  }
}

export function decodeJWT(token: string): {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signingInput: Uint8Array
  signature: Uint8Array
} {
  const parts = token.split('.')
  const [h, p, s] = parts
  if (parts.length !== 3 || h == null || p == null || s == null) {
    throw new TokenVerificationError('invalid_token', 'malformed JWT')
  }
  try {
    const header = JSON.parse(new TextDecoder().decode(fromB64U(h))) as Record<string, unknown>
    const payload = JSON.parse(new TextDecoder().decode(fromB64U(p))) as Record<string, unknown>
    const isPlainObject = (v: unknown): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && !Array.isArray(v)
    if (!isPlainObject(header) || !isPlainObject(payload)) {
      throw new TokenVerificationError('invalid_token', 'malformed JWT')
    }
    return {
      header,
      payload,
      signingInput: new TextEncoder().encode(`${h}.${p}`),
      signature: fromB64U(s),
    }
  } catch (cause) {
    if (cause instanceof TokenVerificationError) throw cause
    const error = new TokenVerificationError('invalid_token', 'malformed JWT')
    error.cause = cause
    throw error
  }
}

export function assertStandardClaims(
  payload: Record<string, unknown>,
  {
    resource,
    now,
    toleranceSeconds,
    issuer,
  }: { resource: string; now: number; toleranceSeconds: number; issuer?: string },
): void {
  const aud = payload.aud
  const audOk = aud === resource || (Array.isArray(aud) && aud.includes(resource))
  if (!audOk)
    throw new TokenVerificationError('invalid_token', `token audience does not include ${resource}`)
  if (issuer != null && payload.iss !== issuer)
    throw new TokenVerificationError('invalid_token', 'issuer mismatch')
  const exp = payload.exp
  if (typeof exp === 'number' && exp + toleranceSeconds <= now)
    throw new TokenVerificationError('invalid_token', 'token expired')
  // `nbf` is an inclusive lower bound (a token is valid AT `nbf`), unlike `exp`'s exclusive upper
  // bound above -- so this uses `>`, not `>=`.
  const nbf = payload.nbf
  if (typeof nbf === 'number' && nbf - toleranceSeconds > now)
    throw new TokenVerificationError('invalid_token', 'token not yet valid')
}

export function scopesFromClaim(payload: Record<string, unknown>): Array<string> {
  const scope = payload.scope
  if (typeof scope === 'string') return scope.split(' ').filter(Boolean)
  if (Array.isArray(payload.scp))
    return payload.scp.filter((s): s is string => typeof s === 'string')
  return []
}
