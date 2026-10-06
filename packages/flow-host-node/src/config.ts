import { dirname, isAbsolute, join, resolve } from 'node:path'
import { createValidator, type Schema } from '@sozai/schema'
import { expandHome, getDataDir, readJSONFile } from '@tejika/env'

export type FlowConfig = {
  siblings: Record<string, { command: string; args?: Array<string>; env?: Record<string, string> }>
  flowDirs: Array<string>
  approval: { allow: Array<string> }
  retention: { days: number }
  desktop: { notifications: boolean }
}

type FlowConfigErrorParams = { path: string; issues: Array<string> }

export class FlowConfigError extends Error {
  #path: string
  #issues: Array<string>

  constructor(params: FlowConfigErrorParams) {
    super(`Invalid flow configuration ${params.path}: ${params.issues.join(', ')}`)
    this.name = 'FlowConfigError'
    this.#path = params.path
    this.#issues = params.issues
  }

  get path(): string {
    return this.#path
  }

  get issues(): Array<string> {
    return [...this.#issues]
  }
}

const configurationSchema = {
  type: 'object',
  properties: {
    siblings: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
          env: { type: 'object', additionalProperties: { type: 'string' } },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
    flowDirs: { type: 'array', items: { type: 'string' } },
    approval: {
      type: 'object',
      properties: { allow: { type: 'array', items: { type: 'string' } } },
      required: ['allow'],
      additionalProperties: false,
    },
    desktop: {
      type: 'object',
      properties: { notifications: { type: 'boolean' } },
      additionalProperties: false,
    },
    retention: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 1 } },
      required: ['days'],
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const satisfies Schema

const validateConfiguration = createValidator(configurationSchema)
function createDefaults(): FlowConfig {
  return {
    siblings: {},
    flowDirs: [],
    approval: { allow: [] },
    retention: { days: 30 },
    desktop: { notifications: false },
  }
}

function issuePath(issue: { path?: ReadonlyArray<unknown>; details?: unknown }): string {
  const parts = [...(issue.path ?? [])].map((part) => {
    return typeof part === 'object' && part !== null && 'key' in part
      ? String(part.key)
      : String(part)
  })
  const details = issue.details
  if (typeof details === 'object' && details !== null && 'params' in details) {
    const params = details.params
    if (typeof params === 'object' && params !== null && 'additionalProperty' in params) {
      parts.push(String(params.additionalProperty))
    }
  }
  return parts.join('.')
}

function resolveConfiguredPath(value: string, configDirectory: string): string {
  const expanded = expandHome(value)
  if (expanded !== value) return expanded
  if (value.startsWith('~') || isAbsolute(value) || /^[a-z][a-z\d+.-]*:/i.test(value)) return value
  return resolve(configDirectory, value)
}

function isScriptPath(value: string): boolean {
  return (
    /\.(?:js|mjs|cjs)$/i.test(value) && !value.startsWith('-') && !/^[a-z][a-z\d+.-]*:/i.test(value)
  )
}

export async function loadFlowConfig(
  path = join(getDataDir('mokei'), 'flows.json'),
): Promise<FlowConfig> {
  let parsed: unknown
  try {
    parsed = await readJSONFile(path, { default: createDefaults() })
  } catch (error) {
    if (!(error instanceof Error) || !(error.cause instanceof SyntaxError)) throw error
    const wrapped = new FlowConfigError({ path, issues: [`JSON: ${error.cause.message}`] })
    Object.defineProperty(wrapped, 'cause', { value: error.cause })
    throw wrapped
  }
  const result = validateConfiguration(parsed)
  if (result.issues) {
    throw new FlowConfigError({ path, issues: result.issues.map((issue) => issuePath(issue)) })
  }
  const supplied = result.value as Partial<FlowConfig>
  const config: FlowConfig = {
    siblings: supplied.siblings ?? {},
    flowDirs: supplied.flowDirs ?? [],
    approval: supplied.approval ?? { allow: [] },
    retention: supplied.retention ?? { days: 30 },
    desktop: { notifications: supplied.desktop?.notifications ?? false },
  }
  const configDirectory = dirname(resolve(path))
  return {
    ...config,
    flowDirs: config.flowDirs.map((directory) => resolveConfiguredPath(directory, configDirectory)),
    siblings: Object.fromEntries(
      Object.entries(config.siblings).map(([name, sibling]) => {
        return [
          name,
          {
            ...sibling,
            ...(sibling.args && {
              args: sibling.args.map((argument) => {
                return isScriptPath(argument)
                  ? resolveConfiguredPath(argument, configDirectory)
                  : argument
              }),
            }),
          },
        ]
      }),
    ),
  }
}
