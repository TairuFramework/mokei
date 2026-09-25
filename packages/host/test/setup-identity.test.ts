import { EventEmitter } from '@sozai/event'
import { describe, expect, test } from 'vitest'

import { ContextHost } from '../src/host.js'

describe('ContextHost.setup identity', () => {
  test('does not write stale tools into a replacement context', async () => {
    const host = new ContextHost()
    const tool = { name: 'old', inputSchema: { type: 'object' } }
    const oldContext = {
      client: { events: new EventEmitter(), listTools: async () => ({ tools: [tool] }) },
      disposer: { dispose: async () => {} },
      tools: [],
    }
    const replacement = {
      client: { events: new EventEmitter(), listTools: async () => ({ tools: [] }) },
      disposer: { dispose: async () => {} },
      tools: [],
    }
    host.registerHostedContext({ key: 'shared', context: oldContext as never })

    let release: (value: boolean) => void = () => {}
    let entered: () => void = () => {}
    const enteredCallback = new Promise<void>((resolve) => {
      entered = resolve
    })
    const setup = host.setup({
      key: 'shared',
      enableTools: async () => {
        entered()
        return new Promise<boolean>((resolve) => {
          release = resolve
        })
      },
    })
    await enteredCallback
    await host.remove('shared')
    host.registerHostedContext({ key: 'shared', context: replacement as never })
    release(true)

    await expect(setup).rejects.toThrow('was removed during setup')
    expect(host.getContext('shared').tools).toEqual([])
    await host.dispose()
  })
})
