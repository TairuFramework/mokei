import { Transport } from '@enkaku/transport'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'

import { buildHttpHeaders, type HttpAuthOptions } from './http-context.js'

/**
 * Parameters for creating an MCP HTTP transport.
 */
export type McpHttpTransportParams = {
  /** URL of the MCP HTTP endpoint */
  url: string
  /** Optional custom headers */
  headers?: Record<string, string>
  /** Optional authentication */
  auth?: HttpAuthOptions
  /** Request timeout in milliseconds */
  timeout?: number
}

/**
 * HTTP Transport for MCP (Model Context Protocol).
 *
 * Implements the MCP Streamable HTTP transport specification:
 * - POST requests for sending JSON-RPC messages
 * - Handles session management via Mcp-Session-Id header
 * - Supports JSON responses (SSE streaming to be added later)
 */
export class McpHttpTransport extends Transport<ServerMessage, ClientMessage> {
  #url: string
  #headers: Record<string, string>
  #timeout: number
  #sessionId: string | null = null
  #disposed = false
  #controller: ReadableStreamDefaultController<ServerMessage> | null = null

  constructor(params: McpHttpTransportParams) {
    // Create the transport stream pair
    const { readable, writable, controller } = createMcpTransportStreams<
      ServerMessage,
      ClientMessage
    >((message) => this.#sendMessage(message))

    super({ stream: { readable, writable } })

    this.#url = params.url
    this.#headers = buildHttpHeaders(params.headers, params.auth)
    this.#timeout = params.timeout ?? 30000
    this.#controller = controller
  }

  /**
   * Get the current session ID.
   */
  get sessionId(): string | null {
    return this.#sessionId
  }

  /**
   * Send a JSON-RPC message to the server via HTTP POST.
   */
  async #sendMessage(message: ClientMessage): Promise<void> {
    if (this.#disposed) {
      throw new Error('Transport is disposed')
    }

    const headers: Record<string, string> = {
      ...this.#headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
    }

    // Include session ID if we have one
    if (this.#sessionId) {
      headers['Mcp-Session-Id'] = this.#sessionId
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.#timeout)

    try {
      const response = await fetch(this.#url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      })

      // Store session ID from response if provided
      const newSessionId = response.headers.get('Mcp-Session-Id')
      if (newSessionId) {
        this.#sessionId = newSessionId
      }

      // Handle different response types
      const contentType = response.headers.get('Content-Type') || ''

      if (!response.ok) {
        // Handle error responses
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      if (contentType.includes('application/json')) {
        // Single JSON response
        const data = await response.json()
        if (data && this.#controller) {
          this.#controller.enqueue(data as ServerMessage)
        }
      } else if (contentType.includes('text/event-stream')) {
        // SSE stream - handle events
        await this.#handleSseResponse(response)
      } else if (response.status === 202) {
        // Accepted with no content (for notifications/responses)
        // Nothing to do
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Handle Server-Sent Events response stream.
   */
  async #handleSseResponse(response: Response): Promise<void> {
    if (!response.body) {
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE events
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        let eventData = ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            eventData += line.slice(6)
          } else if (line === '' && eventData) {
            // End of event
            try {
              const message = JSON.parse(eventData) as ServerMessage
              if (this.#controller) {
                this.#controller.enqueue(message)
              }
            } catch {
              // Ignore parse errors
            }
            eventData = ''
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Dispose of the transport.
   */
  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true

    // If we have a session, try to terminate it
    if (this.#sessionId) {
      try {
        await fetch(this.#url, {
          method: 'DELETE',
          headers: {
            ...this.#headers,
            'Mcp-Session-Id': this.#sessionId,
          },
        })
      } catch {
        // Ignore errors during cleanup
      }
    }

    if (this.#controller) {
      this.#controller.close()
    }

    await super.dispose()
  }
}

/**
 * Create transport streams for MCP HTTP communication.
 */
function createMcpTransportStreams<R, W>(
  sendMessage: (message: W) => Promise<void>,
): {
  readable: ReadableStream<R>
  writable: WritableStream<W>
  controller: ReadableStreamDefaultController<R>
} {
  let controller!: ReadableStreamDefaultController<R>

  const readable = new ReadableStream<R>({
    start(c) {
      controller = c
    },
  })

  const writable = new WritableStream<W>({
    async write(message) {
      await sendMessage(message)
    },
  })

  return { readable, writable, controller }
}
