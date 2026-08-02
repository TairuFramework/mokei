/**
 * Assertions run against the interop fixture, once per client implementation. Both clients
 * talk to the same surface, so the expected payloads are identical on either stack.
 */
import type { Client } from '@modelcontextprotocol/client'
import type { ContextClient } from '@mokei/context-client'
import type { ProtocolVersion } from '@mokei/context-protocol'
import { expect } from 'vitest'

import {
  GREETING_TEXT,
  GREETING_URI,
  greetingMessage,
  SERVER_NAME,
  SERVER_VERSION,
} from './fixture.ts'

export type CheckMokeiClientOptions = {
  /**
   * Revision to check the handshake for. `'2025-11-25'` (the default) asserts the
   * `initialize()` result; `'2026-07-28'` has no handshake to assert (`initialize()` throws
   * on that revision — see `ContextClient#initialize`, `packages/context-client/src/client.ts`)
   * so this block is skipped and the caller is expected to assert `discover()` itself, since
   * that assertion differs by what's driving it (a plain equality check vs. an SDK schema).
   */
  protocolVersion?: ProtocolVersion
}

/**
 * Drives a mokei `ContextClient` against a fixture server, whichever stack serves it. Every
 * tool, prompt and resource assertion below is identical across both revisions — only the
 * handshake-specific block up front differs, gated by `options.protocolVersion`.
 */
export async function checkMokeiClient(
  client: ContextClient,
  options: CheckMokeiClientOptions = {},
): Promise<void> {
  const protocolVersion = options.protocolVersion ?? '2025-11-25'
  if (protocolVersion === '2025-11-25') {
    const initResult = await client.initialize()
    expect(initResult.serverInfo).toMatchObject({ name: SERVER_NAME, version: SERVER_VERSION })
    expect(initResult.protocolVersion).toBe('2025-11-25')
  }

  const { tools } = await client.listTools()
  expect(tools.map((tool) => tool.name).sort()).toEqual(['echo', 'sum'])
  const sumTool = tools.find((tool) => tool.name === 'sum')
  expect(sumTool?.outputSchema).toMatchObject({ type: 'object' })

  const echoResult = await client.callTool({ name: 'echo', arguments: { text: 'hello interop' } })
  expect(echoResult.content).toEqual([{ type: 'text', text: 'hello interop' }])

  const sumResult = await client.callTool({ name: 'sum', arguments: { a: 2, b: 3 } })
  expect(sumResult.structuredContent).toEqual({ total: 5 })

  const { prompts } = await client.listPrompts()
  expect(prompts.map((prompt) => prompt.name)).toEqual(['greet'])

  const promptResult = await client.getPrompt({ name: 'greet', arguments: { name: 'Ada' } })
  expect(promptResult.messages).toEqual([
    { role: 'user', content: { type: 'text', text: greetingMessage('Ada') } },
  ])

  const { resources } = await client.listResources()
  // `toContain`, not an exact list: the SDK fixture also serves the non-ASCII resource the
  // `Mcp-Name` conformance test reads, and this helper runs against both stacks. The resource
  // *sets* the two fixtures expose already differ deliberately — see `fixture.ts`'s header.
  expect(resources.map((resource) => resource.uri)).toContain(GREETING_URI)

  const readResult = await client.readResource({ uri: GREETING_URI })
  expect(readResult.contents).toEqual([
    { uri: GREETING_URI, mimeType: 'text/plain', text: GREETING_TEXT },
  ])
}

/** Drives an SDK v2 `Client` against a fixture server, whichever stack serves it. */
export async function checkSDKClient(client: Client): Promise<void> {
  expect(client.getServerVersion()).toMatchObject({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  })
  expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25')

  const { tools } = await client.listTools()
  expect(tools.map((tool) => tool.name).sort()).toEqual(['echo', 'sum'])
  const sumTool = tools.find((tool) => tool.name === 'sum')
  expect(sumTool?.outputSchema).toMatchObject({ type: 'object' })

  const echoResult = await client.callTool({ name: 'echo', arguments: { text: 'hello interop' } })
  expect(echoResult.content).toEqual([{ type: 'text', text: 'hello interop' }])

  const sumResult = await client.callTool({ name: 'sum', arguments: { a: 2, b: 3 } })
  expect(sumResult.structuredContent).toEqual({ total: 5 })

  const { prompts } = await client.listPrompts()
  expect(prompts.map((prompt) => prompt.name)).toEqual(['greet'])

  const promptResult = await client.getPrompt({ name: 'greet', arguments: { name: 'Ada' } })
  expect(promptResult.messages).toEqual([
    { role: 'user', content: { type: 'text', text: greetingMessage('Ada') } },
  ])

  const { resources } = await client.listResources()
  // `toContain`, not an exact list: the SDK fixture also serves the non-ASCII resource the
  // `Mcp-Name` conformance test reads, and this helper runs against both stacks. The resource
  // *sets* the two fixtures expose already differ deliberately — see `fixture.ts`'s header.
  expect(resources.map((resource) => resource.uri)).toContain(GREETING_URI)

  const readResult = await client.readResource({ uri: GREETING_URI })
  expect(readResult.contents).toEqual([
    { uri: GREETING_URI, mimeType: 'text/plain', text: GREETING_TEXT },
  ])
}
