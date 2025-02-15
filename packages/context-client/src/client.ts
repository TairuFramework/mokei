import { type Deferred, defer, lazy } from '@enkaku/async'
import { createValidator } from '@enkaku/schema'
import { createReadable } from '@enkaku/stream'
import { LATEST_PROTOCOL_VERSION, serverMessage } from '@mokei/context-protocol'
import type {
  CallToolRequest,
  CallToolResult,
  ClientMessage,
  ClientNotification,
  ClientNotifications,
  ClientRequests,
  ErrorResponse,
  GetPromptRequest,
  GetPromptResult,
  InitializeResult,
  Prompt,
  RequestID,
  ServerNotification,
  ServerRequest,
  Tool,
} from '@mokei/context-protocol'

import { RPCError } from './error.js'
import type { ClientTransport } from './types.js'

type RequestController<Result> = AbortController & Deferred<Result>

const validator = createValidator(serverMessage)

export type ClientRequest<Result> = Promise<Result> & {
  id: number
  cancel: () => void
}

export type ContextTypes = {
  Prompts?: Record<string, Record<string, unknown> | never>
  Tools?: Record<string, Record<string, unknown>>
}

export type UnknownContextTypes = {
  Prompts: Record<string, Record<string, unknown>>
  Tools: Record<string, Record<string, unknown>>
}

export type ClientParams = {
  transport: ClientTransport
}

export class ContextClient<T extends ContextTypes = UnknownContextTypes> {
  #controllers: Record<RequestID, RequestController<unknown>> = {}
  #initialized: PromiseLike<InitializeResult>
  #notificationController: ReadableStreamDefaultController<ServerNotification>
  #notifications: ReadableStream<ServerNotification>
  #requestID = 0
  #transport: ClientTransport

  constructor(params: ClientParams) {
    const [stream, controller] = createReadable<ServerNotification>()
    this.#initialized = lazy(() => this.#initialize())
    this.#notificationController = controller
    this.#notifications = stream
    this.#transport = params.transport
  }

  async #initialize(): Promise<InitializeResult> {
    const id = this.#requestID++
    // Send initialize request
    await this.#transport.write({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: {
          name: 'Mokei',
          version: '0.1.0',
        },
        protocolVersion: LATEST_PROTOCOL_VERSION,
      },
    })
    // Wait for initialize response
    const next = await this.#transport.read()
    if (next.done) {
      throw new Error('Server did not respond to initialize request')
    }
    if (next.value.id !== id) {
      throw new Error('Server did not correctly respond to initialize request')
    }
    // Start listening for incoming messages
    this.#read()
    // Notify server that client is initialized
    await this.#transport.write({ jsonrpc: '2.0', method: 'notifications/initialized' })
    // TODO: check result
    // Return result
    return next.value.result as InitializeResult
  }

  async #read() {
    while (true) {
      const next = await this.#transport.read()
      if (next.done) {
        break
      }

      const validated = validator(next.value)
      if (validated.issues == null) {
        const msg = validated.value
        if (msg.id == null) {
          this.#notificationController.enqueue(msg as ServerNotification)
        } else if (msg.method == null) {
          const controller = this.#controllers[msg.id]
          if (controller == null) {
            console.warn(`Received response for unknown request ${msg.id}`)
          } else {
            if (msg.error != null) {
              controller.reject(RPCError.fromResponse(msg as ErrorResponse))
            } else if (msg.result != null) {
              controller.resolve(msg.result)
            } else {
              controller.reject(new Error(`Received invalid response for request ${msg.id}`))
            }
          }
          delete this.#controllers[msg.id]
        } else {
          const request = msg as ServerRequest
          switch (request.method) {
            case 'ping':
              this.#write({ jsonrpc: '2.0', id: request.id, result: {} })
              break
            case 'roots/list':
              // TODO: implement support
              break
            case 'sampling/createMessage':
              // TODO: implement support
              break
          }
        }
      } else {
        console.warn('Received invalid message', next.value)
      }
    }
  }

  async #write(message: ClientMessage): Promise<void> {
    await this.#initialized
    await this.#transport.write(message)
  }

  get notifications(): ReadableStream<ServerNotification> {
    return this.#notifications
  }

  async initialize(): Promise<InitializeResult> {
    return await this.#initialized
  }

  async notify<Event extends keyof ClientNotifications>(
    event: Event,
    params: ClientNotifications[Event]['params'],
  ): Promise<void> {
    await this.#write({
      jsonrpc: '2.0',
      method: `notifications/${event}`,
      params,
    } as ClientNotification)
  }

  request<Method extends keyof ClientRequests>(
    method: Method,
    params: ClientRequests[Method]['Params'],
  ): ClientRequest<ClientRequests[Method]['Result']> {
    const id = this.#requestID++
    const controller = Object.assign(new AbortController(), defer())
    this.#controllers[id] = controller

    controller.signal.addEventListener('abort', () => {
      if (this.#controllers[id] == null) {
        return
      }
      controller.reject(new Error('Cancelled'))
      this.notify('cancelled', { requestId: id })
      delete this.#controllers[id]
    })

    this.#write({ jsonrpc: '2.0', id, method, params } as ClientMessage).catch((error) => {
      controller.reject(error)
    })

    return Object.assign(controller.promise, {
      id,
      cancel: () => {
        controller.abort()
      },
    }) as ClientRequest<ClientRequests[Method]['Result']>
  }

  async listPrompts(): Promise<Array<Prompt>> {
    const list = await this.request('prompts/list', {})
    return list.prompts
  }

  getPrompt<Name extends keyof T['Prompts'] & string>(
    name: Name,
    args: T['Prompts'][Name] extends undefined ? never : T['Prompts'][Name],
  ): ClientRequest<GetPromptResult> {
    return this.request('prompts/get', { name, arguments: args } as GetPromptRequest['params'])
  }

  async listTools(): Promise<Array<Tool>> {
    const list = await this.request('tools/list', {})
    return list.tools
  }

  callTool<Name extends keyof T['Tools'] & string>(
    name: Name,
    args: T['Tools'][Name],
  ): ClientRequest<CallToolResult> {
    return this.request('tools/call', { name, arguments: args } as CallToolRequest['params'])
  }
}
