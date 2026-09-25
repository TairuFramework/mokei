import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { NodeSession } from '../src/node-session.js'

const ECHO_SERVER = fileURLToPath(new URL('./fixtures/echo-server.mjs', import.meta.url))
const server = { command: process.execPath, args: [ECHO_SERVER] }

describe('NodeSession.addContext cleanup', () => {
  let session: NodeSession | undefined

  afterEach(async () => {
    await session?.dispose()
    session = undefined
  })

  test('emits context-added after successful stdio setup', async () => {
    session = new NodeSession()
    const onAdded = vi.fn()
    session.events.on('context-added', onAdded)

    const tools = await session.addContext({ key: 'echo', ...server })

    expect(onAdded).toHaveBeenCalledWith({ key: 'echo', tools })
  })

  test('abort during tool selection cannot alter a replacement context', async () => {
    session = new NodeSession()
    const controller = new AbortController()
    const onAdded = vi.fn()
    session.events.on('context-added', onAdded)
    let selectionEntered: () => void = () => {}
    let releaseSelection: (enabled: boolean) => void = () => {}
    const entered = new Promise<void>((resolve) => {
      selectionEntered = resolve
    })
    const selected = new Promise<boolean>((resolve) => {
      releaseSelection = resolve
    })
    const first = session.addContext({
      key: 'shared',
      ...server,
      signal: controller.signal,
      enableTools: async () => {
        selectionEntered()
        return selected
      },
    })
    await entered
    controller.abort()
    await expect(first).rejects.toThrow()

    const replacementTools = await session.addContext({ key: 'shared', ...server })
    releaseSelection(false)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(session.contextHost.getContext('shared').tools).toEqual(replacementTools)
    expect(replacementTools.every((tool) => tool.enabled)).toBe(true)
    expect(onAdded).toHaveBeenCalledTimes(1)
  })

  test.each([false, true])(
    'duplicate key leaves the pre-existing context in place with signal=%s',
    async (signal) => {
      session = new NodeSession()
      await session.addContext({ key: 'same', ...server })
      const original = session.contextHost.getContext('same').client
      const remove = vi.spyOn(session.contextHost, 'remove')

      await expect(
        session.addContext({
          key: 'same',
          ...server,
          signal: signal ? new AbortController().signal : undefined,
        }),
      ).rejects.toThrow('already exists')

      expect(session.contextHost.getContext('same').client).toBe(original)
      expect(remove).not.toHaveBeenCalledWith('same')
    },
  )

  test.each([false, true])(
    'failed setup removes its own context with signal=%s',
    async (signal) => {
      session = new NodeSession()
      vi.spyOn(session.contextHost, 'setup').mockRejectedValue(new Error('setup failed'))

      await expect(
        session.addContext({
          key: 'failed',
          ...server,
          signal: signal ? new AbortController().signal : undefined,
        }),
      ).rejects.toThrow('setup failed')

      expect(session.contextHost.getContextKeys()).not.toContain('failed')
    },
  )

  test.each([false, true])(
    'failed setup keeps a replacement context with the same key with signal=%s',
    async (signal) => {
      session = new NodeSession()
      const ours = { id: 'ours' }
      const replacement = { id: 'replacement' }
      vi.spyOn(session.contextHost, 'addLocalContext').mockResolvedValue(ours as never)
      vi.spyOn(session.contextHost, 'setup').mockRejectedValue(new Error('setup failed'))
      vi.spyOn(session.contextHost, 'getContext').mockReturnValue({ client: replacement } as never)
      const remove = vi.spyOn(session.contextHost, 'remove')

      await expect(
        session.addContext({
          key: 'reused',
          ...server,
          signal: signal ? new AbortController().signal : undefined,
        }),
      ).rejects.toThrow('setup failed')

      expect(remove).not.toHaveBeenCalledWith('reused')
    },
  )
})
