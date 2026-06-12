import { describe, expect, test, vi } from 'vitest'

import { ContextHost } from '../src/host.js'

describe('ContextHost lifecycle', () => {
  test('reaps a context and emits context:failed when its child exits non-zero, with no unhandled rejection', async () => {
    const unhandled: Array<unknown> = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    const host = new ContextHost()
    const failures: Array<{ key: string; error: Error }> = []
    host.events.on('context:failed', (data) => {
      failures.push(data)
    })

    await host.addLocalContext({
      key: 'boom',
      command: process.execPath,
      args: ['-e', 'process.exit(1)'],
    })

    await vi.waitFor(() => {
      expect(failures).toHaveLength(1)
    })
    expect(failures[0]?.key).toBe('boom')
    expect(host.getContextKeys()).not.toContain('boom')

    // Give any stray rejection a tick to surface.
    await new Promise((resolve) => setTimeout(resolve, 50))
    process.off('unhandledRejection', onUnhandled)
    expect(unhandled).toHaveLength(0)

    await host.dispose()
  })

  test('emits context:added and context:removed without context:failed on a clean removal', async () => {
    const host = new ContextHost()
    const added: Array<string> = []
    const removed: Array<string> = []
    let failed = 0
    host.events.on('context:added', ({ key }) => added.push(key))
    host.events.on('context:removed', ({ key }) => removed.push(key))
    host.events.on('context:failed', () => {
      failed += 1
    })

    await host.addLocalContext({
      key: 'alive',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1e9)'],
    })
    expect(added).toContain('alive')

    await host.remove('alive')
    expect(removed).toContain('alive')
    // Killing our own child (SIGTERM) must not be reported as a failure.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(failed).toBe(0)

    await host.dispose()
  })
})
