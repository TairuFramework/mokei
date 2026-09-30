import {
  createMapResolver,
  digestDefinition,
  type FlowDefinition,
  type FlowResolver,
} from '@sozai/flow-graph'

export type FlowLookup = (id: string, version?: number) => FlowDefinition | undefined

export type FlowRegistry = {
  /** Snapshots, in registration order. */
  flows: ReadonlyArray<FlowDefinition>
  /** Version omitted or equal to the registered version. */
  lookup: FlowLookup
  /** `createMapResolver` over the snapshots. */
  resolver: FlowResolver
  digest(id: string): string | undefined
}

export function createFlowRegistry(flows: ReadonlyArray<FlowDefinition>): FlowRegistry {
  const snapshots = flows.map((flow) => structuredClone(flow))
  const byID = new Map<string, FlowDefinition>()
  const digests = new Map<string, string>()
  for (const snapshot of snapshots) {
    if (byID.has(snapshot.id)) {
      throw new Error(`Duplicate registered flow id: ${snapshot.id}`)
    }
    byID.set(snapshot.id, snapshot)
    digests.set(snapshot.id, digestDefinition(snapshot as never))
  }
  return {
    flows: snapshots,
    lookup: (id, version) => {
      const flow = byID.get(id)
      return flow != null && (version === undefined || version === flow.version) ? flow : undefined
    },
    resolver: createMapResolver(snapshots),
    digest: (id) => digests.get(id),
  }
}

/** Resolution for one checked or running definition: itself first, then the registry. */
export function definitionResolution(
  definition: FlowDefinition,
  registry: FlowRegistry,
): { lookup: FlowLookup; resolver: FlowResolver } {
  const isSelf = (id: string, version?: number): boolean =>
    id === definition.id && (version === undefined || version === definition.version)
  return {
    lookup: (id, version) => (isSelf(id, version) ? definition : registry.lookup(id, version)),
    resolver: {
      resolve: (id, version, options) =>
        isSelf(id, version) ? definition : registry.resolver.resolve(id, version, options),
    },
  }
}

export type ReferenceEdges = 'all' | 'goto'

type Reference = { flow: string; version?: number }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toReference(value: Record<string, unknown>): Reference | undefined {
  if (typeof value.flow !== 'string') return undefined
  return typeof value.version === 'number'
    ? { flow: value.flow, version: value.version }
    : { flow: value.flow }
}

function referencesOf(definition: unknown, edges: ReferenceEdges): Array<Reference> {
  if (!isObject(definition) || !isObject(definition.nodes)) return []
  const references: Array<Reference> = []
  for (const node of Object.values(definition.nodes)) {
    if (!isObject(node)) continue
    let reference: Reference | undefined
    if (node.kind === 'goto' || (edges === 'all' && node.kind === 'call')) {
      reference = toReference(node)
    } else if (edges === 'all' && node.kind === 'loop' && isObject(node.body)) {
      reference = toReference(node.body)
    }
    if (reference) references.push(reference)
  }
  return references
}

/** Definitions reachable from `definition` (itself first) through resolvable references. */
export function reachableFlows(
  definition: unknown,
  lookup: FlowLookup,
  edges: ReferenceEdges,
): Array<FlowDefinition> {
  if (!isObject(definition) || !isObject(definition.nodes)) return []
  const visited = new Set<string>()
  const result: Array<FlowDefinition> = []
  const visit = (current: FlowDefinition): void => {
    const key = `${current.id}@${current.version ?? ''}`
    if (visited.has(key)) return
    visited.add(key)
    result.push(current)
    for (const reference of referencesOf(current, edges)) {
      const target = lookup(reference.flow, reference.version)
      if (target != null && isObject(target.nodes)) visit(target)
    }
  }
  visit(definition as FlowDefinition)
  return result
}
