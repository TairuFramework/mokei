import { type Deferred, Disposer, defer, toPromise } from '@enkaku/async'
import { EventEmitter } from '@enkaku/event'
import type { Validator } from '@enkaku/schema'
import type { TransportType } from '@enkaku/transport'
import { INTERNAL_ERROR, INVALID_REQUEST } from '@mokei/context-protocol'
import type {
  AnyMessage,
  CancelledNotification,
  ErrorResponse,
  Notification,
  ProgressNotification,
  Request,
  RequestID,
  Response,
} from '@mokei/context-protocol'

import { RPCError, errorResponse } from './error.js'

function isRequestID(id: unknown): id is RequestID {
  return typeof id === 'string' || typeof id === 'number'
}

type RequestController<Result> = AbortController & Deferred<Result>

type RequestDefinition = {
  Params: unknown | undefined
  Result: unknown | undefined
}

export type SentRequest<Result> = Promise<Result> & {
  id: number
  cancel: () => void
}

export type RPCTypes = {
  Events: Record<string, unknown>
  MessageIn: AnyMessage
  MessageOut: AnyMessage
  HandleNotification: Notification
  HandleRequest: Request
  SendNotifications: Record<string, Notification>
  SendRequests: Record<string, RequestDefinition>
  SendResult: unknown
}

export type RPCParams<T extends RPCTypes> = {
  transport: TransportType<T['MessageIn'], T['MessageOut']>
  validateMessageIn: Validator<T['MessageIn']>
}

export class ContextRPC<T extends RPCTypes> extends Disposer {
  #events: EventEmitter<T['Events']>
  #receivedRequests: Record<RequestID, AbortController> = {}
  #requestID = 0
  #sentRequests: Record<RequestID, RequestController<unknown>> = {}
  #transport: TransportType<T['MessageIn'], T['MessageOut']>
  #validateMessageIn: Validator<T['MessageIn']>

  constructor(params: RPCParams<T>) {
    super({ dispose: () => this.#transport.dispose() })
    this.#events = new EventEmitter<T['Events']>()
    this.#transport = params.transport
    this.#validateMessageIn = params.validateMessageIn
  }

  get events(): EventEmitter<T['Events']> {
    return this.#events
  }

  _getNextRequestID(): RequestID {
    return this.#requestID++
  }

  async _read(): Promise<ReadableStreamReadResult<T['MessageIn']>> {
    return await this.#transport.read()
  }

  async _write(message: T['MessageOut']): Promise<void> {
    await this.#transport.write(message)
  }

  _handle() {
    const handleNext = async () => {
      const next = await this._read()
      if (next.done) {
        return
      }

      const validated = this.#validateMessageIn(next.value)
      if (validated.issues == null) {
        // Message is valid for protocol
        const id = validated.value.id as RequestID | undefined
        if (id == null) {
          // Message is a notification
          const notification = validated.value as
            | CancelledNotification
            | ProgressNotification
            | T['HandleNotification']
          if (notification.method === 'notifications/cancelled') {
            const cancelled = notification as CancelledNotification
            const controller = this.#receivedRequests[cancelled.params.requestId]
            if (controller != null) {
              controller.abort()
              delete this.#receivedRequests[cancelled.params.requestId]
            }
          } else {
            void this._handleNotification(notification)
          }
        } else if (validated.value.method == null) {
          // Message is a response
          const response = validated.value as Response
          const controller = this.#sentRequests[id]
          if (controller == null) {
            // TODO: error unknown sent request
          } else if ('error' in response) {
            controller.reject(RPCError.fromResponse(response as ErrorResponse))
          } else if ('result' in response) {
            controller.resolve(response.result)
          } else {
            // TODO: error invalid response
          }
        } else if (validated.value.method === 'ping') {
          // Handle ping request
          this._write({ jsonrpc: '2.0', id, result: {} })
        } else {
          // Message is a request
          const controller = new AbortController()
          this.#receivedRequests[id] = controller
          toPromise(() => {
            return this._handleRequest(validated.value as T['HandleRequest'], controller.signal)
          })
            .then(
              (result) => {
                if (
                  this.#receivedRequests[id] != null &&
                  !this.#receivedRequests[id].signal.aborted
                ) {
                  if (result == null) {
                    this._write(new RPCError(INTERNAL_ERROR, 'No result').toResponse(id))
                  } else {
                    this._write({ jsonrpc: '2.0', id, result })
                  }
                }
              },
              (cause) => {
                if (
                  this.#receivedRequests[id] != null &&
                  !this.#receivedRequests[id].signal.aborted
                ) {
                  this._write(errorResponse(id, cause))
                } else {
                  // TODO: call optional error handler
                }
              },
            )
            .finally(() => {
              delete this.#receivedRequests[id]
            })
        }
      } else {
        // Message is invalid for the protocol
        const id = next.value.id
        if (next.value.method != null && isRequestID(id)) {
          // Send an error response if incoming message is a request
          this._write(new RPCError(INVALID_REQUEST, 'Invalid request').toResponse(id))
        } else {
          // TODO: call optional error handler
        }
      }

      handleNext()
    }

    handleNext()
  }

  // TODO: handle cancel notification, delegate to handler for other notifications
  _handleNotification(
    notification: ProgressNotification | T['HandleNotification'],
  ): void | Promise<void> {}

  _handleRequest(
    request: T['HandleRequest'],
    signal: AbortSignal,
  ): T['SendResult'] | Promise<T['SendResult']> {
    throw new Error('_handleRequest() method must be implemented')
  }

  async notify<Event extends keyof T['SendNotifications'] & string>(
    event: Event,
    params: T['SendNotifications'][Event]['params'],
  ): Promise<void> {
    await this._write({ jsonrpc: '2.0', method: `notifications/${event}`, params })
  }

  request<Method extends keyof T['SendRequests']>(
    method: Method,
    params: T['SendRequests'][Method]['Params'],
  ): SentRequest<T['SendRequests'][Method]['Result']> {
    const id = this._getNextRequestID()
    const controller = Object.assign(new AbortController(), defer())
    this.#sentRequests[id] = controller

    controller.signal.addEventListener('abort', () => {
      if (this.#sentRequests[id] == null) {
        return
      }
      controller.reject(new Error('Cancelled'))
      this.notify('cancelled', { requestId: id })
      delete this.#sentRequests[id]
    })

    this._write({ jsonrpc: '2.0', id, method, params } as T['MessageOut']).catch((error) => {
      controller.reject(error)
    })

    return Object.assign(controller.promise, {
      id,
      cancel: () => {
        controller.abort()
      },
    }) as SentRequest<T['SendRequests'][Method]['Result']>
  }
}
