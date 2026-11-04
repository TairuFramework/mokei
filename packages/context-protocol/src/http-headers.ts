/**
 * The body field each method's `Mcp-Name` request header mirrors on `2026-07-28` Streamable HTTP
 * (SEP-2243 standard request headers, plus SEP-2663's `tasks/*` binding). The client that writes
 * the header and the server that checks it both read this table, so the two cannot drift. A
 * `Map`, so a peer-supplied method such as `constructor` never matches an inherited key.
 */
export const MCP_NAME_HEADER_SOURCE: ReadonlyMap<string, string> = new Map([
  ['tools/call', 'name'],
  ['prompts/get', 'name'],
  ['resources/read', 'uri'],
  ['tasks/get', 'taskId'],
  ['tasks/update', 'taskId'],
  ['tasks/cancel', 'taskId'],
])
