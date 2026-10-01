import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createStubDesktop } from '../../../integration-tests/support/flow-rig/stub-desktop.mjs'
import { createRig } from '../serve.mjs'

async function writeConfig() {
  const dir = await mkdtemp(join(tmpdir(), 'flow-rig-create-'))
  const flowsDir = join(dir, 'flows')
  await mkdir(flowsDir)
  await copyFile(
    new URL('../flows/demo-ask.json', import.meta.url),
    join(flowsDir, 'demo-ask.json'),
  )
  const configPath = join(dir, 'rig.config.json')
  await writeFile(
    configPath,
    JSON.stringify({
      siblings: {},
      flowsDir,
      predictor: 'fake',
      input: 'inbox',
      confirm: 'deny',
    }),
  )
  return { dir, configPath }
}

test('createRig returns the facade tools without serving stdio', async () => {
  const { dir, configPath } = await writeConfig()

  try {
    const rig = await createRig({ configPath, logger: () => {} })
    assert.deepEqual(Object.keys(rig.tools).sort(), [
      'answer_input',
      'cancel_flow',
      'check_flow',
      'decline_input',
      'flow_status',
      'list_flows',
      'prompt_input',
      'start_flow',
    ])
    await rig.shutdown()
    await rig.shutdown()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('createRig accepts the injected desktop options', async () => {
  const { dir, configPath } = await writeConfig()
  const backendNames = []
  const createBackend = (name) => {
    backendNames.push(name)
    return {}
  }
  const runner = {
    calls: 0,
    run() {
      this.calls += 1
      return Promise.reject(new Error('unexpected'))
    },
  }

  try {
    const rig = await createRig({
      configPath,
      desktop: { createBackend, runner, platform: 'linux', env: {} },
      logger: () => {},
    })
    await rig.shutdown()
    assert.equal(runner.calls, 0)
    assert.deepEqual(backendNames, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

async function call(rig, name, input = {}) {
  return await rig.tools[name].handler({ input, signal: new AbortController().signal })
}

async function pendingInput(rig, runID) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await call(rig, 'flow_status', { runID })
    if (result.structuredContent.pending.length > 0) return result.structuredContent.pending[0]
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('No pending input')
}

test('a rejected desktop prompt leaves the input open for a valid answer', async () => {
  const { dir, configPath } = await writeConfig()
  const stub = createStubDesktop()
  const rig = await createRig({
    configPath,
    logger: () => {},
    desktop: {
      ...stub.desktop,
      createBackend: (name) => ({
        name,
        ask: async () => {
          throw new Error('backend failed')
        },
        notify: async () => {},
      }),
    },
  })
  try {
    const { runID } = (await call(rig, 'start_flow', { flow: 'demo/ask' })).structuredContent
    const entry = await pendingInput(rig, runID)
    const errors = []
    const originalError = console.error
    console.error = (...args) => errors.push(args)
    let failed
    try {
      failed = await call(rig, 'prompt_input', { id: entry.id })
    } finally {
      console.error = originalError
    }
    assert.equal(failed.isError, true)
    assert.match(failed.content[0].text, /backend failed/)
    assert.ok(errors.some((args) => args.some((value) => /backend failed/.test(String(value)))))
    assert.equal((await pendingInput(rig, runID)).id, entry.id)
    const invalid = await call(rig, 'answer_input', { id: entry.id, value: { value: 12 } })
    assert.equal(invalid.isError, true)
    assert.equal((await pendingInput(rig, runID)).id, entry.id)
    const answered = await call(rig, 'answer_input', { id: entry.id, value: { value: 'hi' } })
    assert.deepEqual(answered.structuredContent, { id: entry.id, action: 'accept' })
  } finally {
    await rig.shutdown()
    await stub.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})
