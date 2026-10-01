import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { LogLevel } from '@logtape/logtape'
import { createValidator, type Schema } from '@sozai/schema'
import { getDataDir } from '@tejika/env'

export type FlowConfig = {
  siblings: Record<string, { command: string; args?: Array<string>; env?: Record<string, string> }>
  flowDirs: Array<string>
  approval: { allow: Array<string> }
  tracing: { otlp?: { endpoint: string; headers?: Record<string, string> } }
  logs: { level: LogLevel }
  retention: { days: number }
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
    tracing: {
      type: 'object',
      properties: {
        otlp: {
          type: 'object',
          properties: {
            endpoint: { type: 'string' },
            headers: { type: 'object', additionalProperties: { type: 'string' } },
          },
          required: ['endpoint'],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    logs: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['trace', 'debug', 'info', 'warning', 'error', 'fatal'] },
      },
      required: ['level'],
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
const defaults: FlowConfig = {
  siblings: {},
  flowDirs: [],
  approval: { allow: [] },
  tracing: {},
  logs: { level: 'info' },
  retention: { days: 30 },
}

function issuePath(issue: { path?: ReadonlyArray<unknown>; details?: unknown }): string {
  const parts = [...(issue.path ?? [])].map((part) =>
    typeof part === 'object' && part !== null && 'key' in part ? String(part.key) : String(part),
  )
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
  if (value.startsWith('~/')) return join(homedir(), value.slice(2))
  if (value === '~') return homedir()
  if (value.startsWith('~') || isAbsolute(value) || /^[a-z][a-z\d+.-]*:\/\//i.test(value))
    return value
  return resolve(configDirectory, value)
}

function isScriptPath(value: string): boolean {
  return (
    /\.(?:js|mjs|cjs)$/i.test(value) &&
    !value.startsWith('-') &&
    !/^[a-z][a-z\d+.-]*:\/\//i.test(value)
  )
}

export async function loadFlowConfig(
  path = join(getDataDir('mokei'), 'flows.json'),
): Promise<FlowConfig> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return { ...defaults }
    }
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const wrapped = new FlowConfigError({ path, issues: [`JSON: ${message}`] })
    Object.defineProperty(wrapped, 'cause', { value: error })
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
    tracing: supplied.tracing ?? {},
    logs: supplied.logs ?? { level: 'info' },
    retention: supplied.retention ?? { days: 30 },
  }
  const configDirectory = dirname(resolve(path))
  return {
    ...config,
    flowDirs: config.flowDirs.map((directory) => resolveConfiguredPath(directory, configDirectory)),
    siblings: Object.fromEntries(
      Object.entries(config.siblings).map(([name, sibling]) => [
        name,
        {
          ...sibling,
          ...(sibling.args && {
            args: sibling.args.map((argument) =>
              isScriptPath(argument) ? resolveConfiguredPath(argument, configDirectory) : argument,
            ),
          }),
        },
      ]),
    ),
  }
}
