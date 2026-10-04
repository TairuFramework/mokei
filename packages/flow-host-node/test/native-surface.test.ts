import type { InboxItem } from '@mokei/flow-host'
import { expect, test, vi } from 'vitest'

import type { FlowDesktopAdapter } from '../src/desktop.js'
import { createNativeSurface } from '../src/native-surface.js'

const item: InboxItem = {
  id: 'a/b',
  runID: 'a',
  kind: 'input',
  inputKey: 'value',
  message: 'Private input',
  requestedSchema: { type: 'object', properties: {} },
  createdAt: 1,
}
function setup(url: URL | undefined = new URL('http://127.0.0.1:4000/'), notifications = true) {
  const adapter: FlowDesktopAdapter = {
    canPrompt: () => true,
    prompt: vi.fn<FlowDesktopAdapter['prompt']>(async () => ({ action: 'cancel' })),
    notify: vi.fn(async () => {}),
    dispose: async () => {},
  }
  const openURL = vi.fn(async () => {})
  const errors: Array<unknown> = []
  const surface = createNativeSurface({
    adapter,
    notifications,
    host: () => {
      throw new Error('Unexpected dialog')
    },
    monitorURL: () => url,
    openURL,
    onError: (error) => errors.push(error),
  })
  return { surface, adapter, openURL, errors }
}
test('native notification click opens the encoded monitor item URL', async () => {
  const { surface, adapter, openURL } = setup()
  const delivery = await surface.notify(item, { signal: new AbortController().signal })
  const [message, options] = vi.mocked(adapter.notify).mock.calls[0] ?? []
  expect(message).toBe('Flow needs your input')
  expect(options?.group).toBe('mokei-inbox-a/b')
  options?.onClick?.()
  expect(openURL).toHaveBeenCalledWith('http://127.0.0.1:4000/inbox/a%2Fb')
  delivery?.close()
  await delivery?.closed
  expect(options?.signal?.aborted).toBe(true)
  options?.onClick?.()
  expect(openURL).toHaveBeenCalledTimes(1)
})
test('summary click opens the monitor inbox', () => {
  const { surface, adapter, openURL } = setup()
  surface.notifySummary(3)
  const [message, options] = vi.mocked(adapter.notify).mock.calls[0] ?? []
  expect(message).toBe('3 pending prompts')
  options?.onClick?.()
  expect(openURL).toHaveBeenCalledWith('http://127.0.0.1:4000/inbox')
})
test('disabled native notifications cannot deliver', async () => {
  const { surface, adapter } = setup(undefined, false)
  expect(surface.status()).toBe('unavailable')
  expect(await surface.notify(item, { signal: new AbortController().signal })).toBeNull()
  surface.notifySummary(2)
  expect(adapter.notify).not.toHaveBeenCalled()
})
test('failed URL opening is reported without escaping the click callback', async () => {
  const { surface, adapter, openURL, errors } = setup()
  const failure = new Error('Open failed')
  openURL.mockRejectedValue(failure)
  const delivery = await surface.notify(item, { signal: new AbortController().signal })
  vi.mocked(adapter.notify).mock.calls[0]?.[1]?.onClick?.()
  await vi.waitFor(() => expect(errors).toEqual([failure]))
  delivery?.close()
})

test('native delivery stays open after backend delivery until explicitly closed', async () => {
  const { surface } = setup()
  const delivery = await surface.notify(item, { signal: new AbortController().signal })
  let closed = false
  void delivery?.closed.then(() => {
    closed = true
  })
  await Promise.resolve()
  expect(closed).toBe(false)
  delivery?.close()
  delivery?.close()
  await delivery?.closed
  expect(closed).toBe(true)
  await surface.dispose()
})
