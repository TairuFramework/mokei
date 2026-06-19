import { describe, expect, test, vi } from 'vitest'
import { ContextHost, spawnHostedContext } from '../src/host.js'

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

describe('spawnHostedContext dispose escalation', () => {
  test('escalates to SIGKILL when the child ignores SIGTERM, and awaits real exit', async () => {
    // Child traps SIGTERM and never exits on its own.
    const ctx = await spawnHostedContext({
      command: process.execPath,
      args: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1e9)"],
      killTimeout: 300,
    })

    // Give the child process time to finish V8 startup and register its
    // SIGTERM handler before we dispose.  On a fast machine the 'spawn' event
    // fires before the child script has run, so without this wait SIGTERM
    // would arrive before process.on('SIGTERM', …) executes and the default
    // handler would terminate the child immediately.
    await new Promise((resolve) => setTimeout(resolve, 200))

    const start = Date.now()
    await ctx.disposer.dispose()
    const elapsed = Date.now() - start

    // dispose must have waited for the kill deadline, then SIGKILLed and
    // awaited the real exit — i.e. it did not resolve immediately.
    expect(elapsed).toBeGreaterThanOrEqual(250)
  })

  test('exits on SIGTERM without escalating for a well-behaved child', async () => {
    const ctx = await spawnHostedContext({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1e9)'],
      killTimeout: 2000,
    })
    const start = Date.now()
    await ctx.disposer.dispose()
    // Resolves well before the 2s deadline because SIGTERM is honored.
    expect(Date.now() - start).toBeLessThan(1500)
  })
})
