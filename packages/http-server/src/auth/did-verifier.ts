import { verifyToken } from '@kokuin/token'

import {
  type AuthInfo,
  assertStandardClaims,
  type OAuthTokenVerifier,
  scopesFromClaim,
  TokenVerificationError,
} from './verifier.js'

export function createDIDVerifier(
  config: { toleranceSeconds?: number; now?: () => number } = {},
): OAuthTokenVerifier {
  const toleranceSeconds = config.toleranceSeconds ?? 30
  const now = config.now ?? (() => Math.floor(Date.now() / 1000))
  return {
    async verifyAccessToken(token, ctx) {
      let verified: Awaited<ReturnType<typeof verifyToken>>
      try {
        verified = await verifyToken(token)
      } catch (cause) {
        const error = new TokenVerificationError(
          'invalid_token',
          `DID token verification failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
        error.cause = cause
        throw error
      }
      const payload = verified.payload as Record<string, unknown>
      // iss is enforced by verifyToken (the DID that signed it); apply the shared aud/exp/nbf checks.
      assertStandardClaims(payload, { resource: ctx.resource, now: now(), toleranceSeconds })
      return {
        subject: String(payload.iss),
        scopes: scopesFromClaim(payload),
        expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
        raw: payload,
      } satisfies AuthInfo
    },
  }
}
