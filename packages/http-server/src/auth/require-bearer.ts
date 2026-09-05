import type { AuthInfo, OAuthTokenVerifier } from './verifier.js'
import { TokenVerificationError } from './verifier.js'

export type BearerAuthOptions = {
  verifier: OAuthTokenVerifier
  resource: string
  requiredScopes?: Array<string>
  resourceMetadataURL: string
}

function challenge(metadataURL: string, error?: string, extra?: Record<string, string>): string {
  const parts = [`Bearer resource_metadata="${metadataURL}"`]
  if (error) parts.push(`error="${error}"`)
  for (const [k, v] of Object.entries(extra ?? {})) parts.push(`${k}="${v}"`)
  return parts.join(', ')
}

function unauthorized(status: number, header: string): Response {
  return new Response(null, { status, headers: { 'WWW-Authenticate': header } })
}

export function createBearerAuthGate(
  options: BearerAuthOptions,
): (request: Request) => Promise<{ response?: Response; authInfo?: AuthInfo }> {
  const { verifier, resource, requiredScopes = [], resourceMetadataURL } = options
  return async (request) => {
    const header = request.headers.get('Authorization')
    const match = header ? /^Bearer (.+)$/i.exec(header) : null
    const token = match?.[1]
    if (token == null) {
      return { response: unauthorized(401, challenge(resourceMetadataURL)) }
    }
    let authInfo: AuthInfo
    try {
      authInfo = await verifier.verifyAccessToken(token, { resource })
    } catch (err) {
      if (err instanceof TokenVerificationError) {
        return { response: unauthorized(401, challenge(resourceMetadataURL, 'invalid_token')) }
      }
      throw err
    }
    const missing = requiredScopes.filter((s) => !authInfo.scopes.includes(s))
    if (missing.length > 0) {
      return {
        response: unauthorized(
          403,
          challenge(resourceMetadataURL, 'insufficient_scope', { scope: requiredScopes.join(' ') }),
        ),
      }
    }
    return { authInfo }
  }
}
