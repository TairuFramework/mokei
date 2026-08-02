/**
 * @vitest-environment jsdom
 */
import { act, createElement, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  type UseSlashCommandsParams,
  useSlashCommands,
} from '../../src/chat/hooks/useSlashCommands.js'
import type { TranscriptEntry } from '../../src/chat/transcript.js'

type Dispatch = (raw: string) => Promise<void>

type Harness = {
  dispatch: Dispatch
  addContext: ReturnType<typeof vi.fn>
  entries: Array<TranscriptEntry>
  unmount: () => void
}

function renderSlashCommands(): Harness {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const entries: Array<TranscriptEntry> = []
  const addContext = vi.fn(async () => [])
  const params: UseSlashCommandsParams = {
    model: 'test-model',
    setModel: () => {},
    setModal: () => {},
    setConfirmRemove: () => {},
    setPendingPrompt: () => {},
    loadModels: async () => [],
    pushEntry: (entry) => {
      entries.push(entry as TranscriptEntry)
    },
    contexts: [],
    addContext: addContext as unknown as UseSlashCommandsParams['addContext'],
    submit: async () => {},
    exit: () => {},
    showReasoning: false,
    setShowReasoning: () => {},
    getLastReasoning: () => '',
    getLastErrorDetail: () => null,
  }

  const box: { current: Dispatch | null } = { current: null }
  function Harness() {
    const dispatch = useSlashCommands(params)
    const boxRef = useRef(box)
    useEffect(() => {
      boxRef.current.current = dispatch
    })
    box.current = dispatch
    return null
  }

  const root = createRoot(container)
  act(() => {
    root.render(createElement(Harness))
  })

  return {
    dispatch: (raw) => {
      const current = box.current
      if (current == null) throw new Error('hook not mounted')
      return current(raw)
    },
    addContext,
    entries,
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe('useSlashCommands — /context add', () => {
  const handles: Array<Harness> = []
  afterEach(() => {
    while (handles.length) handles.pop()?.unmount()
  })

  function harness(): Harness {
    const handle = renderSlashCommands()
    handles.push(handle)
    return handle
  }

  test('passes a leading --protocol through to addContext and drops it from the positionals', async () => {
    const { dispatch, addContext } = harness()
    await dispatch('/context add --protocol 2025-11-25 db sqlite-server --file x.db')
    expect(addContext).toHaveBeenCalledWith({
      key: 'db',
      command: 'sqlite-server',
      args: ['--file', 'x.db'],
      protocolVersion: '2025-11-25',
    })
  })

  test('accepts the -p short form', async () => {
    const { dispatch, addContext } = harness()
    await dispatch('/context add -p 2025-11-25 db sqlite-server')
    expect(addContext).toHaveBeenCalledWith({
      key: 'db',
      command: 'sqlite-server',
      args: [],
      protocolVersion: '2025-11-25',
    })
  })

  // Killing mutation: dropping the `= 'auto'` initializer in `useSlashCommands.ts`, which
  // leaves `protocolVersion` `undefined` and lets the host's `'2026-07-28'` default leak
  // through. That default rejects a `2025-11-25`-only server with `-32022`, and `/context add`
  // is the primary attach path for exactly those servers. `mokei inspect` passes `'auto'` to
  // `.option()` for the same reason; this keeps the two defaults in step.
  test("defaults to 'auto' when no flag is given, rather than falling through to the host", async () => {
    const { dispatch, addContext } = harness()
    await dispatch('/context add db sqlite-server')
    expect(addContext).toHaveBeenCalledWith({
      key: 'db',
      command: 'sqlite-server',
      args: [],
      protocolVersion: 'auto',
    })
  })

  test('rejects an unsupported revision without spawning anything', async () => {
    const { dispatch, addContext, entries } = harness()
    await dispatch('/context add --protocol 2024-01-01 db sqlite-server')
    expect(addContext).not.toHaveBeenCalled()
    expect(entries.at(-1)).toMatchObject({
      kind: 'notice',
      variant: 'error',
      text: expect.stringContaining('2024-01-01'),
    })
  })

  test('reports the usage line when the flag consumed the only positionals', async () => {
    const { dispatch, addContext, entries } = harness()
    await dispatch('/context add --protocol auto db')
    expect(addContext).not.toHaveBeenCalled()
    expect(entries.at(-1)).toMatchObject({
      kind: 'notice',
      variant: 'error',
      text: 'usage: /context add [--protocol <version>] <key> <cmd> [args...]',
    })
  })
})
