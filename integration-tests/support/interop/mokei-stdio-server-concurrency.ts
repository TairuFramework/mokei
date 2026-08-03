/**
 * Stdio entry point for the concurrency test, on `2026-07-28`.
 *
 * `slow` sleeps; `quick` returns at once. A server that reads one message at a time answers
 * `quick` only after `slow`'s sleep expires — which is what this fixture exists to detect.
 */
import { createTool, serveProcess } from '@mokei/context-server'

const SLOW_MS = 5_000

const noArguments = { type: 'object', properties: {}, additionalProperties: false } as const

serveProcess({
  name: 'mokei-concurrency-fixture',
  version: '1.0.0',
  protocolVersions: ['2026-07-28'],
  tools: {
    slow: createTool({
      description: 'Returns after a long sleep',
      inputSchema: noArguments,
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, SLOW_MS))
        return { content: [{ type: 'text' as const, text: 'slow' }] }
      },
    }),
    quick: createTool({
      description: 'Returns immediately',
      inputSchema: noArguments,
      handler: () => ({ content: [{ type: 'text' as const, text: 'quick' }] }),
    }),
  },
})
