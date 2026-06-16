import { createTool, serveProcess } from '@mokei/context-server'

// Minimal stdio MCP server exposing one `echo` tool. Used by the framing
// happy-path test to prove valid JSONL frames (including large ones) pass the
// framer untouched. `repeat` lets a test request a big-but-bounded result.
const config = {
  name: 'echo',
  version: '0.0.0',
  tools: {
    echo: createTool(
      'Echo the given text back, optionally repeated',
      {
        type: 'object',
        properties: {
          text: { type: 'string' },
          repeat: { type: 'integer', minimum: 1 },
        },
        required: ['text'],
        additionalProperties: false,
      },
      (req) => {
        const { text, repeat = 1 } = req.arguments
        return { content: [{ type: 'text', text: text.repeat(repeat) }] }
      },
    ),
  },
}

serveProcess(config)
