import { HandlerError, type ProcedureHandlers } from '@enkaku/server'
import type { MonitorProcedure, Protocol } from '@mokei/host-protocol'

import {
  MonitorAttachmentNotFoundError,
  type MonitorPresence,
  MonitorURLError,
} from './monitor-presence.js'

export type MonitorHandlers = Pick<ProcedureHandlers<Protocol>, MonitorProcedure>

export function createMonitorHandlers(presence: MonitorPresence): MonitorHandlers {
  return {
    'monitor.attach': async ({ param, signal, writable }) => {
      if (signal.aborted) return
      let attachment: ReturnType<MonitorPresence['attach']>
      try {
        attachment = presence.attach(param.url)
      } catch (error) {
        if (error instanceof MonitorURLError) {
          throw HandlerError.from(error, { code: 'INVALID_PARAMS', message: error.message })
        }
        throw error
      }
      const writer = writable.getWriter()
      let finish = () => {}
      const ended = new Promise<void>((resolve) => {
        finish = resolve
      })
      signal.addEventListener('abort', finish, { once: true })
      void writer.closed.catch(finish)
      try {
        if (signal.aborted) return
        await writer.write({ type: 'attached', attachmentID: attachment.attachmentID })
        await ended
      } finally {
        signal.removeEventListener('abort', finish)
        attachment.detach()
        writer.releaseLock()
      }
    },
    'monitor.presence': async ({ param, signal, readable, writable }) => {
      if (signal.aborted) return
      const controller = new AbortController()
      const abort = () => controller.abort()
      const writer = writable.getWriter()
      let connection: ReturnType<MonitorPresence['connect']>
      try {
        connection = presence.connect(param.attachmentID, {
          send: (message) => {
            void writer.write(message).catch(abort)
          },
          close: abort,
        })
      } catch (error) {
        writer.releaseLock()
        if (error instanceof MonitorAttachmentNotFoundError) {
          throw HandlerError.from(error, {
            code: 'MONITOR_ATTACHMENT_NOT_FOUND',
            message: error.message,
          })
        }
        throw error
      }
      signal.addEventListener('abort', abort, { once: true })
      void writer.closed.catch(abort)
      try {
        if (signal.aborted) abort()
        await readable.pipeTo(new WritableStream({ write: connection.receive }), {
          signal: controller.signal,
        })
      } catch (error) {
        if (!controller.signal.aborted) throw error
      } finally {
        signal.removeEventListener('abort', abort)
        connection.disconnect()
        writer.releaseLock()
      }
    },
  }
}
