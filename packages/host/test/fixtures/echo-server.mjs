import { createTool, serveProcess } from '@mokei/context-server'

// Minimal stdio MCP server exposing one `echo` tool. Used by the framing
// happy-path test to prove valid JSONL frames (including large ones) pass the
// framer untouched. `repeat` lets a test request a big-but-bounded result.
const config = {
  name: 'echo',
  version: '0.0.0',
  protocolVersions: ['2025-11-25'],
  tools: {
    echo: createTool({
      description: 'Echo the given text back, optionally repeated',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          repeat: { type: 'integer', minimum: 1 },
        },
        required: ['text'],
        additionalProperties: false,
      },
      handler: (req) => {
        const { text, repeat = 1 } = req.input
        return { content: [{ type: 'text', text: text.repeat(repeat) }] }
      },
    }),
  },
}

serveProcess(config)
