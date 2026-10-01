import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const directories: Array<string> = []

async function createDirectory() {
  const directory = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'flow-config-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('flow configuration', () => {
  test('returns defaults for a missing config', async () => {
    const { loadFlowConfig } = await import('../src/index.js')
    const directory = await createDirectory()

    await expect(loadFlowConfig(join(directory, 'missing.json'))).resolves.toEqual({
      siblings: {},
      flowDirs: [],
      approval: { allow: [] },
      tracing: {},
      logs: { level: 'info' },
      retention: { days: 30 },
    })
  })

  test('returns fresh nested defaults for each missing config', async () => {
    const { loadFlowConfig } = await import('../src/index.js')
    const directory = await createDirectory()
    const path = join(directory, 'missing.json')
    const first = await loadFlowConfig(path)
    first.approval.allow.push('changed')
    first.retention.days = 1

    const second = await loadFlowConfig(path)
    expect(second.approval.allow).toEqual([])
    expect(second.retention.days).toBe(30)
  })

  test('loads the complete config', async () => {
    const { loadFlowConfig } = await import('../src/index.js')
    const directory = await createDirectory()
    const path = join(directory, 'flows.json')
    await writeFile(
      path,
      JSON.stringify({
        siblings: {
          'system-one': { command: 'node', args: ['./server.mjs'], env: { MODE: 'test' } },
        },
        flowDirs: ['flows'],
        approval: { allow: ['system-one:predict'] },
        tracing: { otlp: { endpoint: 'http://localhost:4318/v1/traces', headers: {} } },
        logs: { level: 'debug' },
        retention: { days: 30 },
      }),
    )

    await expect(loadFlowConfig(path)).resolves.toEqual({
      siblings: {
        'system-one': {
          command: 'node',
          args: [join(directory, 'server.mjs')],
          env: { MODE: 'test' },
        },
      },
      flowDirs: [join(directory, 'flows')],
      approval: { allow: ['system-one:predict'] },
      tracing: { otlp: { endpoint: 'http://localhost:4318/v1/traces', headers: {} } },
      logs: { level: 'debug' },
      retention: { days: 30 },
    })
  })

  test('names the file and every invalid field', async () => {
    const { FlowConfigError, loadFlowConfig } = await import('../src/index.js')
    const directory = await createDirectory()
    const path = join(directory, 'invalid.json')
    await writeFile(
      path,
      JSON.stringify({
        siblings: { 'system-one': { command: 1 } },
        logs: { level: 'quiet' },
        retention: { days: 0 },
      }),
    )

    const error = await loadFlowConfig(path).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(FlowConfigError)
    if (!(error instanceof FlowConfigError)) throw error
    expect(error.path).toBe(path)
    expect(error.issues).toContain('siblings.system-one.command')
    expect(error.issues).toContain('logs.level')
    expect(error.issues).toContain('retention.days')
  })

  test('rejects unknown fields, invalid JSON and invalid retention days', async () => {
    const { FlowConfigError, loadFlowConfig } = await import('../src/index.js')
    const directory = await createDirectory()
    const cases: Array<[string, string, string]> = [
      ['unknown.json', '{"predictor":"fake"}', 'predictor'],
      ['malformed.json', '{', 'JSON'],
      ['zero.json', '{"retention":{"days":0}}', 'retention.days'],
      ['negative.json', '{"retention":{"days":-1}}', 'retention.days'],
      ['fraction.json', '{"retention":{"days":1.5}}', 'retention.days'],
      ['extra.json', '{"logs":{"level":"info","extra":true}}', 'logs.extra'],
    ]
    for (const [name, content, issue] of cases) {
      const path = join(directory, name)
      await writeFile(path, content)
      const error = await loadFlowConfig(path).catch((value: unknown) => value)
      expect(error).toBeInstanceOf(FlowConfigError)
      if (!(error instanceof FlowConfigError)) throw error
      expect(error.path).toBe(path)
      expect(error.issues.join(' ')).toContain(issue)
    }
  })

  test('resolves only intended paths and expands home paths', async () => {
    const { loadFlowConfig } = await import('../src/index.js')
    const directory = await createDirectory()
    const path = join(directory, 'config.json')
    await writeFile(
      path,
      JSON.stringify({
        flowDirs: ['flows', '~/flows', '/var/flows', '~other/flows'],
        siblings: {
          worker: {
            command: 'node',
            args: [
              './worker.js',
              'worker.mjs',
              '../worker.cjs',
              '~/worker.js',
              '/opt/worker.js',
              '--inspect',
              '--config=settings.js',
              'https://example.com/code.js',
              'file:worker.js',
              'node:worker',
              'ordinary',
            ],
          },
        },
      }),
    )

    const config = await loadFlowConfig(path)
    expect(config.flowDirs).toEqual([
      join(directory, 'flows'),
      join(homedir(), 'flows'),
      '/var/flows',
      '~other/flows',
    ])
    expect(config.siblings.worker?.args).toEqual([
      join(directory, 'worker.js'),
      join(directory, 'worker.mjs'),
      join(directory, '../worker.cjs'),
      join(homedir(), 'worker.js'),
      '/opt/worker.js',
      '--inspect',
      '--config=settings.js',
      'https://example.com/code.js',
      'file:worker.js',
      'node:worker',
      'ordinary',
    ])
  })
})
