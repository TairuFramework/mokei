import { TaskExpiredError, TaskInputWithdrawnError } from '@mokei/context-client'
import type { ElicitResult } from '@mokei/context-protocol'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  createInputInbox,
  type DesktopElicitRequest,
  InboxAnswerInvalidError,
  InboxDisposedError,
  type InputInbox,
  type PendingInput,
} from '../src/index.js'

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    tags: {
      type: 'array',
      items: { type: 'string', enum: ['a', 'b'] },
    },
  },
  required: ['name'],
} as const

function request(overrides: Partial<DesktopElicitRequest> = {}): DesktopElicitRequest {
  return {
    key: 'ctx',
    params: {
      message: 'Who?',
      requestedSchema: schema,
    } as unknown as DesktopElicitRequest['params'],
    signal: new AbortController().signal,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('input inbox', () => {
  let inbox: InputInbox
  function pending(index: number): PendingInput {
    const entry = inbox.list()[index]
    if (entry == null) throw new Error(`No pending entry at ${index}`)
    return entry
  }
  afterEach(() => {
    inbox?.dispose()
    vi.restoreAllMocks()
  })

  test('add registers a pending entry and emits added', async () => {
    inbox = createInputInbox()
    const added: Array<unknown> = []
    inbox.events.on('added', (e) => {
      added.push(e)
    })
    const promise = inbox.add(request())
    const [entry] = [pending(0)]
    expect(entry).toMatchObject({
      key: 'ctx',
      message: 'Who?',
      requestedSchema: schema,
      canPrompt: false,
    })
    expect(typeof entry.id).toBe('string')
    expect(typeof entry.createdAt).toBe('number')
    expect(inbox.get(entry.id)).toEqual(entry)
    expect(added).toEqual([entry])
    inbox.cancel(entry.id)
    await promise
  })

  test('add with URL mode throws TypeError', () => {
    inbox = createInputInbox()
    const params = { mode: 'url', message: 'x', url: 'https://x.test', elicitationId: 'e' }
    expect(() =>
      inbox.add(request({ params: params as unknown as DesktopElicitRequest['params'] })),
    ).toThrow(TypeError)
    expect(inbox.list()).toEqual([])
  })

  test('add with an aborted signal rejects at once without entry or event', async () => {
    inbox = createInputInbox()
    const added = vi.fn()
    inbox.events.on('added', added)
    const controller = new AbortController()
    const reason = new Error('gone')
    controller.abort(reason)
    await expect(inbox.add(request({ signal: controller.signal }))).rejects.toBe(reason)
    expect(inbox.list()).toEqual([])
    expect(added).not.toHaveBeenCalled()
  })

  test('answer validates content and resolves accept', async () => {
    inbox = createInputInbox()
    const promise = inbox.add(request())
    const { id } = pending(0)
    expect(() => inbox.answer(id, { other: 1 })).toThrow(InboxAnswerInvalidError)
    let caught: unknown
    try {
      inbox.answer(id, { name: 1 })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(InboxAnswerInvalidError)
    const err = caught as InboxAnswerInvalidError
    expect(err.id).toBe(id)
    expect(err.issues.length).toBeGreaterThan(0)
    expect(err.message).toBe(`Invalid answer for input ${id}: ${err.issues.join('; ')}`)
    expect(() => inbox.answer(id, { name: 'x', tags: ['c'] })).toThrow(InboxAnswerInvalidError)
    expect(inbox.get(id)).toBeDefined()
    expect(inbox.answer(id, { name: 'x', tags: ['a', 'b'] })).toBe(true)
    await expect(promise).resolves.toEqual({
      action: 'accept',
      content: { name: 'x', tags: ['a', 'b'] },
    })
    expect(inbox.get(id)).toBeUndefined()
  })

  test('decline and cancel settle; gone entries return false', async () => {
    inbox = createInputInbox()
    const p1 = inbox.add(request())
    const p2 = inbox.add(request())
    const [a, b] = [pending(0), pending(1)]
    expect(inbox.decline(a.id)).toBe(true)
    expect(inbox.cancel(b.id)).toBe(true)
    await expect(p1).resolves.toEqual({ action: 'decline' })
    await expect(p2).resolves.toEqual({ action: 'cancel' })
    expect(inbox.decline(a.id)).toBe(false)
    expect(inbox.cancel(a.id)).toBe(false)
    expect(inbox.answer(a.id, { name: 'x' })).toBe(false)
  })

  test('settled has no content and events are observed before add settles', async () => {
    inbox = createInputInbox()
    const order: Array<string> = []
    const payloads: Array<unknown> = []
    inbox.events.on('added', () => {
      order.push('added')
    })
    inbox.events.on('settled', (e) => {
      order.push('settled')
      payloads.push(e)
    })
    const promise = inbox.add(request()).then((r) => {
      order.push('resolved')
      return r
    })
    const { id } = pending(0)
    inbox.answer(id, { name: 'secret' })
    await promise
    expect(order).toEqual(['added', 'settled', 'resolved'])
    expect(payloads).toEqual([{ id, action: 'accept' }])
    expect('content' in (payloads[0] as object)).toBe(false)
  })

  test('abort removes entry with aborted or withdrawn reason', async () => {
    inbox = createInputInbox()
    const removed: Array<unknown> = []
    inbox.events.on('removed', (e) => {
      removed.push(e)
    })
    const c1 = new AbortController()
    const c2 = new AbortController()
    const c3 = new AbortController()
    const p1 = inbox.add(request({ signal: c1.signal }))
    const p2 = inbox.add(request({ signal: c2.signal }))
    const p3 = inbox.add(request({ signal: c3.signal }))
    const [e1, e2, e3] = [pending(0), pending(1), pending(2)]
    const withdrawn = new TaskInputWithdrawnError({ taskID: 't', key: 'k' })
    const other = new Error('x')
    const expired = new TaskExpiredError({ taskID: 't' })
    c1.abort(withdrawn)
    c2.abort(other)
    c3.abort(expired)
    await expect(p1).rejects.toBe(withdrawn)
    await expect(p2).rejects.toBe(other)
    await expect(p3).rejects.toBe(expired)
    expect(removed).toEqual([
      { id: e1.id, reason: 'withdrawn' },
      { id: e2.id, reason: 'aborted' },
      { id: e3.id, reason: 'aborted' },
    ])
    expect(inbox.list()).toEqual([])
  })

  test('dispose rejects pending adds, emits removed, is idempotent', async () => {
    inbox = createInputInbox()
    const removed: Array<unknown> = []
    inbox.events.on('removed', (e) => {
      removed.push(e)
    })
    const promise = inbox.add(request())
    const { id } = pending(0)
    expect(inbox.disposed).toBe(false)
    inbox.dispose()
    inbox.dispose()
    expect(inbox.disposed).toBe(true)
    await expect(promise).rejects.toBeInstanceOf(InboxDisposedError)
    expect(removed).toEqual([{ id, reason: 'disposed' }])
    await expect(inbox.add(request())).rejects.toBeInstanceOf(InboxDisposedError)
    expect(new InboxDisposedError().message).toBe('Input inbox disposed')
  })

  describe('prompt', () => {
    test.each(['accept', 'decline', 'cancel'] as const)('settles on %s', async (action) => {
      inbox = createInputInbox()
      const result: ElicitResult =
        action === 'accept' ? { action, content: { name: 'z' } } : { action }
      const prompt = vi.fn(async () => result)
      const promise = inbox.add(request(), { prompt })
      const { id, canPrompt } = pending(0)
      expect(canPrompt).toBe(true)
      await expect(inbox.prompt(id)).resolves.toEqual(result)
      await expect(promise).resolves.toEqual(result)
      expect(inbox.get(id)).toBeUndefined()
    })

    test('concurrent prompts share one dialog', async () => {
      inbox = createInputInbox()
      const d = deferred<ElicitResult>()
      const prompt = vi.fn(() => d.promise)
      const promise = inbox.add(request(), { prompt })
      const { id } = pending(0)
      const p1 = inbox.prompt(id)
      const p2 = inbox.prompt(id)
      expect(prompt).toHaveBeenCalledTimes(1)
      d.resolve({ action: 'cancel' })
      await expect(p1).resolves.toEqual({ action: 'cancel' })
      await expect(p2).resolves.toEqual({ action: 'cancel' })
      await promise
    })

    test('prompt rejects with the signal reason and leaves the entry pending', async () => {
      inbox = createInputInbox()
      let promptSignal: AbortSignal | undefined
      const prompt = vi.fn((signal: AbortSignal) => {
        promptSignal = signal
        return new Promise<ElicitResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      })
      const answer = inbox.add(request(), { prompt })
      const { id } = pending(0)
      const caller = new AbortController()
      const reason = new Error('stop')
      const prompting = inbox.prompt(id, { signal: caller.signal })
      caller.abort(reason)
      await expect(prompting).rejects.toBe(reason)
      expect(promptSignal?.aborted).toBe(true)
      expect(inbox.get(id)).toBeDefined()
      const retry = inbox.prompt(id)
      expect(prompt).toHaveBeenCalledTimes(2)
      inbox.cancel(id)
      await expect(retry).resolves.toEqual({ action: 'cancel' })
      await answer
    })

    test('prompt with an already aborted signal does not open a dialog', async () => {
      inbox = createInputInbox()
      const prompt = vi.fn(async () => ({ action: 'cancel' as const }))
      const answer = inbox.add(request(), { prompt })
      const { id } = pending(0)
      const caller = new AbortController()
      const reason = new Error('stop')
      caller.abort(reason)
      await expect(inbox.prompt(id, { signal: caller.signal })).rejects.toBe(reason)
      expect(prompt).not.toHaveBeenCalled()
      expect(inbox.get(id)).toBeDefined()
      inbox.cancel(id)
      await answer
    })

    test('an abort after the entry settles elsewhere resolves with the outcome', async () => {
      inbox = createInputInbox()
      const d = deferred<ElicitResult>()
      const answer = inbox.add(request(), { prompt: () => d.promise })
      const { id } = pending(0)
      const caller = new AbortController()
      const prompting = inbox.prompt(id, { signal: caller.signal })
      const content = { name: 'answered' }
      inbox.answer(id, content)
      caller.abort(new Error('late'))
      await expect(prompting).resolves.toEqual({ action: 'accept', content })
      d.resolve({ action: 'cancel' })
      await answer
    })

    test('aborting a concurrent caller does not abort the shared prompt', async () => {
      inbox = createInputInbox()
      const d = deferred<ElicitResult>()
      let promptSignal: AbortSignal | undefined
      const prompt = vi.fn((signal: AbortSignal) => {
        promptSignal = signal
        return d.promise
      })
      const answer = inbox.add(request(), { prompt })
      const { id } = pending(0)
      const first = inbox.prompt(id)
      const secondCaller = new AbortController()
      const second = inbox.prompt(id, { signal: secondCaller.signal })
      expect(prompt).toHaveBeenCalledTimes(1)
      secondCaller.abort(new Error('second stopped'))
      await expect(second).rejects.toThrow('second stopped')
      expect(promptSignal?.aborted).toBe(false)
      d.resolve({ action: 'accept', content: { name: 'shared' } })
      await expect(first).resolves.toEqual({ action: 'accept', content: { name: 'shared' } })
      await answer
    })

    test('the shared prompt aborts only after both signalled callers abort', async () => {
      inbox = createInputInbox()
      let promptSignal: AbortSignal | undefined
      const prompt = vi.fn((signal: AbortSignal) => {
        promptSignal = signal
        return new Promise<ElicitResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      })
      const answer = inbox.add(request(), { prompt })
      const { id } = pending(0)
      const firstCaller = new AbortController()
      const secondCaller = new AbortController()
      const first = inbox.prompt(id, { signal: firstCaller.signal })
      const second = inbox.prompt(id, { signal: secondCaller.signal })
      firstCaller.abort(new Error('first stopped'))
      await expect(first).rejects.toThrow('first stopped')
      expect(promptSignal?.aborted).toBe(false)
      secondCaller.abort(new Error('second stopped'))
      await expect(second).rejects.toThrow('second stopped')
      expect(promptSignal?.aborted).toBe(true)
      inbox.cancel(id)
      await answer
    })

    test('prompt immediately after the last abort starts a new run', async () => {
      inbox = createInputInbox()
      const signals: Array<AbortSignal> = []
      const prompt = vi.fn((signal: AbortSignal) => {
        signals.push(signal)
        return new Promise<ElicitResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      })
      const answer = inbox.add(request(), { prompt })
      const { id } = pending(0)
      const caller = new AbortController()
      const first = inbox.prompt(id, { signal: caller.signal })
      caller.abort(new Error('stopped'))
      const second = inbox.prompt(id)
      expect(prompt).toHaveBeenCalledTimes(2)
      expect(signals[1]).not.toBe(signals[0])
      await expect(first).rejects.toThrow('stopped')
      inbox.cancel(id)
      await expect(second).resolves.toEqual({ action: 'cancel' })
      await answer
    })

    test('external answer aborts the open prompt and ignores its late result', async () => {
      inbox = createInputInbox()
      const d = deferred<ElicitResult>()
      let promptSignal: AbortSignal | undefined
      const promise = inbox.add(request(), {
        prompt: (signal) => {
          promptSignal = signal
          return d.promise
        },
      })
      const { id } = pending(0)
      const prompted = inbox.prompt(id)
      inbox.answer(id, { name: 'ext' })
      expect(promptSignal?.aborted).toBe(true)
      d.resolve({ action: 'accept', content: { name: 'late' } })
      await expect(promise).resolves.toEqual({ action: 'accept', content: { name: 'ext' } })
      await expect(prompted).resolves.toEqual({ action: 'accept', content: { name: 'ext' } })
    })

    test('a prompt rejecting with the abort reason after an external answer does not reject', async () => {
      inbox = createInputInbox()
      const promise = inbox.add(request(), {
        prompt: (signal) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason))
          }),
      })
      const { id } = pending(0)
      const prompted = inbox.prompt(id)
      inbox.decline(id)
      await expect(promise).resolves.toEqual({ action: 'decline' })
      await expect(prompted).resolves.toEqual({ action: 'decline' })
    })

    test('a prompt killed by request abort rejects with the request reason', async () => {
      inbox = createInputInbox()
      const controller = new AbortController()
      const promise = inbox.add(request({ signal: controller.signal }), {
        prompt: (signal) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason))
          }),
      })
      const prompted = inbox.prompt(pending(0).id)
      const reason = new Error('req aborted')
      controller.abort(reason)
      await expect(promise).rejects.toBe(reason)
      await expect(prompted).rejects.toBe(reason)
    })

    test('a prompt resolving no result keeps the entry pending', async () => {
      inbox = createInputInbox()
      const promise = inbox.add(request(), {
        prompt: (async () => undefined) as unknown as () => Promise<ElicitResult>,
      })
      const { id } = pending(0)
      await expect(inbox.prompt(id)).rejects.toThrow(`Input ${id} prompt returned no result`)
      expect(inbox.get(id)).toBeDefined()
      inbox.cancel(id)
      await promise
    })

    test('a rejection keeps the entry pending and rejects prompt', async () => {
      inbox = createInputInbox()
      const error = new Error('spawn failed')
      const promise = inbox.add(request(), { prompt: () => Promise.reject(error) })
      const { id } = pending(0)
      await expect(inbox.prompt(id)).rejects.toBe(error)
      expect(inbox.get(id)).toBeDefined()
      inbox.cancel(id)
      await promise
    })

    test('abort kills the open prompt', async () => {
      inbox = createInputInbox()
      const controller = new AbortController()
      let promptSignal: AbortSignal | undefined
      const promise = inbox.add(request({ signal: controller.signal }), {
        prompt: (signal) => {
          promptSignal = signal
          return new Promise(() => {})
        },
      })
      void inbox.prompt(pending(0).id)
      controller.abort(new Error('x'))
      await expect(promise).rejects.toThrow('x')
      expect(promptSignal?.aborted).toBe(true)
    })

    test('missing entry and missing prompt reject', async () => {
      inbox = createInputInbox()
      await expect(inbox.prompt('nope')).rejects.toThrow('No pending input nope')
      const promise = inbox.add(request())
      const { id } = pending(0)
      await expect(inbox.prompt(id)).rejects.toThrow(`Input ${id} cannot be prompted`)
      inbox.cancel(id)
      await promise
    })
  })

  describe('answer surfaces', () => {
    test('counts registrations and unregister is idempotent', () => {
      inbox = createInputInbox()
      expect(inbox.hasAnswerSurface).toBe(false)
      const u1 = inbox.registerAnswerSurface()
      const u2 = inbox.registerAnswerSurface()
      expect(inbox.hasAnswerSurface).toBe(true)
      u1()
      u1()
      expect(inbox.hasAnswerSurface).toBe(true)
      u2()
      expect(inbox.hasAnswerSurface).toBe(false)
    })

    test('last unregister cancels pending entries and logs', async () => {
      inbox = createInputInbox()
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const unregister = inbox.registerAnswerSurface()
      const p1 = inbox.add(request())
      const p2 = inbox.add(request())
      unregister()
      await expect(p1).resolves.toEqual({ action: 'cancel' })
      await expect(p2).resolves.toEqual({ action: 'cancel' })
      expect(error).toHaveBeenCalledWith(
        '[mokei/host-desktop] Last input answer surface closed; cancelling 2 pending inputs',
      )
      expect(inbox.list()).toEqual([])
    })

    test('last unregister with no entries does not log', () => {
      inbox = createInputInbox()
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      inbox.registerAnswerSurface()()
      expect(error).not.toHaveBeenCalled()
    })
  })
})
