import type { RequestID } from '@mokei/context-protocol'
import type { ContextServer } from '@mokei/context-server'
import type { AuthInfo } from '@teikyo/oauth'

import type { SSEEvent, SSEWriter } from './sse-writer.js'

export type Session = {
  sessionID: string
  server: ContextServer | null
  postStreams: Map<string | number, SSEWriter>
  getStream: SSEWriter | null
  lastActivity: number
  replayLog: Array<SSEEvent>
  /**
   * The verified identity that opened the session. Every later request naming the session must
   * carry the same issuer and subject; one that does not is answered as if the session did not
   * exist. Absent when the session was opened without auth.
   */
  owner?: { issuer?: string; subject: string }
  /** Auth of each in-flight request by JSON-RPC id, read by the session server's `resolveAuth`
   * and dropped once that id's response is written. */
  requestAuth: Map<RequestID, AuthInfo>
}

export type SessionManagerParams = {
  maxSessions: number
  sessionTimeoutMs: number
  /**
   * Called whenever a session is removed -- by the idle-cleanup timer, explicit
   * deletion, or {@link SessionManager.dispose}. Lets the handler release the
   * matching transport bridge so timed-out sessions don't leak it.
   */
  onDelete?: (sessionID: string) => void
}

export class SessionManager {
  #sessions: Map<string, Session> = new Map()
  #maxSessions: number
  #sessionTimeoutMs: number
  #onDelete: ((sessionID: string) => void) | undefined
  #cleanupInterval: ReturnType<typeof setInterval>

  constructor(params: SessionManagerParams) {
    this.#maxSessions = params.maxSessions
    this.#sessionTimeoutMs = params.sessionTimeoutMs
    this.#onDelete = params.onDelete
    this.#cleanupInterval = setInterval(() => this.#cleanup(), this.#sessionTimeoutMs)
    this.#cleanupInterval.unref()
  }

  create(auth?: AuthInfo): Session {
    if (this.#sessions.size >= this.#maxSessions) {
      throw new Error(`Maximum sessions limit reached (${this.#maxSessions})`)
    }

    const session: Session = {
      sessionID: globalThis.crypto.randomUUID(),
      server: null,
      postStreams: new Map(),
      getStream: null,
      lastActivity: Date.now(),
      replayLog: [],
      requestAuth: new Map(),
    }
    if (auth != null) {
      session.owner = {
        ...(auth.issuer == null ? {} : { issuer: auth.issuer }),
        subject: auth.subject,
      }
    }

    this.#sessions.set(session.sessionID, session)
    return session
  }

  get(sessionID: string): Session | undefined {
    return this.#sessions.get(sessionID)
  }

  touch(sessionID: string): void {
    const session = this.#sessions.get(sessionID)
    if (session != null) {
      session.lastActivity = Date.now()
    }
  }

  async delete(sessionID: string): Promise<void> {
    const session = this.#sessions.get(sessionID)
    if (session == null) {
      return
    }

    // Remove from the registry first: server disposal now awaits (it flushes any held
    // `subscriptions/listen` terminals), so a concurrent or re-entrant delete must find nothing
    // rather than race a second disposal of the same server.
    this.#sessions.delete(sessionID)

    if (session.server != null) {
      await session.server.dispose()
    }

    for (const writer of session.postStreams.values()) {
      writer.close()
    }

    if (session.getStream != null) {
      session.getStream.close()
    }

    session.requestAuth.clear()

    // Notify the owner last, after the session's own resources are released, so
    // the bridge is torn down for timer-driven cleanup as well as explicit deletes.
    this.#onDelete?.(sessionID)
  }

  async dispose(): Promise<void> {
    clearInterval(this.#cleanupInterval)
    // Await every session's disposal (server flush included) so a caller awaiting `dispose()`
    // knows teardown has actually completed. A snapshot of the ids, since `delete` mutates the map.
    await Promise.all([...this.#sessions.keys()].map((sessionID) => this.delete(sessionID)))
  }

  #cleanup(): void {
    const now = Date.now()
    for (const [sessionID, session] of this.#sessions) {
      if (now - session.lastActivity > this.#sessionTimeoutMs) {
        // The idle timer is fire-and-forget: it cannot await, and a failed disposal has nobody
        // to report to. `delete` still removes the session synchronously before its first await.
        void this.delete(sessionID)
      }
    }
  }
}

/**
 * Whether `auth` is the identity that opened `session`: the same issuer and subject, or no auth
 * on either side. Scopes may differ, since a refreshed token can carry a different grant.
 */
export function isSessionOwner(session: Session, auth: AuthInfo | undefined): boolean {
  const owner = session.owner
  if (owner == null || auth == null) return owner == null && auth == null
  return owner.issuer === auth.issuer && owner.subject === auth.subject
}

export function appendReplay(session: Session, event: SSEEvent, cap: number): void {
  session.replayLog.push(event)
  if (session.replayLog.length > cap) {
    session.replayLog.splice(0, session.replayLog.length - cap)
  }
}

export function eventsAfter(session: Session, lastEventID: string): Array<SSEEvent> {
  const index = session.replayLog.findIndex((e) => e.id === lastEventID)
  // When the id is unknown (e.g. trimmed beyond the cap), fall back to replaying
  // every buffered event rather than silently delivering nothing -- the client
  // can dedupe by id, but it cannot recover events it never receives.
  return index === -1 ? session.replayLog.slice() : session.replayLog.slice(index + 1)
}
