/**
 * Fetch MCP server - fetch URLs and convert to markdown.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/mcp-fetch
 * ```
 *
 * ## Usage as Library
 *
 * ```typescript
 * import { createFetchConfig, createFetchTools } from '@mokei/mcp-fetch'
 * import { toolsToLocalTools } from '@mokei/host'
 * import { Session } from '@mokei/session'
 *
 * // Use as local tools in a session
 * const session = new Session({
 *   localTools: toolsToLocalTools(createFetchTools())
 * })
 *
 * // Or create a server config
 * const config = createFetchConfig()
 * ```
 *
 * ## Usage as MCP Server
 *
 * ```sh
 * npx @mokei/mcp-fetch
 * ```
 *
 * @module mcp-fetch
 */

export {
  createFetchConfig,
  createFetchTools,
  createTurndownService,
  type FetchServerTypes,
  type FetchToolsOptions,
} from './config.js'
