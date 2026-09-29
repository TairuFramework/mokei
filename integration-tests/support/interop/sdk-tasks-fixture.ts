import type { Client } from '@modelcontextprotocol/client'
import {
  createApplicationInputHandler,
  createTaskSessionFromClient,
  type JsonRpcResponse,
  type RawClientDispatch,
} from '@modelcontextprotocol/ext-tasks/client'
import type { JsonValue } from '@modelcontextprotocol/ext-tasks/core'

type WireFrame = Record<string, unknown>
type Transport = NonNullable<Client['transport']>

export type SDKTasksFixture = {
  session: ReturnType<typeof createTaskSessionFromClient>
  sent: Array<WireFrame>
  received: Array<WireFrame>
  dispose: () => Promise<void>
}

function isRecord(value: unknown): value is WireFrame {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The SDK 2.1.0 codec cannot dispatch V2 task frames, so use its connected transport directly. */
export function createSDKTasksFixture(client: Client): SDKTasksFixture {
  const transport = client.transport
  if (transport == null) throw new Error('Expected a connected SDK client')
  const sent: Array<WireFrame> = []
  const received: Array<WireFrame> = []
  const pending = new Map<string, (response: JsonRpcResponse) => void>()
  const previousOnMessage = transport.onmessage
  let nextID = 0
  transport.onmessage = (message, extra) => {
    const frame: unknown = message
    if (isRecord(frame)) {
      received.push(frame)
      const id = frame.id
      if (typeof id === 'string') {
        const resolve = pending.get(id)
        if (resolve != null) {
          pending.delete(id)
          if (isRecord(frame.error)) {
            resolve({
              kind: 'error',
              error: frame.error as Extract<JsonRpcResponse, { kind: 'error' }>['error'],
            })
          } else {
            resolve({ kind: 'result', result: frame.result as JsonValue })
          }
          return
        }
      }
    }
    previousOnMessage?.(message, extra)
  }

  const rawDispatch: RawClientDispatch = async (request, options) => {
    if (!isRecord(request)) throw new Error('Expected an object request')
    const id = `sdk-tasks:${++nextID}`
    const frame = { ...request, jsonrpc: '2.0', id }
    sent.push(frame)
    const response = new Promise<JsonRpcResponse>((resolve) => pending.set(id, resolve))
    const params = isRecord(request.params) ? request.params : {}
    const headers = {
      ...options?.context?.headers,
      ...(typeof params.taskId === 'string' ? { 'Mcp-Name': params.taskId } : {}),
    }
    try {
      await transport.send(frame as Parameters<Transport['send']>[0], {
        requestSignal: options?.signal,
        headers,
      })
      return await response
    } catch (error) {
      pending.delete(id)
      throw error
    }
  }

  const session = createTaskSessionFromClient(client, {
    endpointId: 'mokei-sdk-tasks-interop',
    rawDispatch,
    v2RequestFraming: {
      protocolVersion: '2026-07-28',
      clientInfo: { name: 'mokei-interop-test', version: '1.0.0' },
      clientCapabilities: {
        elicitation: {},
        extensions: { 'io.modelcontextprotocol/tasks': {} },
      },
    },
    onInputRequest: createApplicationInputHandler({
      elicitation: (request) => {
        if (request.params.message !== 'What is your name?') {
          throw new Error('Unexpected elicitation prompt')
        }
        return { action: 'accept', content: { name: 'Ada' } }
      },
      sampling: () => {
        throw new Error('Unexpected sampling request')
      },
      roots: () => {
        throw new Error('Unexpected roots request')
      },
    }),
  })
  return {
    session,
    sent,
    received,
    dispose: async () => {
      await session.close()
      transport.onmessage = previousOnMessage
    },
  }
}
