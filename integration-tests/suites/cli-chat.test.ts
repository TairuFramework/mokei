import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { ChatDriver, UI } from '../support/chat-driver.js'
import { hasChatBackend, TOOL_CALL_PROMPT, TOOL_CALL_RETRY } from '../support/requirements.js'

describe.skipIf(!hasChatBackend)('CLI chat — core', () => {
  let driver: ChatDriver

  beforeEach(async () => {
    driver = new ChatDriver()
    expect(await driver.start()).toBe(true)
    expect(await driver.addFetchContext()).toBe(true)
  })

  afterEach(() => driver.kill())

  test('approve a tool call through to a final answer', {
    retry: TOOL_CALL_RETRY,
    timeout: 150_000,
  }, async () => {
    await driver.submit(TOOL_CALL_PROMPT)
    expect(await driver.waitForApproval()).toBe(true)
    driver.approve()
    expect(await driver.waitForIdle(90_000)).toBe(true)
    expect(driver.screen()).toContain(UI.assistant)
  })

  test('esc cancels a turn in flight', async () => {
    await driver.submit(TOOL_CALL_PROMPT)
    expect(await driver.waitForActive(30_000)).toBe(true)
    driver.esc()
    expect(await driver.waitForIdle(10_000)).toBe(true)
    expect(driver.screen()).toContain(UI.aborted)
  }, 90_000)

  test('interactive provider select starts chat after selection', async () => {
    const selectDriver = new ChatDriver({ provider: null, model: null })
    try {
      expect(await selectDriver.waitFor(UI.providerSelect, 15_000)).toBe(true)
      // Press enter to select the first option (ollama)
      selectDriver.write('\r')
      // After selection, the chat should start (shows the ready prompt once connected)
      expect(await selectDriver.waitFor(UI.ready, 30_000)).toBe(true)
    } finally {
      selectDriver.kill()
    }
  }, 60_000)

  // Regression: quitting must actually terminate the process. The session holds a
  // persistent daemon socket that keeps the event loop alive, so the command must
  // exit explicitly — otherwise two Ctrl+C stop the app but the process hangs and
  // needs a third (which pnpm reports as a command failure).
  test('two Ctrl+C quits and the process exits cleanly', async () => {
    const quitDriver = new ChatDriver()
    try {
      expect(await quitDriver.start()).toBe(true)
      quitDriver.interrupt()
      await new Promise((r) => setTimeout(r, 300))
      quitDriver.interrupt()
      const exit = await quitDriver.waitForExit(8_000)
      expect(exit).not.toBeNull()
      expect(exit?.exitCode).toBe(0)
    } finally {
      quitDriver.kill()
    }
  }, 30_000)
})
