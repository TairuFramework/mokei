/**
 * @vitest-environment jsdom
 */
import { act, createElement, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test } from 'vitest'

import { useToolApproval } from '../../src/chat/hooks/useToolApproval.js'

type HookAPI = ReturnType<typeof useToolApproval>

/**
 * Minimal renderHook that mounts in a jsdom container and synchronously
 * captures the latest hook return value via a ref updated each render.
 */
function renderHook() {
  const container = document.createElement('div')
  document.body.appendChild(container)

  // We use a ref-box so the test always sees the latest render value.
  const box: { current: HookAPI | null } = { current: null }

  function Harness() {
    const api = useToolApproval()
    const boxRef = useRef(box)
    useEffect(() => {
      boxRef.current.current = api
    })
    box.current = api // also capture synchronously during render
    return null
  }

  const root = createRoot(container)
  act(() => {
    root.render(createElement(Harness))
  })

  return {
    get api(): HookAPI {
      if (box.current === null) throw new Error('hook not mounted')
      return box.current
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe('useToolApproval', () => {
  const handles: Array<{ unmount: () => void }> = []
  afterEach(() => {
    while (handles.length) handles.pop()?.unmount()
  })

  test('approve resolves the pending promise with true and clears pending', async () => {
    const handle = renderHook()
    handles.push(handle)

    const promise = handle.api.toolApprovalFn(
      { id: '1', name: 'ns:tool', arguments: '{}' },
      { iteration: 1, history: [] },
    )

    // Let React process the setState from toolApprovalFn
    await act(async () => {
      await Promise.resolve()
    })

    expect(handle.api.pending?.call.name).toBe('ns:tool')

    await act(async () => {
      handle.api.approve()
    })

    await expect(promise).resolves.toBe(true)
    expect(handle.api.pending).toBeNull()
  })

  test('deny resolves the pending promise with false', async () => {
    const handle = renderHook()
    handles.push(handle)

    const promise = handle.api.toolApprovalFn(
      { id: '2', name: 'ns:tool', arguments: '{}' },
      { iteration: 1, history: [] },
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(handle.api.pending?.call.name).toBe('ns:tool')

    await act(async () => {
      handle.api.deny()
    })

    await expect(promise).resolves.toBe(false)
    expect(handle.api.pending).toBeNull()
  })
})
