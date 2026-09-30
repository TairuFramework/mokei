import { afterEach, describe, expect, test } from 'vitest'

import { createRunner, type Runner } from '../src/index.js'

const node = process.execPath

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitDead(pid: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (!isAlive(pid)) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return !isAlive(pid)
}

describe('runner', () => {
  let runner: Runner
  afterEach(async () => {
    await runner?.dispose()
  })

  test('resolves exit code and output', async () => {
    runner = createRunner()
    const result = await runner.run(
      node,
      ['-e', "console.log('out'); console.error('err'); process.exit(3)"],
      { timeoutMs: 5000 },
    )
    expect(result).toEqual({ code: 3, stdout: 'out\n', stderr: 'err\n', timedOut: false })
  })

  test('passes arguments without a shell', async () => {
    runner = createRunner()
    const hostile = '$(echo injected); `echo x` | cat > /dev/null && echo "$HOME"'
    const result = await runner.run(
      node,
      ['-e', 'process.stdout.write(process.argv[1])', hostile],
      { timeoutMs: 5000 },
    )
    expect(result).toEqual({ code: 0, stdout: hostile, stderr: '', timedOut: false })
  })

  test('kills on timeout', async () => {
    runner = createRunner()
    const result = await runner.run(node, ['-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 200,
    })
    expect(result.timedOut).toBe(true)
  })

  test('escalates a timeout to SIGKILL when the child ignores SIGTERM', async () => {
    runner = createRunner()
    const started = Date.now()
    const result = await runner.run(
      node,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      { timeoutMs: 200 },
    )
    expect(result.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(5000)
  }, 10000)

  test('escalates an abort to SIGKILL when the child ignores SIGTERM', async () => {
    runner = createRunner()
    const controller = new AbortController()
    const reason = new Error('stop')
    const promise = runner.run(
      node,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      { timeoutMs: 60000, signal: controller.signal },
    )
    setTimeout(() => controller.abort(reason), 200)
    await expect(promise).rejects.toBe(reason)
  }, 10000)

  test('kills on abort', async () => {
    runner = createRunner()
    const controller = new AbortController()
    const reason = new Error('stop')
    const promise = runner.run(
      node,
      ['-e', 'console.log(process.pid); setInterval(() => {}, 1000)'],
      { timeoutMs: 10000, signal: controller.signal },
    )
    setTimeout(() => controller.abort(reason), 300)
    await expect(promise).rejects.toBe(reason)
  })

  test('abort leaves the child dead', async () => {
    runner = createRunner()
    const controller = new AbortController()
    const pidFile = `${process.env.TMPDIR ?? '/tmp'}/runner-abort-${process.pid}-${Date.now()}`
    const promise = runner.run(
      node,
      [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`,
      ],
      { timeoutMs: 10000, signal: controller.signal },
    )
    const fs = await import('node:fs')
    const start = Date.now()
    while (!fs.existsSync(pidFile) && Date.now() - start < 3000) {
      await new Promise((r) => setTimeout(r, 25))
    }
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    fs.rmSync(pidFile)
    controller.abort(new Error('bye'))
    await expect(promise).rejects.toThrow('bye')
    expect(await waitDead(pid, 1000)).toBe(true)
  })

  test('already aborted signal does not spawn', async () => {
    runner = createRunner()
    const reason = new Error('nope')
    const signal = AbortSignal.abort(reason)
    await expect(
      runner.run('definitely-not-a-command-xyz', [], { timeoutMs: 1000, signal }),
    ).rejects.toBe(reason)
  })

  test('rejects spawn errors', async () => {
    runner = createRunner()
    await expect(
      runner.run('definitely-not-a-command-xyz', [], { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('dispose kills live children and escalates', async () => {
    runner = createRunner()
    const fs = await import('node:fs')
    const pidFile = `${process.env.TMPDIR ?? '/tmp'}/runner-dispose-${process.pid}-${Date.now()}`
    const promise = runner.run(
      node,
      [
        '-e',
        `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`,
      ],
      { timeoutMs: 20000 },
    )
    const start = Date.now()
    while (!fs.existsSync(pidFile) && Date.now() - start < 3000) {
      await new Promise((r) => setTimeout(r, 25))
    }
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    fs.rmSync(pidFile)
    const disposed = runner.dispose()
    expect(await waitDead(pid, 1500)).toBe(true)
    await disposed
    await promise.catch(() => {})
  })

  test('run after dispose rejects', async () => {
    runner = createRunner()
    await runner.dispose()
    await expect(runner.run(node, ['-e', ''], { timeoutMs: 1000 })).rejects.toThrow(
      'Runner disposed',
    )
  })
})
