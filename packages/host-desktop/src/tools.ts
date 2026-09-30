import type { CallToolResult, ElicitResult, InputSchema } from '@mokei/context-protocol'
import type { LocalToolDefinition } from '@mokei/host'

import type { BackendName, DesktopBackend } from './backends/types.js'
import { createDetector, type ForcedBackends } from './detect.js'
import { defaultCreateBackend, untilAbort } from './elicit-handler.js'
import type { DesktopElicitRequest } from './inbox.js'
import { createRunner, type Runner } from './runner.js'

export type DesktopToolsOptions = {
  /** The handler `ask_user` calls. Without it, `ask_user` is not returned. */
  elicit?: (request: DesktopElicitRequest) => Promise<ElicitResult>
  /** `false` leaves `notify` out. Default `true`. */
  notify?: boolean
  /** `ask_user`'s overall limit. Default 90. */
  timeoutSeconds?: number
  appName?: string
  backends?: ForcedBackends
  runner?: Runner
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  /** Test seam: replaces adapter construction. */
  createBackend?: (name: BackendName, runner: Runner) => DesktopBackend
}

const DEFAULT_TIMEOUT_SECONDS = 90
const NOTIFY_TIMEOUT_MS = 5000
const MIN_CHOICES = 2
const MAX_CHOICES = 20
const KINDS = ['text', 'confirm', 'choice']

const NOTIFY_SCHEMA: InputSchema = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'The notification text.' },
    title: { type: 'string', description: 'Notification title. Defaults to the app name.' },
    subtitle: { type: 'string', description: 'Subtitle. macOS only.' },
    sound: { type: 'boolean', description: 'Play a sound. Ignored on Linux.' },
  },
  required: ['message'],
}

const ASK_USER_SCHEMA: InputSchema = {
  type: 'object',
  properties: {
    question: { type: 'string', description: 'The question to show the user.' },
    kind: {
      type: 'string',
      enum: KINDS,
      description: 'text: free-form answer. confirm: yes or no. choice: one of `choices`.',
    },
    choices: {
      type: 'array',
      items: { type: 'string' },
      minItems: MIN_CHOICES,
      maxItems: MAX_CHOICES,
      description: 'For kind "choice" only: 2 to 20 unique non-empty strings.',
    },
    default: {
      type: 'string',
      description: 'text: prefilled answer. confirm: "yes" or "no". choice: one of `choices`.',
    },
  },
  required: ['question', 'kind'],
}

function jsonResult(value: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
  }
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function invalid(field: string, problem: string): CallToolResult {
  return errorResult(`Invalid input: "${field}" ${problem}`)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

type AnswerSchema =
  | { type: 'boolean'; default?: boolean }
  | { type: 'string'; enum?: Array<string>; default?: string }

type AskInput = {
  question: string
  answer: AnswerSchema
}

/** Validates the flat input and builds the `answer` property schema. */
function parseAskInput(input: Record<string, unknown>): AskInput | CallToolResult {
  const { question, kind, choices, default: defaultValue } = input
  if (!isNonEmptyString(question)) {
    return invalid('question', 'must be a non-empty string')
  }
  if (typeof kind !== 'string' || !KINDS.includes(kind)) {
    return invalid('kind', 'must be "text", "confirm" or "choice"')
  }
  if (defaultValue != null && typeof defaultValue !== 'string') {
    return invalid('default', 'must be a string')
  }
  if (kind !== 'choice' && choices != null) {
    return invalid('choices', 'is only allowed for kind "choice"')
  }

  if (kind === 'confirm') {
    if (defaultValue != null && defaultValue !== 'yes' && defaultValue !== 'no') {
      return invalid('default', 'must be "yes" or "no" for kind "confirm"')
    }
    const answer: AnswerSchema = { type: 'boolean' }
    if (defaultValue != null) {
      answer.default = defaultValue === 'yes'
    }
    return { question, answer }
  }

  if (kind === 'choice') {
    if (
      !Array.isArray(choices) ||
      choices.length < MIN_CHOICES ||
      choices.length > MAX_CHOICES ||
      !choices.every(isNonEmptyString)
    ) {
      return invalid(
        'choices',
        `must be ${MIN_CHOICES} to ${MAX_CHOICES} non-empty strings for kind "choice"`,
      )
    }
    if (new Set(choices).size !== choices.length) {
      return invalid('choices', 'must be unique')
    }
    if (defaultValue != null && !choices.includes(defaultValue)) {
      return invalid('default', 'must be one of "choices"')
    }
    const answer: AnswerSchema = { type: 'string', enum: choices }
    if (defaultValue != null) {
      answer.default = defaultValue
    }
    return { question, answer }
  }

  const answer: AnswerSchema = { type: 'string' }
  if (defaultValue != null) {
    answer.default = defaultValue
  }
  return { question, answer }
}

export function createDesktopTools(options: DesktopToolsOptions): Array<LocalToolDefinition> {
  const appName = options.appName ?? 'mokei'
  const timeoutMs = (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000
  const tools: Array<LocalToolDefinition> = []

  if (options.notify !== false) {
    const createBackend = options.createBackend ?? defaultCreateBackend(appName)
    const detect = createDetector({
      platform: options.platform ?? process.platform,
      env: options.env ?? process.env,
      forced: options.backends,
    })
    let runner = options.runner

    tools.push({
      name: 'notify',
      description:
        'Show a desktop notification to the user. Returns once the notification is handed to the OS.',
      inputSchema: NOTIFY_SCHEMA,
      annotations: { readOnlyHint: false, openWorldHint: false },
      execute: async ({ input, signal }) => {
        const { message, title, subtitle, sound } = input
        if (!isNonEmptyString(message)) {
          return invalid('message', 'must be a non-empty string')
        }
        for (const [field, value] of [
          ['title', title],
          ['subtitle', subtitle],
        ] as const) {
          if (value != null && typeof value !== 'string') {
            return invalid(field, 'must be a string')
          }
        }
        if (sound != null && typeof sound !== 'boolean') {
          return invalid('sound', 'must be a boolean')
        }

        const { selection } = detect()
        if (selection.notify == null) {
          return errorResult(selection.notifyProblem ?? 'No notification backend is available')
        }

        runner ??= createRunner()
        const backend = createBackend(selection.notify.name, runner)
        if (backend.notify == null) {
          return errorResult(`${backend.name} cannot show notifications`)
        }

        const timeout = new AbortController()
        const timer = setTimeout(() => {
          timeout.abort(new Error('Notification delivery timed out'))
        }, NOTIFY_TIMEOUT_MS)
        const deliverySignal =
          signal == null ? timeout.signal : AbortSignal.any([timeout.signal, signal])
        try {
          await untilAbort(
            backend.notify(
              {
                title: (title as string | undefined) ?? appName,
                message,
                subtitle: subtitle as string | undefined,
                sound: sound as boolean | undefined,
              },
              { timeoutMs: NOTIFY_TIMEOUT_MS, signal: deliverySignal },
            ),
            deliverySignal,
          )
        } catch (error) {
          return errorResult(
            `Notification failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        } finally {
          clearTimeout(timer)
        }
        return jsonResult({ delivered: true, backend: backend.name })
      },
    })
  }

  const elicit = options.elicit
  if (elicit != null) {
    tools.push({
      name: 'ask_user',
      description:
        'Ask the user a question and wait for the answer. Returns status "answered" with the value, "declined", or "cancelled". A timeout returns status "cancelled".',
      inputSchema: ASK_USER_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: false },
      execute: async ({ input, signal }) => {
        const parsed = parseAskInput(input)
        if ('content' in parsed) {
          return parsed
        }

        const timeoutSignal = AbortSignal.timeout(timeoutMs)
        const combined = signal == null ? timeoutSignal : AbortSignal.any([signal, timeoutSignal])
        let result: ElicitResult
        try {
          result = await untilAbort(
            elicit({
              key: 'local',
              params: {
                mode: 'form',
                message: parsed.question,
                requestedSchema: {
                  type: 'object',
                  properties: { answer: parsed.answer },
                  required: ['answer'],
                },
              },
              signal: combined,
            }),
            combined,
          )
        } catch (error) {
          if (timeoutSignal.aborted && signal?.aborted !== true) {
            return jsonResult({ status: 'cancelled' })
          }
          throw error
        }

        switch (result.action) {
          case 'accept':
            return jsonResult({ status: 'answered', value: result.content?.answer })
          case 'decline':
            return jsonResult({ status: 'declined' })
          default:
            return jsonResult({ status: 'cancelled' })
        }
      },
    })
  }

  return tools
}
