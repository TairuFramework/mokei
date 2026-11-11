import { createRuntime } from '@sozai/runtime'
import { expect, test, vi } from 'vitest'

import { ContextHost } from '../src/index.js'

test('addHTTPContext sends through the given runtime fetch', async () => {
  const fetch = vi.fn(async () => new Response('unavailable', { status: 503 }))
  const host = new ContextHost()
  try {
    host.addHTTPContext({
      key: 'remote',
      url: 'https://mcp.example.test/mcp',
      protocolVersion: '2026-07-28',
      timeout: 500,
      runtime: createRuntime({ fetch }),
    })
    await host.setup({ key: 'remote' }).catch(() => undefined)
    expect(fetch).toHaveBeenCalled()
    expect(String((fetch.mock.calls[0] as unknown as [string])[0])).toBe(
      'https://mcp.example.test/mcp',
    )
  } finally {
    await host.dispose()
  }
})
