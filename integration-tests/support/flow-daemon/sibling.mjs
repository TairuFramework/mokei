import { appendFileSync } from 'node:fs'
import { createTool } from '@mokei/context-server'
import { serveProcess } from '@mokei/context-server-node'

const record = (event) =>
  appendFileSync(process.argv[2], `${JSON.stringify({ pid: process.pid, ...event })}\n`)
record({ type: 'started' })
process.stdin.once('end', () => process.exit(0))
serveProcess({
  name: 'flow-daemon-sibling',
  version: '1.0.0',
  protocolVersions: ['2026-07-28', '2025-11-25'],
  tools: {
    echo: createTool({
      description: 'Echo a deterministic value',
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      },
      handler: ({ input }) => {
        record({ type: 'echo', value: input.value })
        return { content: [{ type: 'text', text: input.value }] }
      },
    }),
  },
})
