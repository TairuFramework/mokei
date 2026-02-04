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

  test('updates lastActivity on touch', () => {
    const manager = new SessionManager({
      maxSessions: 10,
      sessionTimeoutMs: 60_000,
    })

    const session = manager.create()
    const originalActivity = session.lastActivity

    // Advance time slightly
    const later = originalActivity + 1000
    session.lastActivity = originalActivity - 5000 // Set it back
    manager.touch(session.sessionID)

    expect(session.lastActivity).toBeGreaterThanOrEqual(originalActivity - 5000)
    expect(session.lastActivity).not.toBe(originalActivity - 5000)

    manager.dispose()
  })
})
