import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FlowRunSnapshot, InboxItem, RunStatus, RunTrace } from '@mokei/flow-client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
  formatInboxRow,
  formatRunStatus,
  formatSnapshotRow,
  formatTrace,
  parseJSONArg,
  printJSON,
  printNDJSON,
} from '../src/output.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mokei-output-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

test('parseJSONArg parses inline JSON', async () => {
  expect(await parseJSONArg('--input', '{"a":1}')).toEqual({ a: 1 })
})

test('parseJSONArg reads @file', async () => {
  const path = join(dir, 'in.json')
  await writeFile(path, '{"b":[2]}')
  expect(await parseJSONArg('--input', `@${path}`)).toEqual({ b: [2] })
})

test('parseJSONArg names the flag on invalid JSON', async () => {
  await expect(parseJSONArg('--input', '{bad')).rejects.toThrow(/--input/)
})

test('parseJSONArg names the flag and path when the file is missing', async () => {
  const path = join(dir, 'missing.json')
  await expect(parseJSONArg('--input', `@${path}`)).rejects.toThrow(
    new RegExp(`--input.*${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  )
})

test('parseJSONArg names the flag when the file holds invalid JSON', async () => {
  const path = join(dir, 'bad.json')
  await writeFile(path, 'nope')
  await expect(parseJSONArg('--input', `@${path}`)).rejects.toThrow(/--input/)
})

test('printJSON prints one indented document, printNDJSON one line', () => {
  const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  printJSON({ a: 1 })
  printNDJSON({ a: 1, b: { c: 2 } })
  expect(write).toHaveBeenNthCalledWith(1, '{\n  "a": 1\n}\n')
  expect(write).toHaveBeenNthCalledWith(2, '{"a":1,"b":{"c":2}}\n')
})

test('formatRunStatus lists pending items with their ids', () => {
  const status: RunStatus = {
    runID: 'run-1',
    state: 'input_required',
    pending: [
      { id: 'i-1', kind: 'input', message: 'Name?', requestedSchema: {}, canPrompt: true },
      { id: 'a-1', kind: 'approval', plan: { tools: ['x:y', 'z:w'] }, canPrompt: true },
    ],
  }
  const text = formatRunStatus(status)
  expect(text).toContain('run-1')
  expect(text).toContain('input_required')
  expect(text).toContain('i-1')
  expect(text).toContain('Name?')
  expect(text).toContain('a-1')
  expect(text).toContain('x:y, z:w')
})

test('formatRunStatus reports errors', () => {
  const text = formatRunStatus({
    runID: 'r',
    state: 'failed',
    pending: [],
    error: { type: 'Boom', message: 'it broke' },
  })
  expect(text).toContain('failed')
  expect(text).toContain('it broke')
})

test('formatSnapshotRow and formatInboxRow produce string cells', () => {
  const snapshot: FlowRunSnapshot = {
    runID: 'r1',
    flowID: 'f1',
    label: 'Label',
    state: 'working',
    createdAt: 1,
    updatedAt: 2,
    plan: { tools: [] },
  }
  expect(formatSnapshotRow(snapshot)).toMatchObject({ runID: 'r1', flow: 'f1', state: 'working' })
  const item: InboxItem = {
    id: 'i1',
    runID: 'r1',
    kind: 'input',
    inputKey: 'k',
    message: 'Hi',
    requestedSchema: {},
    createdAt: 1,
  }
  expect(formatInboxRow(item)).toMatchObject({ id: 'i1', runID: 'r1', kind: 'input' })
  for (const v of Object.values(formatInboxRow(item))) expect(typeof v).toBe('string')
})

test('formatTrace indents children under parents, then prints logs', () => {
  const span = (spanID: string, name: string, endTime: number, parentSpanID?: string) => ({
    traceID: 't',
    spanID,
    ...(parentSpanID ? { parentSpanID } : {}),
    name,
    kind: 0,
    startTime: 1000,
    endTime,
    status: { code: 0 },
    attributes: {},
    events: [],
    links: [],
  })
  const trace: RunTrace = {
    spans: [span('c', 'child', 1500, 'p'), span('p', 'parent', 2000)],
    logs: [
      {
        traceID: 't',
        spanID: 'p',
        timestamp: 1,
        level: 'info',
        category: ['a'],
        message: 'hello log',
        properties: {},
      },
    ],
  }
  const lines = formatTrace(trace).split('\n')
  const parentIdx = lines.findIndex((l) => l.includes('parent'))
  const childIdx = lines.findIndex((l) => l.includes('child'))
  const logIdx = lines.findIndex((l) => l.includes('hello log'))
  expect(parentIdx).toBeLessThan(childIdx)
  expect(childIdx).toBeLessThan(logIdx)
  expect(lines[parentIdx]).toMatch(/^\S/)
  expect(lines[childIdx]).toMatch(/^\s+\S/)
  expect(lines[parentIdx]).toContain('1000ms')
  expect(lines[childIdx]).toContain('500ms')
})
