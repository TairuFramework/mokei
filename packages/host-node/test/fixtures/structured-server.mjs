import { createTool } from '@mokei/context-server'
import { serveProcess } from '@mokei/context-server-node'

const config = {
  name: 'structured',
  version: '0.0.0',
  protocolVersions: ['2026-07-28', '2025-11-25'],
  tools: {
    count: createTool({
      description: 'Count the characters in the given text',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: { count: { type: 'number' } },
        required: ['count'],
      },
      handler: (req) => ({ structuredContent: { count: req.input.text.length } }),
    }),
  },
}

serveProcess(config)
