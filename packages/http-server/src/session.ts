import type { ContextServer } from '@mokei/context-server'

import type { SSEEvent, SSEWriter } from './sse-writer.js'

export type Session = {
  sessionID: string
  server: ContextServer | null
  postStreams: Map<string | number, SSEWriter>
  getStream: SSEWriter | null
  lastActivity: number
  replayLog: Array<SSEEvent>
}

export type SessionManagerParams = {
  maxSessions: number
  sessionTimeoutMs: number
}

export class SessionManager {
  #sessions: Map<string, Session> = new Map()
  #maxSessions: number
  #sessionTimeoutMs: number
  #cleanupInterval: ReturnType<typeof setInterval>

  constructor(params: SessionManagerParams) {
    this.#maxSessions = params.maxSessions
    this.#sessionTimeoutMs = params.sessionTimeoutMs
    this.#cleanupInterval = setInterval(() => this.#cleanup(), this.#sessionTimeoutMs)
    this.#cleanupInterval.unref()
  }

  create(): Session {
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

  delete(sessionID: string): void {
    const session = this.#sessions.get(sessionID)
    if (session == null) {
      return
    }

    if (session.server != null) {
      session.server.dispose()
    }

    for (const writer of session.postStreams.values()) {
      writer.close()
    }

    if (session.getStream != null) {
      session.getStream.close()
    }

    this.#sessions.delete(sessionID)
  }

  dispose(): void {
    clearInterval(this.#cleanupInterval)
    for (const sessionID of this.#sessions.keys()) {
      this.delete(sessionID)
    }
  }

  #cleanup(): void {
    const now = Date.now()
    for (const [sessionID, session] of this.#sessions) {
      if (now - session.lastActivity > this.#sessionTimeoutMs) {
        this.delete(sessionID)
      }
    }
  }
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
  // every buffered event rather than silently delivering nothing — the client
  // can dedupe by id, but it cannot recover events it never receives.
  return index === -1 ? session.replayLog.slice() : session.replayLog.slice(index + 1)
}
