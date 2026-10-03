import { createTool, type Schema, type ServerConfig } from '@mokei/context-server'

import { isFlowControlError } from './errors.js'
import type { FlowControl, PendingItem, RunStatus } from './types.js'
import { isActionable, runStatus, waitForRun } from './wait.js'

const PROTOCOL_VERSIONS: ServerConfig['protocolVersions'] = ['2026-07-28', '2025-11-25']
type CallToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
  isError?: boolean
}

const DEFAULT_WAIT_MS = 60_000
const MAX_WAIT_MS = 300_000
const DEFAULT_LIST_LIMIT = 20

export type FlowControlServerOptions = { name?: string; version?: string }

const objectSchema = { type: 'object', additionalProperties: true } as const satisfies Schema
const runIDSchema = {
  type: 'object',
  properties: { runID: { type: 'string', description: 'Run identifier' } },
  required: ['runID'],
  additionalProperties: false,
} as const satisfies Schema

function success(data: Record<string, unknown>, text?: string): CallToolResult {
  return {
    content: [{ type: 'text', text: text ?? JSON.stringify(data) }],
    structuredContent: data,
  }
}

function failure(message: string, code?: string): CallToolResult {
  return {
    content: [{ type: 'text', text: code == null ? message : `${code}: ${message}` }],
    structuredContent: code == null ? { error: message } : { code, error: message },
    isError: true,
  }
}

/** Maps any thrown value to an `isError` result; tool handlers never throw. */
function toFailure(error: unknown): CallToolResult {
  if (isFlowControlError(error)) return failure(error.message, error.code)
  const message = error instanceof Error ? error.message : String(error)
  return failure(message, 'INTERNAL_ERROR')
}

async function guard(work: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await work()
  } catch (error) {
    return toFailure(error)
  }
}

function refuseApproval(item: PendingItem | { id: string }, canPrompt: boolean): CallToolResult {
  const hint = canPrompt
    ? 'Approvals need a human: use prompt_input to open the approval dialog.'
    : 'Approvals need a human, and prompt_input is not available here: approve it from the desktop.'
  return failure(`Item ${item.id} is an approval. ${hint}`, 'INBOX_ANSWER_INVALID')
}

/**
 * Creates the `ServerConfig` of an MCP server exposing a `FlowControl` as tools. The caller adds
 * a transport (`serveProcess(config)` for stdio, or `new ContextServer({ ...config, transport })`).
 * `prompt_input` is registered only when `control.inbox.prompt` exists.
 */
export function createFlowControlServer(
  control: FlowControl,
  options: FlowControlServerOptions = {},
): ServerConfig {
  const prompt = control.inbox.prompt?.bind(control.inbox)
  const canPrompt = prompt != null

  async function settle(
    id: string,
    action: (item: { runID: string }) => Promise<void>,
  ): Promise<CallToolResult> {
    const item = await control.inbox.get(id)
    if (item.kind === 'approval') return refuseApproval(item, canPrompt)
    await action(item)
    return success({ ...(await runStatus(control, item.runID)) })
  }

  const tools: NonNullable<ServerConfig['tools']> = {
    list_flows: createTool({
      description: 'List the registered flows',
      inputSchema: { type: 'object', additionalProperties: false } as const satisfies Schema,
      handler: () =>
        guard(async () => {
          const flows = await control.flows.list()
          return success({ flows }, JSON.stringify(flows))
        }),
    }),

    check_flow: createTool({
      description: 'Validate a flow definition without running it',
      inputSchema: {
        type: 'object',
        properties: { definition: objectSchema },
        required: ['definition'],
        additionalProperties: false,
      } as const satisfies Schema,
      handler: (req) =>
        guard(async () => {
          const result = await control.flows.check(req.input.definition)
          return success({ ...result }, result.formatted)
        }),
    }),

    start_flow: createTool({
      description:
        'Start a flow run from a registered flow name or an inline definition (exactly one). Returns the run status at once; use wait_flow to wait for input or completion.',
      inputSchema: {
        type: 'object',
        properties: {
          flow: { type: 'string', description: 'Registered flow name' },
          definition: { ...objectSchema, description: 'Inline flow definition' },
          input: { ...objectSchema, description: 'Flow input, defaults to {}' },
          label: { type: 'string', description: 'Optional run label' },
        },
        additionalProperties: false,
      } as const satisfies Schema,
      handler: (req) =>
        guard(async () => {
          const { flow, definition, input, label } = req.input
          if ((flow == null) === (definition == null)) {
            return failure('Provide exactly one of flow or definition', 'FLOW_INVALID')
          }
          const base = { input: input ?? {}, ...(label == null ? {} : { label }) }
          const run = await control.runs.start(
            flow != null ? { flow, ...base } : { definition: definition as never, ...base },
          )
          return success({ ...(await runStatus(control, run.runID)) })
        }),
    }),

    flow_status: createTool({
      description: 'Get the status of a run, including pending input and approval items',
      inputSchema: runIDSchema,
      handler: (req) =>
        guard(async () => success({ ...(await runStatus(control, req.input.runID)) })),
    }),

    wait_flow: createTool({
      description:
        'Wait until a run is terminal or has a pending input or approval item (returns at once if it already does). Default timeout 60000 ms, maximum 300000 ms.',
      inputSchema: {
        type: 'object',
        properties: {
          runID: { type: 'string', description: 'Run identifier' },
          timeoutMs: { type: 'integer', minimum: 0, description: 'Wait timeout in milliseconds' },
        },
        required: ['runID'],
        additionalProperties: false,
      } as const satisfies Schema,
      handler: (req) =>
        guard(async () => {
          const timeoutMs = Math.min(req.input.timeoutMs ?? DEFAULT_WAIT_MS, MAX_WAIT_MS)
          const { status, timedOut } = await waitForRun(control, req.input.runID, {
            until: isActionable,
            timeoutMs,
            signal: req.signal,
          })
          return success({ ...status, timedOut })
        }),
    }),

    list_runs: createTool({
      description: 'List recent runs without their pending items',
      inputSchema: {
        type: 'object',
        properties: {
          states: { type: 'array', items: { type: 'string' }, description: 'Filter by run state' },
          limit: { type: 'integer', minimum: 1, description: 'Maximum runs, default 20' },
        },
        additionalProperties: false,
      } as const satisfies Schema,
      handler: (req) =>
        guard(async () => {
          const filter = {
            ...(req.input.states == null ? {} : { states: req.input.states }),
            limit: req.input.limit ?? DEFAULT_LIST_LIMIT,
          }
          const snapshots = await control.runs.list(filter as never)
          const runs = snapshots.map((snapshot) => {
            const run: Omit<RunStatus, 'pending'> = { runID: snapshot.runID, state: snapshot.state }
            if (snapshot.result !== undefined) run.result = snapshot.result
            if (snapshot.error !== undefined) run.error = snapshot.error
            return run
          })
          return success({ runs })
        }),
    }),

    cancel_flow: createTool({
      description: 'Cancel a run',
      inputSchema: runIDSchema,
      handler: (req) =>
        guard(async () => {
          await control.runs.cancel(req.input.runID)
          return success({ ...(await runStatus(control, req.input.runID)) })
        }),
    }),

    answer_input: createTool({
      description:
        'Answer a pending input item. Approval items need a human: use prompt_input for those.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Inbox item id' },
          value: { ...objectSchema, description: 'Answer matching the item requestedSchema' },
        },
        required: ['id', 'value'],
        additionalProperties: false,
      } as const satisfies Schema,
      handler: (req) =>
        guard(() =>
          settle(req.input.id, () => control.inbox.answer(req.input.id, req.input.value)),
        ),
    }),

    decline_input: createTool({
      description:
        'Decline a pending input item. Approval items need a human: use prompt_input for those.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Inbox item id' },
          reason: { type: 'string', description: 'Optional reason' },
        },
        required: ['id'],
        additionalProperties: false,
      } as const satisfies Schema,
      handler: (req) =>
        guard(() =>
          settle(req.input.id, () => control.inbox.decline(req.input.id, req.input.reason)),
        ),
    }),
  }

  if (prompt != null) {
    tools.prompt_input = createTool({
      description:
        'Open the desktop dialog for a pending input or approval item and wait until it settles. Returns the id and the action taken (accept, decline or cancel).',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Inbox item id' } },
        required: ['id'],
        additionalProperties: false,
      } as const satisfies Schema,
      handler: async (req) => {
        const { id } = req.input
        try {
          const action = await prompt(id, req.signal)
          return success({ id, action })
        } catch (error) {
          if (req.signal.aborted) {
            return failure(`Prompt for item ${id} was cancelled; the item stays pending`)
          }
          if (isFlowControlError(error)) {
            switch (error.code) {
              case 'INBOX_ITEM_NOT_FOUND':
                return failure(`Item ${id} was settled elsewhere`, error.code)
              case 'PROMPT_IN_PROGRESS':
                return failure(
                  `Another caller already owns the prompt for item ${id}; the item stays pending`,
                  error.code,
                )
              case 'PROMPT_UNSUPPORTED':
                return failure(
                  `The desktop cannot render the prompt for item ${id}; the item stays pending`,
                  error.code,
                )
            }
          }
          return toFailure(error)
        }
      },
    })
  }

  return {
    name: options.name ?? 'mokei-flows',
    version: options.version ?? '0.0.0',
    protocolVersions: PROTOCOL_VERSIONS,
    tools,
  }
}
