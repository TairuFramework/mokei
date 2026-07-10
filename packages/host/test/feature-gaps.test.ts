import { describe, expect, test } from "vitest"

import { ContextHost } from "../src/index.js"

function fixture(name: string): string {
  return new URL(`./fixtures/${name}`, import.meta.url).pathname
}

describe("MCP feature gaps, end to end", () => {
  test("host.setup aggregates every page from a paginating server", async () => {
    const host = new ContextHost()
    await host.addLocalContext({
      key: "paged",
      command: process.execPath,
      args: [fixture("paginating-server.mjs")],
    })

    const tools = await host.setup("paged")
    expect(tools.map((contextTool) => contextTool.tool.name)).toEqual(["alpha", "beta", "gamma"])

    await host.dispose()
  })

  test("a structured tool result survives spawn, setup, and callTool", async () => {
    const host = new ContextHost()
    await host.addLocalContext({
      key: "structured",
      command: process.execPath,
      args: [fixture("structured-server.mjs")],
    })
    await host.setup("structured")

    const result = await host.callTool("structured", {
      name: "count",
      arguments: { text: "hello" },
    })

    expect(result.structuredContent).toEqual({ count: 5 })
    expect(result.content).toEqual([{ type: 'text', text: '{"count":5}' }])

    await host.dispose()
  })
})