import { createAlerterBackend } from './backends/alerter.js'
import { createNotifySendBackend } from './backends/notify-send.js'
import { createOsascriptBackend } from './backends/osascript.js'
import type { BackendName, DesktopBackend } from './backends/types.js'
import { createZenityBackend } from './backends/zenity.js'
import { createDetector } from './detect.js'
import type { DesktopElicitOptions } from './elicit-handler.js'
import { createRunner, type Runner } from './runner.js'

const NOTIFY_TIMEOUT_MS = 5000

export function defaultCreateBackend(appName: string) {
  return (name: BackendName, runner: Runner): DesktopBackend => {
    switch (name) {
      case 'alerter':
        return createAlerterBackend(runner)
      case 'osascript':
        return createOsascriptBackend(runner)
      case 'zenity':
        return createZenityBackend(runner)
      case 'notify-send':
        return createNotifySendBackend(runner, appName)
    }
  }
}

/** Settles with the promise, or rejects with the signal's reason as soon as it aborts. */
export function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export function createDesktopNotifier(options: DesktopElicitOptions = {}): {
  notify(message: string, options?: { signal?: AbortSignal }): Promise<void>
  dispose(): Promise<void>
} {
  const appName = options.appName ?? 'mokei'
  const ownsRunner = options.runner == null
  const runner = options.runner ?? createRunner()
  const createBackend = options.createBackend ?? defaultCreateBackend(appName)
  const detect = createDetector({
    platform: options.platform ?? process.platform,
    env: options.env ?? process.env,
    forced: options.backends,
  })
  const backends = new Map<BackendName, DesktopBackend>()
  const disposal = new AbortController()
  const deliveries = new Set<Promise<void>>()
  let disposing: Promise<void> | undefined

  async function notify(message: string, callOptions?: { signal?: AbortSignal }): Promise<void> {
    disposal.signal.throwIfAborted()
    callOptions?.signal?.throwIfAborted()
    const { selection } = detect()
    if (selection.notify == null) {
      throw new Error(selection.notifyProblem ?? 'No notification backend is available')
    }
    const name = selection.notify.name
    let backend = backends.get(name)
    if (backend == null) {
      backend = createBackend(name, runner)
      backends.set(name, backend)
    }
    if (backend.notify == null) throw new Error(`${name} cannot show notifications`)
    const timeout = new AbortController()
    const timer = setTimeout(
      () => timeout.abort(new Error('Notification delivery timed out')),
      NOTIFY_TIMEOUT_MS,
    )
    const signal = AbortSignal.any([
      timeout.signal,
      disposal.signal,
      ...(callOptions?.signal == null ? [] : [callOptions.signal]),
    ])
    try {
      signal.throwIfAborted()
      const delivery = backend.notify(
        { title: appName, message },
        { timeoutMs: NOTIFY_TIMEOUT_MS, signal },
      )
      deliveries.add(delivery)
      void delivery.then(
        () => deliveries.delete(delivery),
        () => deliveries.delete(delivery),
      )
      await untilAbort(delivery, signal)
    } finally {
      clearTimeout(timer)
    }
  }
  function dispose(): Promise<void> {
    if (disposing == null) {
      disposal.abort(new Error('Desktop notifier disposed'))
      disposing = (async () => {
        const results = await Promise.allSettled([
          ...(ownsRunner ? [runner.dispose()] : []),
          ...[...deliveries].map((delivery) => delivery.catch(() => undefined)),
        ])
        const failures = results
          .filter((result) => result.status === 'rejected')
          .map((result) => result.reason)
        if (failures.length > 0)
          throw new AggregateError(failures, 'Desktop notifier disposal failed')
      })()
    }
    return disposing
  }
  return { notify, dispose }
}
