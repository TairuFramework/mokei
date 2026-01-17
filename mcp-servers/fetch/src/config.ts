import type {
  ExtractServerTypes,
  Schema,
  ServerConfig,
  ToolDefinitions,
} from '@mokei/context-server'
import { createTool } from '@mokei/context-server'
import Turndown from 'turndown'
// @ts-expect-error no types
import { gfm } from 'turndown-plugin-gfm'

/**
 * Options for creating fetch tools.
 */
export type FetchToolsOptions = {
  /**
   * Custom Turndown service instance for HTML to markdown conversion.
   * If not provided, a default instance with GFM support is created.
   */
  turndownService?: Turndown
}

/**
 * Create a default Turndown service instance with GFM support.
 */
export function createTurndownService(): Turndown {
  return new Turndown().use(gfm).remove(['script', 'style'])
}

/**
 * Create fetch tool definitions.
 *
 * @example
 * ```typescript
 * import { createFetchTools } from '@mokei/mcp-fetch'
 *
 * const tools = createFetchTools()
 * ```
 */
export function createFetchTools(options: FetchToolsOptions = {}): ToolDefinitions {
  const turndownService = options.turndownService ?? createTurndownService()

  return {
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
        process.stderr.write(`fetching ${req.arguments.url}\n`)
        try {
          const res = await fetch(req.arguments.url)
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
  }
}

/**
 * Create a server config for the fetch MCP server.
 *
 * @example
 * ```typescript
 * import { createFetchConfig } from '@mokei/mcp-fetch'
 * import { ContextServer } from '@mokei/context-server'
 *
 * const config = createFetchConfig()
 * const server = new ContextServer({ ...config, transport })
 * ```
 */
export function createFetchConfig(options: FetchToolsOptions = {}) {
  return {
    name: 'fetch',
    version: '0.1.0',
    tools: createFetchTools(options),
  } as const satisfies ServerConfig
}

/**
 * Type-safe context types for the Fetch MCP server.
 *
 * @example
 * ```typescript
 * import type { FetchServerTypes } from '@mokei/mcp-fetch'
 * import { ContextClient } from '@mokei/context-client'
 *
 * const client = new ContextClient<FetchServerTypes>({ transport })
 * ```
 */
export type FetchServerTypes = ExtractServerTypes<ReturnType<typeof createFetchConfig>>
