// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, test, vi } from 'vitest'

import { type SessionLike, useSession } from '../../src/chat/hooks/useSession.js'

type Listener = (e: unknown) => void

function mockSession(): SessionLike & { emit: (name: string, payload: unknown) => void } {
  const listeners = new Map<string, Array<Listener>>()
  return {
    events: {
      on(name: string, fn: Listener) {
        const list = listeners.get(name) ?? []
        list.push(fn)
        listeners.set(name, list)
        return () => {
          const l = listeners.get(name) ?? []
          listeners.set(
            name,
            l.filter((x) => x !== fn),
          )
        }
      },
    } as unknown as SessionLike['events'],
    addContext: vi.fn(async () => []) as unknown as SessionLike['addContext'],
    removeContext: vi.fn() as unknown as SessionLike['removeContext'],
    contextHost: {
      getContextKeys: () => [] as Array<string>,
    } as unknown as SessionLike['contextHost'],
    emit(name: string, payload: unknown) {
      for (const fn of listeners.get(name) ?? []) fn(payload)
    },
  }
}

async function renderHook<T>(fn: () => T) {
  const container = document.createElement('div')
  const root = createRoot(container)
  let latest!: T
  function Probe() {
    latest = fn()
    return null
  }
  await act(async () => {
    root.render(<Probe />)
  })
  return {
    current: () => latest,
    unmount: () => root.unmount(),
  }
}

describe('useSession', () => {
  test('context-added event appends to contexts state', async () => {
    const session = mockSession()
    const hook = await renderHook(() => useSession(session))

    expect(hook.current().contexts).toEqual([])

    await act(async () => {
      session.emit('context-added', { key: 'sqlite', tools: [] })
    })

    expect(hook.current().contexts).toEqual(['sqlite'])
    hook.unmount()
  })

  test('context-removed event removes key from contexts state', async () => {
    const session = mockSession()
    const hook = await renderHook(() => useSession(session))

    await act(async () => {
      session.emit('context-added', { key: 'sqlite', tools: [] })
      session.emit('context-added', { key: 'fs', tools: [] })
    })

    expect(hook.current().contexts).toEqual(['sqlite', 'fs'])

    await act(async () => {
      session.emit('context-removed', { key: 'sqlite' })
    })

    expect(hook.current().contexts).toEqual(['fs'])
    hook.unmount()
  })
})
