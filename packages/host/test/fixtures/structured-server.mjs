import { createTool, serveProcess } from '@mokei/context-server'

const config = {
  name: 'structured',
  version: '0.0.0',
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
      handler: (req) => ({ structuredContent: { count: req.arguments.text.length } }),
    }),
  },
}

serveProcess(config)
