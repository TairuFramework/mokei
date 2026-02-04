import type { ContextServer } from '@mokei/context-server'

import type { SSEWriter } from './sse-writer.js'

export type Session = {
  readonly sessionID: string
  server: ContextServer | null
  readonly postStreams: Map<string | number, SSEWriter>
  getStream: SSEWriter | null
  lastActivity: number
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
