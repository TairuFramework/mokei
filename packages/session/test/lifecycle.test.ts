import { describe, expect, test } from 'vitest'

import { Session } from '../src/session.js'

describe('Session.addContext abort', () => {
  test('leaves no context behind when aborted mid-setup', async () => {
    const session = new Session()
    const controller = new AbortController()

    const promise = session
      .addContext({
        key: 'aborted',
        command: process.execPath,
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
