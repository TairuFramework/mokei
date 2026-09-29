import { setTimeout as delay } from 'node:timers/promises'
import { createSystemOneClient, type QuestionMap } from '@mokei/system-one-client'
import getPort from 'get-port'
import spawn, { type Subprocess } from 'nano-spawn'

declare module 'vitest' {
  // biome-ignore lint/style/useConsistentTypeDefinitions: Vitest requires an interface for module augmentation.
  export interface ProvidedContext {
    laya: { url: string; apiKey: string } | null
  }
}

const API_KEY = 'mokei-integration'
const THANKS = 'Thanks, everything works great now.'
const questions = {
  department: {
    type: 'choice',
    instructions: 'Which department should handle this message?',
    criteria: {
      billing: 'invoices, charges and refunds',
      technical: 'bugs, outages and errors',
    },
  },
  urgency: {
    type: 'score',
    instructions: 'How urgent is this message?',
    criteria: ['not urgent', 'somewhat urgent', 'very urgent'],
  },
  complaint: { type: 'noul', instructions: 'Is the customer complaining?' },
} satisfies QuestionMap

async function waitForHealth(url: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const healthSignal = AbortSignal.any([signal, timeout])
  try {
    while (true) {
      healthSignal.throwIfAborted()
      try {
        const response = await fetch(`${url}/health`, { signal: healthSignal })
        if (response.ok) return
      } catch {
        healthSignal.throwIfAborted()
        // not listening yet
      }
      await delay(500, undefined, { signal: healthSignal })
    }
  } catch (error) {
    if (timeout.aborted && !signal.aborted) {
      throw new Error(`laya-serve did not answer ${url}/health within ${timeoutMs}ms`, {
        cause: error,
      })
    }
    throw error
  }
}

async function stopServer(server: Subprocess): Promise<void> {
  const child = await server.nodeChildProcess.catch(() => undefined)
  child?.kill('SIGTERM')
  await server.catch(() => {})
}

export async function setup({
  provide,
}: {
  provide: (key: 'laya', value: { url: string; apiKey: string } | null) => void
}): Promise<(() => Promise<void>) | void> {
  const bin = process.env.MOKEI_LAYA_SERVE_BIN
  if (bin == null || bin === '') {
    provide('laya', null)
    return
  }

  const port = await getPort()
  const url = `http://127.0.0.1:${port}`
  const server = spawn(bin, [], {
    env: {
      LAYA_HOST: '127.0.0.1',
      LAYA_PORT: String(port),
      LAYA_MODELS: 'english',
      LAYA_API_KEY: API_KEY,
      LAYA_LOG_LEVEL: 'warning',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const setupDeadline = new AbortController()
  const timer = setTimeout(() => {
    setupDeadline.abort(new Error('laya-serve setup did not finish within 330000ms'))
  }, 330_000)

  try {
    const exited = server.then(
      (result) => {
        throw new Error(`laya-serve exited before it was ready:\n${result.stderr}`)
      },
      (error: unknown) => {
        const stderr = (error as { stderr?: string }).stderr ?? ''
        throw new Error(`laya-serve failed before it was ready:\n${stderr}`, { cause: error })
      },
    )
    await Promise.race([waitForHealth(url, 300_000, setupDeadline.signal), exited])

    // The first inference pays one-off costs, so warm up before giving suites the server.
    const warmup = createSystemOneClient({
      url,
      apiKey: API_KEY,
      defaultModel: 'english',
      timeout: 120_000,
    })
    await Promise.race([
      warmup.predict({ state: THANKS, questions, signal: setupDeadline.signal }),
      exited,
    ])
    setupDeadline.signal.throwIfAborted()
    provide('laya', { url, apiKey: API_KEY })
    return async () => {
      await stopServer(server)
    }
  } catch (error) {
    setupDeadline.abort()
    await stopServer(server)
    throw error
  } finally {
    clearTimeout(timer)
  }
}
