import { MISSING_REQUIRED_CLIENT_CAPABILITY } from './rpc.js'
import { TASKS_EXTENSION } from './versions/2026-07-28.js'
import type { ProtocolVersion } from './versions/types.js'

export type ExtensionDefinition = {
  id: string
  revision?: string
  protocolVersions: ReadonlySet<ProtocolVersion>
  clientMethods: ReadonlySet<string>
  serverMethods: ReadonlySet<string>
}

type ExtensionCapabilities = { extensions?: Record<string, Record<string, unknown>> }

export const TASKS: ExtensionDefinition = {
  id: TASKS_EXTENSION,
  protocolVersions: new Set<ProtocolVersion>(['2026-07-28']),
  clientMethods: new Set(['tasks/get', 'tasks/update', 'tasks/cancel']),
  serverMethods: new Set(),
}

export const OAUTH_CLIENT_CREDENTIALS: ExtensionDefinition = {
  id: 'io.modelcontextprotocol/oauth-client-credentials',
  protocolVersions: new Set<ProtocolVersion>(['2025-11-25', '2026-07-28']),
  clientMethods: new Set(),
  serverMethods: new Set(),
}

export const EXTENSIONS: ReadonlyArray<ExtensionDefinition> = [TASKS, OAUTH_CLIENT_CREDENTIALS]

export function extensionForClientMethod(
  method: string,
  registry: ReadonlyArray<ExtensionDefinition> = EXTENSIONS,
): ExtensionDefinition | undefined {
  return registry.find((definition) => definition.clientMethods.has(method))
}

export function extensionForServerMethod(
  method: string,
  registry: ReadonlyArray<ExtensionDefinition> = EXTENSIONS,
): ExtensionDefinition | undefined {
  return registry.find((definition) => definition.serverMethods.has(method))
}

/** The peer's settings for the extension, or `null` when not declared or revision differs. */
export function readExtension(
  capabilities: ExtensionCapabilities | undefined,
  definition: ExtensionDefinition,
): Record<string, unknown> | null {
  const settings = capabilities?.extensions?.[definition.id]
  if (settings == null) return null
  return settings.revision === definition.revision ? settings : null
}

/** The settings object to advertise, with `revision` added when the definition has one. */
export function declareExtension(
  definition: ExtensionDefinition,
  settings?: Record<string, unknown>,
): Record<string, unknown> {
  return definition.revision == null
    ? { ...settings }
    : { ...settings, revision: definition.revision }
}

/** Extensions to advertise for a protocol revision, `undefined` when none apply. */
export function extensionsFor(
  enabled: ReadonlyMap<ExtensionDefinition, Record<string, unknown>>,
  protocol: ProtocolVersion,
): Record<string, Record<string, unknown>> | undefined {
  const result: Record<string, Record<string, unknown>> = {}
  for (const [definition, settings] of enabled) {
    if (definition.protocolVersions.has(protocol)) {
      result[definition.id] = settings
    }
  }
  return Object.keys(result).length === 0 ? undefined : result
}

/** `RPCError` params for a client missing a required extension. */
export function missingExtensionErrorParams(definition: ExtensionDefinition): {
  code: number
  message: string
  data: { requiredCapabilities: { extensions: Record<string, Record<string, never>> } }
} {
  const name = definition.id === TASKS_EXTENSION ? 'tasks' : definition.id
  return {
    code: MISSING_REQUIRED_CLIENT_CAPABILITY,
    message: `Client did not declare the ${name} extension`,
    data: { requiredCapabilities: { extensions: { [definition.id]: {} } } },
  }
}
