import { describe, expect, test } from 'vitest'

import { ContextHost, spawnHostedContext } from '../src/index.js'

function fixture(name: string): string {
  return new URL(`./fixtures/${name}`, import.meta.url).pathname
}

describe('MCP feature gaps, end to end', () => {
  test('host.setup aggregates every page from a paginating server', async () => {
    const host = new ContextHost()
    await host.addLocalContext({
      key: 'paged',
      command: process.execPath,
      args: [fixture('paginating-server.mjs')],
    })

    const tools = await host.setup({ key: 'paged' })
    expect(tools.map((contextTool) => contextTool.tool.name)).toEqual(['alpha', 'beta', 'gamma'])

    await host.dispose()
  })

  // The paginating fixture answers `initialize` unconditionally, but `2026-07-28` never sends
  // `initialize` — it probes with `server/discover` instead. Pinning the client to `2026-07-28`
  // here (via the lower-level `spawnHostedContext`, since `ContextHost.addLocalContext` does not
  // expose `protocolVersion`) makes a missing `server/discover` handler in the fixture fail
  // loudly on its own, regardless of what protocol version the host defaults to elsewhere.
  test('a paginating server pinned to 2026-07-28 still answers every page', async () => {
    const context = await spawnHostedContext({
      command: process.execPath,
      args: [fixture('paginating-server.mjs')],
      protocolVersion: '2026-07-28',
    })

    const { tools } = await context.client.listTools()
    expect(tools.map((tool) => tool.name)).toEqual(['alpha', 'beta', 'gamma'])

    await context.disposer.dispose()
  })

  test('a structured tool result survives spawn, setup, and callTool', async () => {
    const host = new ContextHost()
    await host.addLocalContext({
      key: 'structured',
      command: process.execPath,
      args: [fixture('structured-server.mjs')],
    })
    await host.setup({ key: 'structured' })

    const result = await host.callTool({
      key: 'structured',
      name: 'count',
      arguments: { text: 'hello' },
    })

    expect(result.structuredContent).toEqual({ count: 5 })
    expect(result.content).toEqual([{ type: 'text', text: '{"count":5}' }])

    await host.dispose()
  })
})
