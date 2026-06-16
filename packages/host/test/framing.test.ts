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

  test('reaps the context when a child prints a stray non-JSON line', async () => {
    const host = new ContextHost()
    const failures: Array<{ key: string; error: Error }> = []
    host.events.on('context:failed', (data) => {
      failures.push(data)
    })

    await host.addLocalContext({
      key: 'stray',
      command: process.execPath,
      // A single newline-terminated line that is not valid JSON.
      args: ['-e', 'process.stdout.write("not json at all\\n")'],
    })

    await host.setup('stray').catch(() => {})

    await vi.waitFor(() => {
      expect(failures).toHaveLength(1)
    })
    expect(failures[0]?.key).toBe('stray')
    expect(failures[0]?.error.message).toContain('Invalid JSON on context stdout')
    expect(host.getContextKeys()).not.toContain('stray')

    await host.dispose()
  })

  test('passes valid large frames through the framer untouched', async () => {
    const host = new ContextHost()
    let failed = 0
    host.events.on('context:failed', () => {
      failed += 1
    })

    await host.addLocalContext({
      key: 'echo',
      command: process.execPath,
      args: [new URL('./fixtures/echo-server.mjs', import.meta.url).pathname],
    })

    const tools = await host.setup('echo')
    expect(tools.map((t) => t.tool.name)).toContain('echo')

    // ~500 KiB result: well under the 8 MiB default cap, comfortably larger
    // than a single OS pipe buffer, so it exercises multi-chunk framing.
    const result = await host.callTool('echo', {
      name: 'echo',
      arguments: { text: 'abcd', repeat: 128 * 1024 },
    })
    const text = (result.content[0] as { type: 'text'; text: string }).text
    expect(text).toHaveLength(4 * 128 * 1024)

    expect(failed).toBe(0)
    await host.dispose()
  })

  test('emits context:failed exactly once on a framing fault', async () => {
    const host = new ContextHost()
    let failed = 0
    let removed = 0
    host.events.on('context:failed', () => {
      failed += 1
    })
    host.events.on('context:removed', () => {
      removed += 1
    })

    await host.addLocalContext({
      key: 'dedup',
      command: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(1_000_000))'],
      maxBufferSize: 64 * 1024,
    })

    await host.setup('dedup').catch(() => {})

    await vi.waitFor(() => {
      expect(removed).toBeGreaterThanOrEqual(1)
    })
    // Give the post-reap disposal readFailed + the onExit-from-kill a chance to
    // (wrongly) double-emit, so the assertion is meaningful.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(failed).toBe(1)

    await host.dispose()
  })
})
