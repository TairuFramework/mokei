import { expect, test, vi } from 'vitest'

import { NodeContextHost } from '../src/node-host.js'

test('child exit removes the context with reason lost', async () => {
  const host = new NodeContextHost()
  const remove = vi.spyOn(host, 'remove')
  try {
    await host.addLocalContext({
      key: 'exiting',
      command: process.execPath,
      args: ['-e', 'setTimeout(() => process.exit(0), 100)'],
    })
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('exiting', 'lost'))
    expect(host.getContextKeys()).toEqual([])
  } finally {
    await host.dispose()
  }
})

test('stdout framing errors remove the context with reason lost', async () => {
  const host = new NodeContextHost()
  const remove = vi.spyOn(host, 'remove')
  try {
    await host.addLocalContext({
      key: 'broken',
      command: process.execPath,
      args: ['-e', "process.stdin.on('data', () => process.stdout.write('invalid JSON\\n'))"],
      protocolVersion: '2025-11-25',
    })
    await expect(host.setup({ key: 'broken' })).rejects.toThrow()
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('broken', 'lost'))
    expect(host.getContextKeys()).toEqual([])
  } finally {
    await host.dispose()
  }
})
