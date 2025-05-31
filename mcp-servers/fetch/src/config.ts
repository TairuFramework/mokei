import { type Schema, type ServerConfig, createTool } from '@mokei/context-server'
import Turndown from 'turndown'
// @ts-expect-error no types
import { gfm } from 'turndown-plugin-gfm'

const turndownService = new Turndown().use(gfm).remove(['script', 'style'])

export const config: ServerConfig = {
  name: 'fetch',
  version: '0.1.0',
  tools: {
    get_markdown: createTool(
      'Fetch a URL and return its contents as markdown',
      {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri', description: 'HTTP URL to fetch contents from' },
        },
        required: ['url'],
        additionalProperties: false,
      } as const satisfies Schema,
      async (req) => {
        process.stderr.write(`fetching ${req.input.url}\n`)
        try {
          const res = await fetch(req.input.url)
          if (!res.ok) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Failed to fetch with response status ${res.status}: ${res.statusText}`,
                },
              ],
              isError: true,
            }
          }

          const text = await res.text()
          const markdown = turndownService.turndown(text)

          return { content: [{ type: 'text', text: markdown }], isError: false }
        } catch (err) {
          return {
            content: [{ type: 'text', text: (err as Error).message ?? 'Unknown error' }],
            isError: true,
          }
        }
      },
    ),
  },
}
