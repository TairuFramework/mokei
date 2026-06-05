import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { ChatDriver, UI } from '../support/chat-driver.js'

/**
 * End-to-end CLI tests: drive the real `mokei chat ollama` binary over a PTY.
 * Requires a running ollama with lfm2.5:latest, the built fetch MCP server, and
 * the cli `dist` built (the dev binary loads commands from dist/commands).
 */
const PROMPT = 'fetch info about https://mokei.dev and provide a summary'

describe('CLI chat (ollama) over a PTY', () => {
  let driver: ChatDriver

  beforeEach(async () => {
    driver = new ChatDriver()
    expect(await driver.start()).toBe(true)
    expect(await driver.addFetchContext()).toBe(true)
  })

  afterEach(() => {
    driver.kill()
  })

  test('renders the approval card, then completes after approving', async () => {
    await driver.submit(PROMPT)

    expect(await driver.waitFor(UI.approval, 45_000)).toBe(true)
    // The card surfaces the actual namespaced tool and its arguments.
    expect(driver.screen()).toContain('fetch:get_markdown')
    expect(driver.screen()).toContain('https://mokei.dev')

    driver.approve()

    expect(await driver.waitForIdle(90_000)).toBe(true)
    // An assistant answer was produced (icon-gutter marker).
    expect(driver.screen()).toContain(UI.assistant)
  }, 150_000)

  test('esc cancels the turn while the model is thinking', async () => {
    await driver.submit(PROMPT)

    expect(await driver.waitFor(UI.thinking, 30_000)).toBe(true)
    driver.esc()

    // The turn aborts promptly rather than hanging.
    expect(await driver.waitForIdle(10_000)).toBe(true)
    expect(driver.screen()).toContain(UI.aborted)
  }, 90_000)

  test('esc denies a pending tool approval and the turn settles', async () => {
    await driver.submit(PROMPT)

    expect(await driver.waitFor(UI.approval, 45_000)).toBe(true)
    driver.esc() // ToolApprovalCard treats esc as deny

    // Model receives the denial and the turn returns to idle (no abort error).
    expect(await driver.waitForIdle(90_000)).toBe(true)
  }, 150_000)
})
