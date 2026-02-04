import { createReadable, writeTo } from '@enkaku/stream'
import { Transport } from '@enkaku/transport'
import type { ClientTransport } from '@mokei/context-client'
import { ContextClient, type ContextTypes, type UnknownContextTypes } from '@mokei/context-client'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { parseServerSentEvents } from 'parse-sse'

import { buildHTTPHeaders, type HTTPAuthOptions } from './auth.js'

/**
 * Parameters for creating an MCP HTTP transport.
 */
export type HTTPTransportParams = {
  /** URL of the MCP HTTP endpoint */
  url: string
  /** Optional custom headers */
  headers?: Record<string, string>
  /** Optional authentication */
  auth?: HTTPAuthOptions
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
}

/**
 * MCP Streamable HTTP client transport.
 *
 * Implements the MCP Streamable HTTP transport specification:
 * - POST requests for sending JSON-RPC messages
 * - Handles JSON and SSE responses
 * - Manages Mcp-Session-Id lifecycle
 * - Opens a GET SSE stream for server-initiated messages after initialization
 */
export class HTTPTransport extends Transport<ServerMessage, ClientMessage> {
  #url: string
  #headers: Record<string, string>
  #timeout: number
  #sessionID: string | null = null
  #lastEventID: string | null = null
  #retryMs: number | null = null
  #disposed = false
  #controller: ReadableStreamDefaultController<ServerMessage> | null = null
  #getStreamAbortController: AbortController | null = null

  constructor(params: HTTPTransportParams) {
    const [readable, controller] = createReadable<ServerMessage>()
    const writable = writeTo<ClientMessage>(async (message) => {
      await this.#sendMessage(message)
    })
    super({ stream: { readable, writable } })
    this.#controller = controller
    this.#url = params.url
    this.#headers = buildHTTPHeaders(params.headers, params.auth)
    this.#timeout = params.timeout ?? 30000
  }

  /**
   * Get the current session ID.
   */
  get sessionID(): string | null {
    return this.#sessionID
  }

  /**
   * Get the last event ID received from SSE streams.
   */
  get lastEventID(): string | null {
    return this.#lastEventID
  }

  /**
   * Get the retry interval in milliseconds, if specified by the server.
   */
  get retryMs(): number | null {
    return this.#retryMs
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

    if (this.#sessionID) {
      headers['Mcp-Session-Id'] = this.#sessionID
    }

    const controller = new AbortController()
    const timeoutID = setTimeout(() => controller.abort(), this.#timeout)

    try {
      const response = await fetch(this.#url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      })

      // Capture session ID from response
      const newSessionID = response.headers.get('Mcp-Session-Id')
      if (newSessionID) {
        this.#sessionID = newSessionID
      }

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      const contentType = response.headers.get('Content-Type') ?? ''

      if (contentType.includes('application/json')) {
        const data = await response.json()
        if (data && this.#controller) {
          this.#controller.enqueue(data as ServerMessage)
        }
      } else if (contentType.includes('text/event-stream')) {
        await this.#handleSSEResponse(response)
      }
      // 202 Accepted or other no-content responses: no-op
    } finally {
      clearTimeout(timeoutID)
    }

    // After sending notifications/initialized with a session, open GET stream
    if ('method' in message && message.method === 'notifications/initialized' && this.#sessionID) {
      this.#openGETStream()
    }
  }

  /**
   * Handle an SSE response, parsing events and enqueuing messages.
   */
  async #handleSSEResponse(response: Response): Promise<void> {
    const stream = parseServerSentEvents(response)
    const reader = stream.getReader()

    try {
      while (true) {
        const { done, value: event } = await reader.read()
        if (done) break

        if (event.lastEventId) {
          this.#lastEventID = event.lastEventId
        }
        if (event.retry != null) {
          this.#retryMs = event.retry
        }
        if (event.data && event.data.trim() !== '') {
          try {
            const message = JSON.parse(event.data) as ServerMessage
            if (this.#controller) {
              this.#controller.enqueue(message)
            }
          } catch {
            // Skip events with non-JSON data
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Open a background GET SSE stream for server-initiated messages.
   */
  #openGETStream(): void {
    if (this.#disposed) return

    this.#getStreamAbortController = new AbortController()

    const headers: Record<string, string> = {
      ...this.#headers,
      Accept: 'text/event-stream',
      'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
    }

    if (this.#sessionID) {
      headers['Mcp-Session-Id'] = this.#sessionID
    }

    if (this.#lastEventID) {
      headers['Last-Event-ID'] = this.#lastEventID
    }

    // Fire-and-forget: process SSE events in the background
    this.#processGETStream(headers).catch(() => {
      // Connection closed or aborted - don't reconnect automatically yet
    })
  }

  /**
   * Process the GET SSE stream.
   */
  async #processGETStream(headers: Record<string, string>): Promise<void> {
    const response = await fetch(this.#url, {
      method: 'GET',
      headers,
      signal: this.#getStreamAbortController?.signal,
    })

    if (!response.ok) {
      return
    }

    await this.#handleSSEResponse(response)
  }

  /**
   * Dispose of the transport.
   */
  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true

    // Cancel the GET stream
    if (this.#getStreamAbortController) {
      this.#getStreamAbortController.abort()
      this.#getStreamAbortController = null
    }

    // Terminate session with DELETE
    if (this.#sessionID) {
      try {
        await fetch(this.#url, {
          method: 'DELETE',
          headers: {
            ...this.#headers,
            'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
            'Mcp-Session-Id': this.#sessionID,
          },
        })
      } catch {
        // Ignore errors during cleanup
      }
    }

    if (this.#controller) {
      try {
        this.#controller.close()
      } catch {
        // Controller may already be closed
      }
    }

    await super.dispose()
  }
}

/**
 * Create an MCP HTTP client with a single call.
 *
 * Instantiates an {@link HTTPTransport} and wires it to a {@link ContextClient}.
 */
export function createHTTPClient<T extends ContextTypes = UnknownContextTypes>(
  params: HTTPTransportParams,
): ContextClient<T> {
  const transport = new HTTPTransport(params)
  return new ContextClient<T>({ transport: transport as ClientTransport })
}
