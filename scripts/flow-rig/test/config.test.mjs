import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { loadConfig, matchesAllow, REPO_ROOT } from '../config.mjs'

async function writeConfig(value) {
  const dir = await mkdtemp(join(tmpdir(), 'flow-rig-config-'))
  const path = join(dir, 'rig.config.json')
  await writeFile(path, JSON.stringify(value))
  return { dir, path }
}

test('matchesAllow matches globs within one segment', () => {
  assert.equal(matchesAllow('sqlite:sqlite_get', ['sqlite:*']), true)
  assert.equal(matchesAllow('sqlite:sqlite_get', ['sqlite:sqlite_all']), false)
  assert.equal(matchesAllow('a:b:c', ['a:*']), false)
  assert.equal(matchesAllow('a:b', ['a:b']), true)
  assert.equal(matchesAllow('a:b', []), false)
})

test('loadConfig fills defaults', async () => {
  const { dir, path } = await writeConfig({ siblings: {} })
  const config = await loadConfig(path)
  assert.deepEqual(config, {
    siblings: {},
    flowsDir: join(dir, 'flows'),
    allow: [],
    predictor: 'real',
    fakeAnswers: {},
    input: 'inbox',
    confirm: 'desktop',
  })
})

test('loadConfig resolves relative paths', async () => {
  const { dir, path } = await writeConfig({
    siblings: {
      s: { command: 'node', args: ['mcp-servers/s/lib/serve.js', '--flag', '/abs/x.js'] },
    },
    flowsDir: 'my-flows',
  })
  const config = await loadConfig(path)
  assert.deepEqual(config.siblings.s.args, [
    join(REPO_ROOT, 'mcp-servers/s/lib/serve.js'),
    '--flag',
    '/abs/x.js',
  ])
  assert.equal(config.flowsDir, join(dir, 'my-flows'))
})

for (const field of ['predictor', 'input', 'confirm']) {
  test(`loadConfig rejects invalid ${field}`, async () => {
    const { path } = await writeConfig({ siblings: {}, [field]: 'x' })
    await assert.rejects(loadConfig(path), (error) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, new RegExp(field))
      return true
    })
  })
}
