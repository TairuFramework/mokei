// End-to-end smoke run: spawns serve.mjs over stdio and drives every facade tool.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { NodeContextHost } from '../../packages/host-node/lib/index.js'

const rigDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(rigDir, '../..')
const POLL_MS = 100
const WAIT_LIMIT_MS = 10_000
const SAFETY_TIMEOUT_MS = 60_000

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const host = new NodeContextHost()
let tempDir

async function cleanup() {
  await host.dispose().catch(() => {})
  if (tempDir != null) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function fail(error) {
  console.error(`FAIL ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  await cleanup()
  process.exit(1)
}

const safety = setTimeout(() => {
  fail(new Error(`Smoke run exceeded ${SAFETY_TIMEOUT_MS} ms`))
}, SAFETY_TIMEOUT_MS)
safety.unref()

async function call(name, args = {}) {
  const result = await host.callNamespacedTool({ id: `rig:${name}`, arguments: args })
  return result
}

function data(result) {
  assert.notEqual(result.isError, true, `tool error: ${JSON.stringify(result)}`)
  return result.structuredContent ?? result
}

async function waitFor(runID, predicate, what) {
  const deadline = Date.now() + WAIT_LIMIT_MS
  let last
  while (Date.now() < deadline) {
    last = data(await call('flow_status', { runID }))
    if (predicate(last)) return last
    await sleep(POLL_MS)
  }
  throw new Error(`Timed out waiting for ${what}; last status: ${JSON.stringify(last)}`)
}

const isDone = (status) => status.state === 'completed'
const ended = (status) => status.result?.structuredContent ?? {}

async function startAndAwaitPending(flow) {
  const { runID } = data(await call('start_flow', { flow }))
  assert.ok(runID, 'start_flow returned no runID')
  const status = await waitFor(runID, (s) => s.pending.length === 1, 'one pending input')
  return { runID, inputID: status.pending[0].id }
}

function ok(name) {
  console.log(`ok ${name}`)
}

async function run() {
  tempDir = await mkdtemp(join(tmpdir(), 'flow-rig-smoke-'))
  const configPath = join(tempDir, 'rig.config.json')
  await writeFile(
    configPath,
    JSON.stringify({
      siblings: {
        'system-one': { command: 'node', args: ['mcp-servers/system-one/lib/serve.js'] },
        sqlite: { command: 'node', args: ['mcp-servers/sqlite/lib/serve.js'] },
      },
      flowsDir: join(rigDir, 'flows'),
      allow: ['sqlite:sqlite_get'],
      predictor: 'fake',
      fakeAnswers: {
        label: {
          type: 'choice',
          choice: 'question',
          confidence: 0.9,
          probabilities: { bug: 0.1, question: 0.9 },
        },
      },
      input: 'inbox',
      confirm: 'deny',
    }),
  )

  await host.addLocalContext({
    key: 'rig',
    command: 'node',
    args: ['scripts/flow-rig/serve.mjs'],
    cwd: repoRoot,
    env: { ...process.env, FLOW_RIG_CONFIG: configPath },
  })
  await host.setup({ key: 'rig' })

  // 1. list_flows
  const listed = JSON.stringify(data(await call('list_flows')))
  for (const id of ['demo/ask', 'demo/nested', 'demo/triage']) {
    assert.ok(listed.includes(id), `list_flows is missing ${id}: ${listed}`)
  }
  ok('list_flows')

  // 2. check_flow
  const checked = data(await call('check_flow', { definition: { id: 'bad', nodes: {} } }))
  assert.equal(checked.ok, false)
  assert.ok(checked.issues?.length > 0, 'expected issues')
  ok('check_flow reports issues')

  // 3. answer
  {
    const { runID, inputID } = await startAndAwaitPending('demo/ask')
    data(await call('answer_input', { id: inputID, value: { value: 'hi' } }))
    const done = await waitFor(runID, isDone, 'demo/ask completion')
    assert.equal(ended(done).outcome, 'answered')
    assert.equal(ended(done).output?.value, 'hi')
    ok('demo/ask answered')
  }

  // 4. decline
  {
    const { runID, inputID } = await startAndAwaitPending('demo/ask')
    data(await call('decline_input', { id: inputID }))
    const done = await waitFor(runID, isDone, 'demo/ask decline completion')
    assert.equal(ended(done).outcome, 'declined')
    ok('demo/ask declined')
  }

  // 5. nested
  {
    const { runID, inputID } = await startAndAwaitPending('demo/nested')
    data(await call('answer_input', { id: inputID, value: { value: 'hi' } }))
    const done = await waitFor(runID, isDone, 'demo/nested completion')
    assert.equal(ended(done).outcome, 'answered')
    ok('demo/nested answered')
  }

  // 6. allowlist denial
  {
    const result = await call('start_flow', {
      definition: {
        id: 'denied',
        name: 'Denied',
        version: 1,
        start: 't',
        nodes: {
          t: {
            kind: 'tool',
            tool: 'sqlite:sqlite_all',
            args: { sql: { value: 'SELECT 1' } },
            next: 'e',
          },
          e: { kind: 'end', outcome: 'ok' },
        },
      },
    })
    assert.equal(result.isError, true, `expected an error result: ${JSON.stringify(result)}`)
    const text = JSON.stringify(result)
    assert.ok(
      text.includes('Flow denied: Not in allowlist: sqlite:sqlite_all'),
      `unexpected denial message: ${text}`,
    )
    ok('allowlist denies sqlite:sqlite_all')
  }

  // 7. triage with fake predictor
  {
    const { runID } = data(await call('start_flow', { flow: 'demo/triage' }))
    const done = await waitFor(runID, isDone, 'demo/triage completion')
    assert.equal(ended(done).outcome, 'triaged')
    assert.equal(ended(done).output?.row?.label, 'question')
    ok('demo/triage uses fake label')
  }

  // 8. cancel
  {
    const { runID } = await startAndAwaitPending('demo/ask')
    const cancelled = data(await call('cancel_flow', { runID }))
    assert.equal(cancelled.state, 'cancelled')
    const after = data(await call('flow_status', { runID }))
    assert.equal(after.state, 'cancelled')
    assert.deepEqual(after.pending, [])
    ok('cancel_flow clears pending')
  }
}

try {
  await run()
  clearTimeout(safety)
  await cleanup()
} catch (error) {
  await fail(error)
}
