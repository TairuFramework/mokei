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
    // Wait directly for the assistant reply marker rather than the idle
    // transition: llama loads the model on the first prompt, so the status
    // sits at `idle` between submit and first token, and isIdle() can't tell
    // that pre-turn idle apart from post-turn idle. The `●` marker only
    // appears once the model actually answers.
    expect(await driver.waitFor(UI.assistant, 120_000)).toBe(true)
  }, 200_000)

  test('prompts for the GGUF path when -m is omitted', async () => {
    driver = new ChatDriver({ provider: 'llama', model: null })
    expect(await driver.enterLlamaPath(GGUF as string)).toBe(true)
    expect(await driver.start(60_000)).toBe(true)
  }, 90_000)
})
