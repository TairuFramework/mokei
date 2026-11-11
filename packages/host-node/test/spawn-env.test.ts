import { afterEach, beforeEach, expect, test } from 'vitest'

import { spawnContextServer } from '../src/spawn.js'

const script = 'process.stdout.write(String(process.env.LEAK_CHECK))'

async function run(
  env?: Record<string, string | null | undefined>,
  code = script,
): Promise<string> {
  const { childProcess, streams } = await spawnContextServer({
    command: process.execPath,
    args: ['-e', code],
    env,
  })
  let out = ''
  for await (const chunk of streams.readable) {
    out += chunk.toString()
  }
  await new Promise((resolve) => childProcess.once('close', resolve))
  return out
}

beforeEach(() => {
  process.env.LEAK_CHECK = 'daemon-only'
})

afterEach(() => {
  delete process.env.LEAK_CHECK
})

test('explicit env is the whole child environment', async () => {
  process.env.OTHER_CHECK = 'daemon-other'
  try {
    const out = await run(
      { PATH: process.env.PATH, LEAK_CHECK: 'given', NULLED: null },
      'process.stdout.write(JSON.stringify([process.env.LEAK_CHECK, process.env.OTHER_CHECK, process.env.NULLED]))',
    )
    expect(JSON.parse(out)).toEqual(['given', null, null])
  } finally {
    delete process.env.OTHER_CHECK
  }
})

test('omitted env inherits the parent environment', async () => {
  expect(await run()).toBe('daemon-only')
})
