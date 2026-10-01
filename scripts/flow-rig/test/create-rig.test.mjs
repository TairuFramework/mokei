import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

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
    const rig = await createRig({ configPath })
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
    })
    await rig.shutdown()
    assert.equal(runner.calls, 0)
    assert.deepEqual(backendNames, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
