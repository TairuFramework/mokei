import { existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { createSystemOneClient, type QuestionMap } from '@mokei/system-one-client'
import getPort from 'get-port'
import spawn, { type Subprocess } from 'nano-spawn'

/** A System One server the suites run against. */
export type SystemOneTarget = {
  /** Display name, used in `describe.each` titles. */
  name: 'laya-serve' | 'llama.cpp'
  url: string
  apiKey?: string
  /** Value sent as the request `model`, or `undefined` to leave the server to pick. */
  model?: string
  /** Whether the server rejects requests without `apiKey`. */
  enforcesAuth: boolean
  /** Whether the server returns laya's `routing` extras and the english checkpoint's answers. */
  isLaya: boolean
}

declare module 'vitest' {
  // biome-ignore lint/style/useConsistentTypeDefinitions: Vitest requires an interface for module augmentation.
  export interface ProvidedContext {
    systemOne: Array<SystemOneTarget>
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

function env(name: string): string | undefined {
  const value = process.env[name]
  return value == null || value === '' ? undefined : value
}

async function waitForHealth(
  label: string,
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
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
      throw new Error(`${label} did not answer ${url}/health within ${timeoutMs}ms`, {
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

type Cleanup = () => Promise<void>

/**
 * Waits for a spawned server to answer `/health`, then warms it up: the first inference pays
 * one-off costs, so suites should not.
 */
async function awaitReady(
  label: string,
  server: Subprocess | null,
  target: SystemOneTarget,
): Promise<void> {
  const setupDeadline = new AbortController()
  const timer = setTimeout(() => {
    setupDeadline.abort(new Error(`${label} setup did not finish within 330000ms`))
  }, 330_000)
  try {
    const exited =
      server?.then(
        (result) => {
          throw new Error(`${label} exited before it was ready:\n${result.stderr}`)
        },
        (error: unknown) => {
          const stderr = (error as { stderr?: string }).stderr ?? ''
          throw new Error(`${label} failed before it was ready:\n${stderr}`, { cause: error })
        },
      ) ?? new Promise<never>(() => {})
    await Promise.race([waitForHealth(label, target.url, 300_000, setupDeadline.signal), exited])

    const warmup = createSystemOneClient({
      url: target.url,
      apiKey: target.apiKey,
      defaultModel: target.model,
      timeout: 120_000,
    })
    await Promise.race([
      warmup.predict({ state: THANKS, questions, signal: setupDeadline.signal }),
      exited,
    ])
    setupDeadline.signal.throwIfAborted()
  } catch (error) {
    setupDeadline.abort()
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function startLaya(bin: string, cleanups: Array<Cleanup>): Promise<SystemOneTarget> {
  const port = await getPort()
  const target: SystemOneTarget = {
    name: 'laya-serve',
    url: `http://127.0.0.1:${port}`,
    apiKey: API_KEY,
    model: 'english',
    enforcesAuth: true,
    isLaya: true,
  }
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
  cleanups.push(() => stopServer(server))
  await awaitReady('laya-serve', server, target)
  return target
}

/**
 * llama.cpp's decision-model endpoint (`/v1/systemone`), either one that is already running
 * (`MOKEI_LLAMA_DECISION_URL`) or one spawned from `llama-server` with a decision GGUF
 * (`MOKEI_LLAMA_DECISION_BIN` + `MOKEI_LLAMA_DECISION_MODEL`, a file path or a `-hf` repo).
 */
async function startLlamaCpp(cleanups: Array<Cleanup>): Promise<SystemOneTarget | null> {
  const model = env('MOKEI_LLAMA_DECISION_REQUEST_MODEL')
  const externalURL = env('MOKEI_LLAMA_DECISION_URL')
  if (externalURL != null) {
    const apiKey = env('MOKEI_LLAMA_DECISION_API_KEY')
    const target: SystemOneTarget = {
      name: 'llama.cpp',
      url: externalURL.replace(/\/+$/, ''),
      apiKey,
      model,
      enforcesAuth: apiKey != null,
      isLaya: false,
    }
    await awaitReady('llama.cpp', null, target)
    return target
  }

  const bin = env('MOKEI_LLAMA_DECISION_BIN')
  const modelRef = env('MOKEI_LLAMA_DECISION_MODEL')
  if (bin == null || modelRef == null) return null

  const port = await getPort()
  const target: SystemOneTarget = {
    name: 'llama.cpp',
    url: `http://127.0.0.1:${port}`,
    apiKey: API_KEY,
    model,
    enforcesAuth: true,
    isLaya: false,
  }
  const server = spawn(
    bin,
    [
      ...(existsSync(modelRef) ? ['-m', modelRef] : ['-hf', modelRef]),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--api-key',
      API_KEY,
      // laya- and clef-family decision models evaluate the whole prompt in one batch.
      '--ubatch-size',
      '2048',
      '--batch-size',
      '2048',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  cleanups.push(() => stopServer(server))
  await awaitReady('llama.cpp', server, target)
  return target
}

export async function setup({
  provide,
}: {
  provide: (key: 'systemOne', value: Array<SystemOneTarget>) => void
}): Promise<(() => Promise<void>) | undefined> {
  const targets: Array<SystemOneTarget> = []
  const cleanups: Array<Cleanup> = []
  const stopAll = async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  }

  try {
    const layaBin = env('MOKEI_LAYA_SERVE_BIN')
    if (layaBin != null) targets.push(await startLaya(layaBin, cleanups))
    const llama = await startLlamaCpp(cleanups)
    if (llama != null) targets.push(llama)
  } catch (error) {
    await stopAll()
    throw error
  }

  provide('systemOne', targets)
  return targets.length === 0 ? undefined : stopAll
}
