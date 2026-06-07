import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { ChatDriver, FETCH_SERVER, UI } from '../support/chat-driver.js'

describe('CLI chat — context lifecycle', () => {
  let driver: ChatDriver

  beforeEach(async () => {
    driver = new ChatDriver()
    expect(await driver.start()).toBe(true)
  })

  afterEach(() => driver.kill())

  test('add opens the tool-select card and registers the context', async () => {
    await driver.type(`/context add fetch node ${FETCH_SERVER}`)
    driver.write('\r')
    expect(await driver.waitFor(UI.contextAdded, 15_000)).toBe(true)
    expect(await driver.waitFor(UI.toolSelect, 5_000)).toBe(true)
    expect(driver.screen()).toContain('fetch:get_markdown')
    driver.write('\r') // keep all enabled
    await driver.type('/context list')
    driver.write('\r')
    expect(await driver.waitFor('fetch', 5_000)).toBe(true)
  }, 60_000)

  test('remove asks for confirmation and removes on y', async () => {
    expect(await driver.addFetchContext()).toBe(true)
    await driver.type('/context remove fetch')
    driver.write('\r')
    expect(await driver.waitForConfirm()).toBe(true)
    driver.approve() // y
    expect(await driver.waitFor(UI.removed, 5_000)).toBe(true)
  }, 60_000)

  test('remove is cancelled on esc', async () => {
    expect(await driver.addFetchContext()).toBe(true)
    await driver.type('/context remove fetch')
    driver.write('\r')
    expect(await driver.waitForConfirm()).toBe(true)
    driver.esc() // cancel
    expect(await driver.waitFor('remove cancelled', 5_000)).toBe(true)
    await driver.type('/context list')
    driver.write('\r')
    expect(await driver.waitFor('fetch', 5_000)).toBe(true)
  }, 60_000)
})
