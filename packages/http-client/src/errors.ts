/**
 * Raised when the server reports the session is gone (HTTP 404 with an active
 * Mcp-Session-Id). The client layer should start a new session via initialize.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super('MCP session expired; re-initialize to start a new session')
    this.name = 'SessionExpiredError'
  }
}
