import type { SystemOneResult } from '@mokei/system-one-client'
import { SystemOneResponseError } from '@mokei/system-one-client'
import { describe, expect, test } from 'vitest'

import { PendingRequests, parseDaemonLine } from '../src/protocol.js'

const result = {
  model: 'laya',
  answers: {},
  usage: { input_tokens: 1, output_tokens: 0 },
} satisfies SystemOneResult

describe('parseDaemonLine', () => {
  test('recognizes the ready line', () => {
    expect(parseDaemonLine('{"status":"ready","model":"laya"}')).toEqual({ kind: 'ready' })
  })

  test('parses a result and strips its id', () => {
    expect(parseDaemonLine(JSON.stringify({ ...result, id: '7' }))).toEqual({
      kind: 'result',
      id: '7',
      result,
    })
  })

  test('parses an error with and without an id', () => {
    expect(parseDaemonLine('{"id":"3","error":"missing questions"}')).toEqual({
      kind: 'error',
      id: '3',
      message: 'missing questions',
    })
    expect(parseDaemonLine('{"error":"bad"}')).toEqual({
      kind: 'error',
      id: undefined,
      message: 'bad',
    })
  })

  test('stringifies a numeric id', () => {
    expect(parseDaemonLine('{"id":4,"error":"x"}')).toMatchObject({ id: '4' })
  })

  test('marks non-JSON and non-object lines invalid', () => {
    expect(parseDaemonLine('not json')).toEqual({ kind: 'invalid', line: 'not json' })
    expect(parseDaemonLine('[1]')).toEqual({ kind: 'invalid', line: '[1]' })
  })
})

describe('PendingRequests', () => {
  test('resolves the call whose id matches', async () => {
    const pending = new PendingRequests()
    const first = pending.add('1')
    const second = pending.add('2')
    pending.settle({ kind: 'result', id: '2', result: { ...result, model: 'two' } })
    pending.settle({ kind: 'result', id: '1', result: { ...result, model: 'one' } })
    expect((await first).model).toBe('one')
    expect((await second).model).toBe('two')
    expect(pending.size).toBe(0)
  })

  test('rejects a daemon error with SystemOneResponseError', async () => {
    const pending = new PendingRequests()
    const call = pending.add('1')
    pending.settle({ kind: 'error', id: '1', message: 'missing questions' })
    await expect(call).rejects.toThrow(SystemOneResponseError)
    await expect(call).rejects.toThrow('missing questions')
  })

  test('routes an id-less error and an invalid line to the oldest call', async () => {
    const pending = new PendingRequests()
    const first = pending.add('1')
    const second = pending.add('2')
    const third = pending.add('3')
    pending.settle({ kind: 'error', id: undefined, message: 'bad' })
    pending.settle({ kind: 'invalid', line: 'garbage' })
    await expect(first).rejects.toThrow('bad')
    await expect(second).rejects.toThrow('garbage')
    expect(pending.size).toBe(1)
    pending.settle({ kind: 'result', id: '3', result })
    await expect(third).resolves.toEqual(result)
  })

  test('drops a result with an unknown id', () => {
    const pending = new PendingRequests()
    void pending.add('1')
    pending.settle({ kind: 'result', id: '99', result })
    expect(pending.size).toBe(1)
  })

  test('a discarded call rejects at once and swallows its late response', async () => {
    const pending = new PendingRequests()
    const first = pending.add('1')
    const second = pending.add('2')
    const reason = new Error('aborted')
    pending.discard('1', reason)
    await expect(first).rejects.toBe(reason)
    pending.settle({ kind: 'error', id: undefined, message: 'late' })
    expect(pending.size).toBe(1)
    pending.settle({ kind: 'result', id: '2', result })
    await expect(second).resolves.toEqual(result)
  })

  test('rejectAll rejects every live call and empties the map', async () => {
    const pending = new PendingRequests()
    const first = pending.add('1')
    const second = pending.add('2')
    pending.discard('2', new Error('aborted'))
    await expect(second).rejects.toThrow('aborted')
    const error = new Error('exited')
    pending.rejectAll(error)
    await expect(first).rejects.toBe(error)
    expect(pending.size).toBe(0)
  })
})
