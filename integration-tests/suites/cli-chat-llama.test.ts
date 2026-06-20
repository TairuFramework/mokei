import { afterEach, describe, expect, test } from 'vitest'

import { ChatDriver, UI } from '../support/chat-driver.js'

const GGUF = process.env.MOKEI_LLAMA_GGUF

// Gated on a local GGUF; not run in CI. Requires the cli `dist` to be built.
describe.skipIf(!GGUF)('CLI chat — llama', () => {
  let driver: ChatDriver

  afterEach(() => driver?.kill())

  test('starts with -m as the GGUF path and answers a prompt', async () => {
    driver = new ChatDriver({ provider: 'llama', model: GGUF })
    expect(await driver.start(60_000)).toBe(true)
    await driver.submit('Say hello in one word.')
    expect(await driver.waitForIdle(120_000)).toBe(true)
    expect(driver.screen()).toContain(UI.assistant)
  }, 200_000)

  test('prompts for the GGUF path when -m is omitted', async () => {
    driver = new ChatDriver({ provider: 'llama', model: null })
    expect(await driver.enterLlamaPath(GGUF as string)).toBe(true)
    expect(await driver.start(60_000)).toBe(true)
  }, 90_000)
})
