import { toB64U } from '@sozai/codec'

// biome-ignore lint/style/useNamingConvention: PKCE is the RFC 7636 acronym
export type PKCE = { verifier: string; challenge: string; method: 'S256' }

export async function challengeFromVerifier(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toB64U(new Uint8Array(digest))
}

export async function createPKCE(): Promise<PKCE> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const verifier = toB64U(bytes)
  return { verifier, challenge: await challengeFromVerifier(verifier), method: 'S256' }
}
