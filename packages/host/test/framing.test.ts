import { describe, expect, test, vi } from 'vitest'

import { ContextHost } from '../src/host.js'

describe('ContextHost stdio framing', () => {
  test('reaps the context when a child floods stdout past maxBufferSize', async () => {
    const unhandled: Array<unknown> = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    const host = new ContextHost()
    const failures: Array<{ key: string; error: Error }> = []
    host.events.on('context:failed', (data) => {
      failures.push(data)
    })

    await host.addLocalContext({
      key: 'flood',
      command: process.execPath,
      // Emit one giant un-terminated line (no newline) far past the cap.
      args: ['-e', 'process.stdout.write("x".repeat(1_000_000))'],
      maxBufferSize: 64 * 1024,
    })

    // Trigger the lazy initialize read so the framer pulls the flood. The child
    // never speaks MCP, so setup() rejects — we assert on the event, not this.
    await host.setup('flood').catch(() => {})

    await vi.waitFor(() => {
      expect(failures).toHaveLength(1)
    })
    expect(failures[0]?.key).toBe('flood')
    expect(host.getContextKeys()).not.toContain('flood')

    await new Promise((resolve) => setTimeout(resolve, 50))
    process.off('unhandledRejection', onUnhandled)
    expect(unhandled).toHaveLength(0)

    await host.dispose()
  })
})
