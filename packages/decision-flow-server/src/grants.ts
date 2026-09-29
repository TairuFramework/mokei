import type { JSONValue } from '@mokei/context-server'
import { digestDefinition } from '@sozai/flow-graph'

export type GrantStore = {
  issue(params: { toolName: string; arguments: JSONValue; tools: Array<string> }): string
  consume(params: {
    token: unknown
    toolName: string
    arguments: JSONValue
  }): { tools: Array<string> } | undefined
}

type Grant = {
  toolName: string
  argsDigest: string
  tools: Array<string>
  expiresAt: number
}

/** Issue and atomically consume short-lived approval grants. */
export function createGrantStore(options: { now?: () => number; ttlMs?: number } = {}): GrantStore {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? 300_000
  const grants = new Map<string, Grant>()

  function purgeExpired(time: number): void {
    for (const [token, grant] of grants) {
      if (grant.expiresAt <= time) grants.delete(token)
    }
  }

  return {
    issue(params) {
      const time = now()
      purgeExpired(time)
      const token = globalThis.crypto.randomUUID()
      grants.set(token, {
        toolName: params.toolName,
        argsDigest: digestDefinition(params.arguments),
        tools: [...params.tools],
        expiresAt: time + ttlMs,
      })
      return token
    },
    consume(params) {
      purgeExpired(now())
      if (typeof params.token !== 'string') return undefined
      const grant = grants.get(params.token)
      if (grant === undefined) return undefined
      grants.delete(params.token)
      if (grant.toolName !== params.toolName) return undefined
      if (grant.argsDigest !== digestDefinition(params.arguments)) return undefined
      return { tools: [...grant.tools] }
    },
  }
}
