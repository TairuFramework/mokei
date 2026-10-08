import { join } from 'node:path'
import type { LogLevel } from '@logtape/logtape'
import type { PayloadCapture } from '@mokei/context-client'
import { createValidator, type Schema } from '@sozai/schema'
import { getAppEnvVar, getDataDir, readJSONFile } from '@tejika/env'

export type MokeiConfig = {
  logs: { level: LogLevel; file: boolean }
  tracing: {
    payloads?: PayloadCapture
    otlp?: { endpoint: string; headers?: Record<string, string> }
  }
}

type MokeiConfigErrorParams = { path: string; issues: Array<string> }

export class MokeiConfigError extends Error {
  #path: string
  #issues: Array<string>

  constructor(params: MokeiConfigErrorParams) {
    super(`Invalid mokei configuration ${params.path}: ${params.issues.join(', ')}`)
    this.name = 'MokeiConfigError'
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
    logs: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['trace', 'debug', 'info', 'warning', 'error', 'fatal'] },
        file: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    tracing: {
      type: 'object',
      properties: {
        payloads: {
          anyOf: [
            { type: 'string', enum: ['on', 'off'] },
            { type: 'integer', minimum: 1 },
          ],
        },
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
  },
  additionalProperties: false,
} as const satisfies Schema

const validateConfiguration = createValidator(configurationSchema)

function createDefaults(): MokeiConfig {
  return { logs: { level: 'info', file: true }, tracing: { payloads: 'on' } }
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

export function getMokeiConfigPath(): string {
  return getAppEnvVar('mokei', 'CONFIG_PATH') ?? join(getDataDir('mokei'), 'mokei.json')
}

export async function loadMokeiConfig(path = getMokeiConfigPath()): Promise<MokeiConfig> {
  let parsed: unknown
  try {
    parsed = await readJSONFile(path, { default: createDefaults() })
  } catch (error) {
    if (!(error instanceof Error) || !(error.cause instanceof SyntaxError)) throw error
    const wrapped = new MokeiConfigError({ path, issues: [`JSON: ${error.cause.message}`] })
    Object.defineProperty(wrapped, 'cause', { value: error.cause })
    throw wrapped
  }
  const result = validateConfiguration(parsed)
  if (result.issues) {
    throw new MokeiConfigError({ path, issues: result.issues.map((issue) => issuePath(issue)) })
  }
  const supplied = result.value
  return {
    logs: { level: supplied.logs?.level ?? 'info', file: supplied.logs?.file ?? true },
    tracing: { ...supplied.tracing, payloads: supplied.tracing?.payloads ?? 'on' },
  }
}
