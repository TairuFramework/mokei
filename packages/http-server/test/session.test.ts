import { describe, expect, test } from 'vitest'

import { SessionManager } from '../src/session.js'

describe('SessionManager', () => {
  test('creates session with unique ID', () => {
    const manager = new SessionManager({
      maxSessions: 10,
      sessionTimeoutMs: 60_000,
    })

    const session1 = manager.create()
    const session2 = manager.create()

    expect(session1.sessionID).toBeTruthy()
    expect(session2.sessionID).toBeTruthy()
    expect(session1.sessionID).not.toBe(session2.sessionID)
    expect(session1.server).toBeNull()
    expect(session1.getStream).toBeNull()
    expect(session1.postStreams).toBeInstanceOf(Map)
    expect(session1.postStreams.size).toBe(0)
    expect(session1.lastActivity).toBeGreaterThan(0)

    manager.dispose()
  })

  test('retrieves session by ID', () => {
    const manager = new SessionManager({
      maxSessions: 10,
      sessionTimeoutMs: 60_000,
    })

    const session = manager.create()
    const retrieved = manager.get(session.sessionID)

    expect(retrieved).toBe(session)

    manager.dispose()
  })

  test('returns undefined for unknown ID', () => {
    const manager = new SessionManager({
      maxSessions: 10,
      sessionTimeoutMs: 60_000,
    })

    const result = manager.get('nonexistent-id')
    expect(result).toBeUndefined()

    manager.dispose()
  })

  test('deletes a session', () => {
    const manager = new SessionManager({
      maxSessions: 10,
      sessionTimeoutMs: 60_000,
    })

    const session = manager.create()
    const id = session.sessionID

    manager.delete(id)
    expect(manager.get(id)).toBeUndefined()

    manager.dispose()
  })

  test('enforces max sessions limit', () => {
    const manager = new SessionManager({
      maxSessions: 2,
      sessionTimeoutMs: 60_000,
    })

    manager.create()
    manager.create()

    expect(() => manager.create()).toThrow()

    manager.dispose()
  })

  test('invokes onDelete when a session is explicitly removed', () => {
    const deleted: Array<string> = []
    const manager = new SessionManager({
      maxSessions: 10,
      sessionTimeoutMs: 60_000,
      onDelete: (id) => deleted.push(id),
    })

    const session = manager.create()
    manager.delete(session.sessionID)

    expect(deleted).toEqual([session.sessionID])
    // Idempotent: deleting an already-gone session does not fire onDelete again.
    manager.delete(session.sessionID)
    expect(deleted).toEqual([session.sessionID])

    manager.dispose()
  })

  test('fires onDelete for idle sessions via the cleanup timer', async () => {
    const deleted: Array<string> = []
    const manager = new SessionManager({
      maxSessions: 10,
      sessionTimeoutMs: 20,
      onDelete: (id) => deleted.push(id),
    })

    const session = manager.create()
    // Backdate activity so the next cleanup tick treats it as idle.
    session.lastActivity = Date.now() - 1000

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(deleted).toContain(session.sessionID)
    expect(manager.get(session.sessionID)).toBeUndefined()

    manager.dispose()
  })

  test('fires onDelete for every session on dispose', () => {
    const deleted: Array<string> = []
    const manager = new SessionManager({
      maxSessions: 10,
      sessionTimeoutMs: 60_000,
      onDelete: (id) => deleted.push(id),
    })

    const a = manager.create()
    const b = manager.create()
    manager.dispose()

    expect(deleted).toContain(a.sessionID)
    expect(deleted).toContain(b.sessionID)
  })

  test('updates lastActivity on touch', () => {
    const manager = new SessionManager({
      maxSessions: 10,
      sessionTimeoutMs: 60_000,
    })

    const session = manager.create()
    const originalActivity = session.lastActivity

    // Set activity back so touch() updates it
    session.lastActivity = originalActivity - 5000
    manager.touch(session.sessionID)

    expect(session.lastActivity).toBeGreaterThanOrEqual(originalActivity - 5000)
    expect(session.lastActivity).not.toBe(originalActivity - 5000)

    manager.dispose()
  })
})
