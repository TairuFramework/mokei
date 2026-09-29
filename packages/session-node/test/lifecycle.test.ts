import { execPath } from 'node:process'
import { describe, expect, test } from 'vitest'

import { NodeSession } from '../src/node-session.js'

describe('NodeSession.addContext abort', () => {
  test('leaves no context behind when aborted mid-setup', async () => {
    const session = new NodeSession()
    const controller = new AbortController()

    const promise = session
      .addContext({
        key: 'aborted',
        command: execPath,
        args: ['-e', 'setInterval(() => {}, 1e9)'],
        signal: controller.signal,
      })
      .catch(() => {})

    // Abort almost immediately, racing the spawn/registration.
    controller.abort()
    await promise

    // Give a late-registering spawn a chance to surface, then assert cleanup.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(session.contextHost.getContextKeys()).not.toContain('aborted')

    await session.contextHost.dispose()
  })
})

describe('NodeSession elicitation', () => {
  test('NodeSession builds an elicitation-enabled NodeContextHost', async () => {
    const session = new NodeSession({ elicit: true })

    expect(session.contextHost.elicitationEnabled).toBe(true)
    await session.dispose()
  })

  test('NodeSession rejects contextHost together with elicit', async () => {
    const contextHost = new NodeSession().contextHost

    expect(() => new NodeSession({ contextHost, elicit: true })).toThrow(/contextHost.*elicit/i)
    await contextHost.dispose()
  })

  test('default Session and NodeSession remain disabled', async () => {
    const session = new NodeSession()

    expect(session.contextHost.elicitationEnabled).toBe(false)
    await session.dispose()
  })
})
