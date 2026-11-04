import { MCP_NAME_HEADER_SOURCE } from '@mokei/context-protocol'

/**
 * The SEP-2243 `Mcp-Method` and `Mcp-Name` headers a `2026-07-28` client sends for a request,
 * for tests that build their POSTs by hand. Names in these tests are plain ASCII, so `Mcp-Name`
 * is never Base64-wrapped.
 */
export function mcpHeaders(
  method: string,
  params: Record<string, unknown> = {},
): Record<string, string> {
  const field = MCP_NAME_HEADER_SOURCE.get(method)
  const name = field == null ? undefined : params[field]
  return { 'Mcp-Method': method, ...(typeof name === 'string' ? { 'Mcp-Name': name } : {}) }
}

/** {@link mcpHeaders} plus the `2026-07-28` `MCP-Protocol-Version` header. */
export function statelessHeaders(
  method: string,
  params: Record<string, unknown> = {},
): Record<string, string> {
  return { 'MCP-Protocol-Version': '2026-07-28', ...mcpHeaders(method, params) }
}
