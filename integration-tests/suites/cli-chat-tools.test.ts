import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { ChatDriver, UI } from '../support/chat-driver.js'

const PROMPT = 'fetch info about https://mokei.dev and provide a summary'

describe('CLI chat — tools', () => {
  let driver: ChatDriver

  beforeEach(async () => {
    driver = new ChatDriver()
    expect(await driver.start()).toBe(true)
    expect(await driver.addFetchContext()).toBe(true)
  })

  afterEach(() => driver.kill())

  test('approval card shows the namespaced tool and arguments', async () => {
    await driver.submit(PROMPT)
    expect(await driver.waitForApproval()).toBe(true)
    expect(driver.screen()).toContain('fetch:get_markdown')
    expect(driver.screen()).toContain('https://mokei.dev')
    driver.approve()
    expect(await driver.waitForIdle(90_000)).toBe(true)
  }, 150_000)

  test('denying a tool call returns to idle without aborting', async () => {
    await driver.submit(PROMPT)
    expect(await driver.waitForApproval()).toBe(true)
    driver.deny() // n
    expect(await driver.waitFor(UI.denied, 10_000)).toBe(true)
    expect(await driver.waitForIdle(90_000)).toBe(true)
    expect(driver.screen()).not.toContain(UI.aborted)
  }, 150_000)

  test('/tools lists the context tools', async () => {
    await driver.type('/tools')
    driver.write('\r')
    expect(await driver.waitFor(UI.toolSelect, 5_000)).toBe(true)
    expect(driver.screen()).toContain('fetch:get_markdown')
    driver.esc()
  }, 60_000)
})
