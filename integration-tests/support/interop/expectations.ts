/**
 * Assertions run against the interop fixture, once per client implementation. Both clients
 * talk to the same surface, so the expected payloads are identical on either stack.
 */
import type { Client } from '@modelcontextprotocol/client'
import type { ContextClient } from '@mokei/context-client'
import { expect } from 'vitest'

import {
  GREETING_TEXT,
  GREETING_URI,
  greetingMessage,
  SERVER_NAME,
  SERVER_VERSION,
} from './fixture.ts'

/** Drives a mokei `ContextClient` against a fixture server, whichever stack serves it. */
export async function checkMokeiClient(client: ContextClient): Promise<void> {
  const initResult = await client.initialize()
  expect(initResult.serverInfo).toMatchObject({ name: SERVER_NAME, version: SERVER_VERSION })
  expect(initResult.protocolVersion).toBe('2025-11-25')

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
  expect(resources.map((resource) => resource.uri)).toEqual([GREETING_URI])

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
  expect(resources.map((resource) => resource.uri)).toEqual([GREETING_URI])

  const readResult = await client.readResource({ uri: GREETING_URI })
  expect(readResult.contents).toEqual([
    { uri: GREETING_URI, mimeType: 'text/plain', text: GREETING_TEXT },
  ])
}
