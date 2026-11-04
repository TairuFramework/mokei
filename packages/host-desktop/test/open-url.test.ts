import { describe, expect, test } from 'vitest'

import { openURL, type Runner } from '../src/index.js'

function fakeRunner(code = 0) {
  const calls: Array<{
    command: string
    args: Array<string>
    options: { timeoutMs: number; signal?: AbortSignal }
  }> = []
  const runner: Runner = {
    async run(command, args, options) {
      calls.push({ command, args, options })
      return { code, stdout: '', stderr: '', timedOut: false }
    },
    async dispose() {},
  }
  return { runner, calls }
}

describe('openURL', () => {
  test('opens a URL on macOS as one argument', async () => {
    const { runner, calls } = fakeRunner()
    const url = 'http://127.0.0.1:4321/inbox/item%2F1'

    await openURL(url, { runner, platform: 'darwin' })

    expect(calls[0]).toEqual({
      command: 'open',
      args: [url],
      options: { timeoutMs: 10_000, signal: undefined },
    })
  })

  test('uses xdg-open on Linux', async () => {
    const { runner, calls } = fakeRunner()

    await openURL('https://example.test/', { runner, platform: 'linux' })

    expect(calls[0]?.command).toBe('xdg-open')
    expect(calls[0]?.args).toEqual(['https://example.test/'])
  })

  test('rejects unsupported platforms', async () => {
    const { runner, calls } = fakeRunner()

    await expect(openURL('https://example.test/', { runner, platform: 'win32' })).rejects.toThrow(
      'Opening URLs is not supported on win32',
    )
    expect(calls).toEqual([])
  })

  test('rejects a non-zero exit', async () => {
    const { runner } = fakeRunner(1)

    await expect(openURL('https://example.test/', { runner, platform: 'linux' })).rejects.toThrow()
  })

  test('forwards the signal and rejects with its reason when aborted', async () => {
    const controller = new AbortController()
    const reason = new Error('stop')
    let received: AbortSignal | undefined
    const runner: Runner = {
      run(_command, _args, options) {
        received = options.signal
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(options.signal?.reason))
        })
      },
      async dispose() {},
    }

    const opening = openURL('https://example.test/', {
      runner,
      platform: 'linux',
      signal: controller.signal,
    })
    controller.abort(reason)

    await expect(opening).rejects.toBe(reason)
    expect(received).toBe(controller.signal)
  })

  test('rejects when the opener times out', async () => {
    const runner: Runner = {
      async run() {
        return { code: null, stdout: '', stderr: '', timedOut: true }
      },
      async dispose() {},
    }

    await expect(openURL('https://example.test/', { runner, platform: 'darwin' })).rejects.toThrow(
      'Opening URL timed out',
    )
  })

  test('does not dispose a caller-supplied runner', async () => {
    let disposed = false
    const runner: Runner = {
      async run() {
        return { code: 0, stdout: '', stderr: '', timedOut: false }
      },
      async dispose() {
        disposed = true
      },
    }

    await openURL('https://example.test/', { runner, platform: 'linux' })

    expect(disposed).toBe(false)
  })
})
