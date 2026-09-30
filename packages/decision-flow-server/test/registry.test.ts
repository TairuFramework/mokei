import { digestDefinition, type FlowDefinition } from '@sozai/flow-graph'
import { expect, test } from 'vitest'

import { createFlowRegistry, definitionResolution, reachableFlows } from '../src/registry.js'

function flow(id: string, nodes: Record<string, unknown> = {}, version = 1): FlowDefinition {
  return {
    id,
    name: id,
    version,
    start: 'end',
    nodes: { end: { kind: 'end', outcome: 'done' }, ...nodes },
  } as unknown as FlowDefinition
}

const ids = (flows: Array<FlowDefinition>) => flows.map((f) => f.id)

test('snapshots definitions', () => {
  const original = flow('a')
  const expected = digestDefinition(structuredClone(original) as never)
  const registry = createFlowRegistry([original])
  original.name = 'mutated'
  expect(registry.lookup('a')?.name).toBe('a')
  expect(registry.digest('a')).toBe(expected)
  expect(registry.digest('missing')).toBeUndefined()
})

test('rejects duplicate ids', () => {
  expect(() => createFlowRegistry([flow('a'), flow('a')])).toThrow(
    'Duplicate registered flow id: a',
  )
})

test('lookup accepts an omitted or matching version only', () => {
  const registry = createFlowRegistry([flow('a')])
  expect(registry.lookup('a')?.id).toBe('a')
  expect(registry.lookup('a', 1)?.id).toBe('a')
  expect(registry.lookup('a', 2)).toBeUndefined()
})

test('definitionResolution resolves the definition itself first', async () => {
  const registry = createFlowRegistry([flow('a')])
  const runtime = flow('x')
  const { lookup, resolver } = definitionResolution(runtime, registry)
  expect(lookup('x')).toBe(runtime)
  expect(lookup('x', 1)).toBe(runtime)
  expect(lookup('x', 2)).toBeUndefined()
  expect(lookup('a')?.id).toBe('a')
  expect(await resolver.resolve('x')).toBe(runtime)
  expect((await resolver.resolve('a')).id).toBe('a')
  expect(() => resolver.resolve('missing')).toThrow()
})

test('reachableFlows follows call, goto and loop body', () => {
  const root = flow('root', {
    c1: { kind: 'call', flow: 'a', next: 'end' },
    l1: { kind: 'loop', body: { flow: 'c' } },
  })
  const registry = createFlowRegistry([
    flow('a', { g: { kind: 'goto', flow: 'b' } }),
    flow('b'),
    flow('c'),
  ])
  const { lookup } = definitionResolution(root, registry)
  expect(ids(reachableFlows(root, lookup, 'all'))).toEqual(['root', 'a', 'b', 'c'])
  expect(ids(reachableFlows(root, lookup, 'goto'))).toEqual(['root'])
  const gotoRoot = flow('root', { g: { kind: 'goto', flow: 'a' }, c1: { kind: 'call', flow: 'c' } })
  expect(ids(reachableFlows(gotoRoot, lookup, 'goto'))).toEqual(['root', 'a', 'b'])
})

test('reachableFlows terminates on cycles', () => {
  const registry = createFlowRegistry([
    flow('a', { c: { kind: 'call', flow: 'b' } }),
    flow('b', { c: { kind: 'call', flow: 'a' } }),
  ])
  const a = registry.lookup('a')
  expect(ids(reachableFlows(a, registry.lookup, 'all'))).toEqual(['a', 'b'])
})

test('reachableFlows tolerates malformed input', () => {
  const registry = createFlowRegistry([])
  for (const input of [undefined, {}, { nodes: 3 }]) {
    expect(reachableFlows(input, registry.lookup, 'all')).toEqual([])
  }
  const bad = { id: 'r', version: 1, nodes: { x: 5, y: { kind: 'call', flow: 7 } } }
  expect(Array.isArray(reachableFlows(bad, registry.lookup, 'all'))).toBe(true)
})
