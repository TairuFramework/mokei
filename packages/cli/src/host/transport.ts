import { type Socket, createConnection } from 'node:net'
import { Transport } from '@enkaku/transport'

export type SocketOrPromise = Socket | Promise<Socket>
export type SocketSource = SocketOrPromise | (() => SocketOrPromise)

export async function connectSocket(path: string): Promise<Socket> {
  const socket = createConnection(path)
  return new Promise((resolve, reject) => {
    socket.on('connect', () => {
      resolve(socket)
    })
    socket.on('error', (err) => {
      reject(err)
    })
  })
}

export async function createTransportStream<R, W>(
  source: SocketSource,
): Promise<ReadableWritablePair<R, W>> {
  const socket = await Promise.resolve(typeof source === 'function' ? source() : source)

  const readable = new ReadableStream<R>({
    start(controller) {
      socket.on('data', (buffer) => {
        controller.enqueue(JSON.parse(buffer.toString()) as R)
      })
      socket.on('close', () => controller.close())
      socket.on('error', (err) => controller.error(err))
    },
  })

  const writable = new WritableStream<W>({
    write(msg) {
      socket.write(JSON.stringify(msg))
    },
    close() {
      socket.end()
    },
  })

  return { readable, writable }
}

export type SocketTransportParams = {
  socket: SocketSource | string
  signal?: AbortSignal
}

export class SocketTransport<R, W> extends Transport<R, W> {
  constructor(params: SocketTransportParams) {
    const source = typeof params.socket === 'string' ? connectSocket(params.socket) : params.socket
    super({ stream: () => createTransportStream(source), signal: params.signal })
  }
}
