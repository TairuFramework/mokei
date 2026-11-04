import type { RequestID } from '@mokei/context-protocol'

import type { TaskOwner } from './task-store.js'

/**
 * Verified caller identity as a handler sees it on `request.auth`.
 *
 * `claims` holds the token verifier's decoded claims. The verifier checked their signature, but
 * their shape is verifier-specific (JWT claims for a JWKS verifier, DID token payload for a DID
 * verifier). They are never stored with task ownership.
 */
export type RequestAuth = TaskOwner & {
  /** Expiry of the token that carried this request, in seconds since the epoch. */
  expiresAt?: number
  claims?: Readonly<Record<string, unknown>>
}

/**
 * Auth a transport hands a `ContextServer`. A `@teikyo/oauth` `AuthInfo` fits as-is: an object
 * `raw` surfaces as {@link RequestAuth.claims} when `claims` is absent.
 */
export type ServerAuth = TaskOwner & {
  expiresAt?: number
  claims?: Readonly<Record<string, unknown>>
  raw?: unknown
}

/** Resolves the auth of one inbound request by its JSON-RPC id. */
export type ResolveAuth = (requestID: RequestID) => ServerAuth | undefined

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Copies `auth` into the frozen shape handlers receive, so a handler cannot mutate the
 * transport's record (or another request's view of it). */
export function toRequestAuth(auth: ServerAuth | undefined): RequestAuth | undefined {
  if (auth == null) return undefined
  const claims = auth.claims ?? (isPlainObject(auth.raw) ? auth.raw : undefined)
  return Object.freeze({
    ...(auth.issuer == null ? {} : { issuer: auth.issuer }),
    subject: auth.subject,
    scopes: Object.freeze([...auth.scopes]) as Array<string>,
    ...(auth.expiresAt == null ? {} : { expiresAt: auth.expiresAt }),
    ...(claims == null ? {} : { claims: Object.freeze({ ...claims }) }),
  })
}

/** The part of {@link RequestAuth} that identifies a task owner. */
export function toTaskOwner(auth: RequestAuth | undefined): TaskOwner | undefined {
  if (auth == null) return undefined
  return {
    ...(auth.issuer == null ? {} : { issuer: auth.issuer }),
    subject: auth.subject,
    scopes: [...auth.scopes],
  }
}

/** The scopes in `required` that `granted` lacks, in `required` order, without duplicates. */
export function missingScopes(
  required: ReadonlyArray<string>,
  granted: ReadonlyArray<string>,
): Array<string> {
  const held = new Set(granted)
  return [...new Set(required)].filter((scope) => !held.has(scope))
}

/** `data.error` of the JSON-RPC error a call lacking a tool's scopes fails with. */
export const INSUFFICIENT_SCOPE = 'insufficient_scope'
