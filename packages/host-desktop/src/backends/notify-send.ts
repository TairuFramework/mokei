import type { Runner } from '../runner.js'
import { assertNotified, type DesktopBackend, type NotifyRequest } from './types.js'

export function buildNotifySendArgs(request: NotifyRequest, appName: string): Array<string> {
  return ['--app-name', appName, '--', request.title, request.message]
}

export function createNotifySendBackend(runner: Runner, appName: string): DesktopBackend {
  return {
    name: 'notify-send',
    async notify(request, { timeoutMs, signal }) {
      const result = await runner.run('notify-send', buildNotifySendArgs(request, appName), {
        timeoutMs,
        signal,
      })
      assertNotified('notify-send', result)
    },
  }
}
