/** Canonical MCP resource (RFC 8707): scheme + host + port + path, no query/fragment. */
export function canonicalResource(url: string): string {
  const u = new URL(url)
  u.search = ''
  u.hash = ''
  // Preserve an explicit trailing slash only when the path is exactly '/'.
  return u.toString().replace(/\/$/, u.pathname === '/' ? '/' : '')
}
