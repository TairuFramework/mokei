import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { getMokeiConfigPath, loadMokeiConfig, MokeiConfigError } from '../src/index.js'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mokei-config-'))
  vi.stubEnv('MOKEI_CONFIG_PATH', undefined)
  vi.stubEnv('MOKEI_DATA_DIR', directory)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

test('honours MOKEI_CONFIG_PATH and lets an explicit path win', async () => {
  const envPath = join(directory, 'env.json')
  const explicitPath = join(directory, 'explicit.json')
  await writeFile(envPath, JSON.stringify({ logs: { level: 'debug' } }))
  await writeFile(explicitPath, JSON.stringify({ logs: { file: false } }))
  vi.stubEnv('MOKEI_CONFIG_PATH', envPath)
  expect(getMokeiConfigPath()).toBe(envPath)
  expect(await loadMokeiConfig()).toEqual({ logs: { level: 'debug', file: true }, tracing: {} })
  expect(await loadMokeiConfig(explicitPath)).toEqual({
    logs: { level: 'info', file: false },
    tracing: {},
  })
})

test('returns defaults when mokei.json is missing', async () => {
  expect(getMokeiConfigPath()).toBe(join(directory, 'mokei.json'))
  expect(await loadMokeiConfig()).toEqual({ logs: { level: 'info', file: true }, tracing: {} })
})

test('reads logs and tracing', async () => {
  const config = {
    logs: { level: 'debug', file: false },
    tracing: { otlp: { endpoint: 'http://x', headers: { authorization: 'test' } } },
  }
  await writeFile(getMokeiConfigPath(), JSON.stringify(config))
  expect(await loadMokeiConfig()).toEqual(config)
})

test.each([
  [{ flowDirs: [] }, 'flowDirs'],
  [{ logs: { extra: true } }, 'logs.extra'],
  [{ tracing: { extra: true } }, 'tracing.extra'],
  [{ tracing: { otlp: { endpoint: 'http://x', extra: true } } }, 'tracing.otlp.extra'],
  [{ logs: { level: 'invalid' } }, 'logs.level'],
  [{ logs: { file: 'false' } }, 'logs.file'],
  [{ tracing: { otlp: {} } }, 'tracing.otlp'],
  [
    { tracing: { otlp: { endpoint: 'http://x', headers: { invalid: 1 } } } },
    'tracing.otlp.headers.invalid',
  ],
])('rejects invalid configuration %j', async (config, issue) => {
  const path = getMokeiConfigPath()
  await writeFile(path, JSON.stringify(config))
  const error = await loadMokeiConfig().catch((error: unknown) => error)
  expect(error).toBeInstanceOf(MokeiConfigError)
  expect(error).toMatchObject({
    name: 'MokeiConfigError',
    path,
    issues: expect.arrayContaining([expect.stringContaining(issue)]),
  })
  expect((error as Error).message).toContain(`Invalid mokei configuration ${path}:`)
})

test('rejects invalid JSON', async () => {
  await writeFile(getMokeiConfigPath(), '{')
  const error = await loadMokeiConfig().catch((error: unknown) => error)
  expect(error).toBeInstanceOf(MokeiConfigError)
  expect(error).toMatchObject({
    issues: [expect.stringMatching(/^JSON:/)],
    cause: expect.any(SyntaxError),
  })
})
