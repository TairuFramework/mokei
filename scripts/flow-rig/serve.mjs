/**
 * Flow rig facade: runs decision flows against local sibling MCP servers and exposes them to
 * Claude Code as an MCP server over stdio. All logs go to stderr; stdout carries MCP.
 */

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { TaskInputWithdrawnError } from '../../packages/context-client/lib/index.js'
import { createTool } from '../../packages/context-server/lib/index.js'
import { serveProcess } from '../../packages/context-server-node/lib/index.js'
import { addDecisionFlow, flowToolName } from '../../packages/decision-flow-server/lib/index.js'
import {
  createDesktopElicitHandler,
  createInputInbox,
  InboxAnswerInvalidError,
} from '../../packages/host-desktop/lib/index.js'
import { NodeSession } from '../../packages/session-node/lib/index.js'
import { createApprovalStrategy, createApprove } from './approval.mjs'
import { loadConfig } from './config.mjs'
import { createFakePredictor } from './fake-predictor.mjs'
import { createRunManager } from './runs.mjs'

const FLOW_KEY = 'flow'
const DEFAULT_CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), 'rig.config.json')

function log(...args) {
  console.error('[flow-rig]', ...args)
}

function errorMessage(err) {
  return err?.message ?? String(err)
}

function errorResult(text) {
  return { isError: true, content: [{ type: 'text', text }] }
}

function successResult(structuredContent) {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  }
}

/** Readable prompt source for a run: its flow id, or `inline flow`. */
function describeRun(runs, runId) {
  const label = runId === undefined ? undefined : runs?.label(runId)
  if (label !== undefined) {
    return `flow-rig: ${label}`
  }
  return runId === undefined ? 'flow-rig' : `flow-rig run ${runId.slice(0, 8)}`
}

async function loadFlows(flowsDir) {
  const files = (await readdir(flowsDir)).filter((name) => name.endsWith('.json')).sort()
  const flows = []
  for (const file of files) {
    try {
      flows.push(JSON.parse(await readFile(join(flowsDir, file), 'utf8')))
    } catch (err) {
      throw new Error(`Failed to read flow file ${file}: ${errorMessage(err)}`, { cause: err })
    }
  }
  return { files, flows }
}

function createConfirmDialog(confirm) {
  return async (flow, signal) => {
    const title = `Run flow "${flow.name}" with tools: ${flow.tools.join(', ') || 'none'}`
    const result = await confirm({
      params: {
        message: title,
        requestedSchema: {
          type: 'object',
          properties: { approve: { type: 'boolean', title } },
          required: ['approve'],
        },
      },
      signal,
    })
    return result.action === 'accept' && result.content?.approve === true
  }
}

function createFacadeTools({ session, runs, inbox }) {
  const host = session.contextHost

  const tools = {
    list_flows: createTool({
      description: 'List the registered flows',
      inputSchema: { type: 'object' },
      handler: ({ signal }) =>
        host.callNamespacedTool({ id: `${FLOW_KEY}:list_flows`, arguments: {}, signal }),
    }),
    check_flow: createTool({
      description: 'Check an inline flow definition without running it',
      inputSchema: {
        type: 'object',
        properties: { definition: { type: 'object' } },
        required: ['definition'],
      },
      handler: ({ input, signal }) =>
        host.callNamespacedTool({
          id: `${FLOW_KEY}:check_flow`,
          arguments: { definition: input.definition },
          signal,
        }),
    }),
    start_flow: createTool({
      description:
        'Start a registered flow (`flow` id) or an inline flow (`definition`); returns a runId',
      inputSchema: {
        type: 'object',
        properties: {
          flow: { type: 'string' },
          definition: { type: 'object' },
          input: { type: 'object' },
        },
      },
      handler: ({ input, signal }) => {
        const { flow, definition } = input
        if ((flow === undefined) === (definition === undefined)) {
          return errorResult('Provide exactly one of `flow` or `definition`')
        }
        if (flow !== undefined) {
          return runs.start({
            toolName: flowToolName(flow),
            args: input.input ?? {},
            signal,
            label: flow,
          })
        }
        const args = input.input === undefined ? { definition } : { definition, input: input.input }
        return runs.start({ toolName: 'run_flow', args, signal, label: 'inline flow' })
      },
    }),
    flow_status: createTool({
      description: 'Get the state, pending inputs and result of a run',
      inputSchema: {
        type: 'object',
        properties: { runId: { type: 'string' } },
        required: ['runId'],
      },
      handler: ({ input }) => runs.status(input.runId),
    }),
    cancel_flow: createTool({
      description: 'Cancel a run',
      inputSchema: {
        type: 'object',
        properties: { runId: { type: 'string' } },
        required: ['runId'],
      },
      handler: ({ input }) => runs.cancel(input.runId),
    }),
  }

  if (inbox === undefined) {
    return tools
  }

  const idSchema = {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  }

  tools.prompt_input = createTool({
    description: 'Open desktop dialogs for a pending input and return the settled action',
    inputSchema: idSchema,
    handler: async ({ input }) => {
      if (inbox.get(input.id) === undefined) {
        return errorResult(`Unknown input: ${input.id}`)
      }
      try {
        const result = await inbox.prompt(input.id)
        return successResult({ id: input.id, action: result.action })
      } catch (err) {
        return errorResult(errorMessage(err))
      }
    },
  })
  tools.answer_input = createTool({
    description: 'Answer a pending input with a value matching its requested schema',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, value: { type: 'object' } },
      required: ['id', 'value'],
    },
    handler: ({ input }) => {
      try {
        if (!inbox.answer(input.id, input.value)) {
          return errorResult(`Unknown input: ${input.id}`)
        }
      } catch (err) {
        if (err instanceof InboxAnswerInvalidError) {
          return errorResult(err.message)
        }
        throw err
      }
      return successResult({ id: input.id, action: 'accept' })
    },
  })
  tools.decline_input = createTool({
    description: 'Decline a pending input',
    inputSchema: idSchema,
    handler: ({ input }) => {
      if (!inbox.decline(input.id)) {
        return errorResult(`Unknown input: ${input.id}`)
      }
      return successResult({ id: input.id, action: 'decline' })
    },
  })
  return tools
}

async function disposeAll(steps) {
  for (const [name, step] of steps) {
    try {
      await step()
    } catch (err) {
      log(`Failed to dispose ${name}`, err)
    }
  }
}

export async function main({ configPath, stdio = true }) {
  const config = await loadConfig(configPath)
  const fake = config.predictor === 'fake'

  let inbox
  let releaseSurface
  if (config.input === 'inbox') {
    inbox = createInputInbox()
    releaseSurface = inbox.registerAnswerSurface()
  }
  let runs
  const inputs = createDesktopElicitHandler({
    mode: config.input,
    inbox,
    describeSource: (request) => describeRun(runs, request.key),
  })
  const confirm = createDesktopElicitHandler({ mode: 'dialog' })
  const session = new NodeSession({ elicit: (request) => inputs(request) })

  let wiring
  const cleanup = [
    ['inbox', () => inbox?.dispose()],
    ['inbox answer surface', () => releaseSurface?.()],
    ['input handler', () => inputs.dispose()],
    ['confirm handler', () => confirm.dispose()],
    ['flow wiring', () => wiring?.dispose()],
    ['session', () => session.dispose()],
  ]

  try {
    for (const [key, sibling] of Object.entries(config.siblings)) {
      if (key === 'system-one' && fake) {
        log('Skipping system-one sibling (fake predictor)')
        continue
      }
      try {
        await session.addContext({
          key,
          command: sibling.command,
          args: sibling.args,
          env: sibling.env,
        })
      } catch (err) {
        throw new Error(`Failed to start sibling ${key}: ${errorMessage(err)}`, { cause: err })
      }
      log(`Sibling ${key} ready`)
    }

    const { files, flows } = await loadFlows(config.flowsDir)
    try {
      wiring = await addDecisionFlow(session, {
        key: FLOW_KEY,
        flows,
        predictor: fake ? createFakePredictor(config.fakeAnswers) : undefined,
      })
    } catch (err) {
      throw new Error(`Failed to register flows from ${files.join(', ')}: ${errorMessage(err)}`, {
        cause: err,
      })
    }
    log(`Registered flows: ${flows.map((flow) => flow.id).join(', ')}`)

    const strategy = createApprovalStrategy({
      allow: config.allow,
      confirm: config.confirm,
      confirmDialog: createConfirmDialog(confirm),
    })
    runs = createRunManager({
      client: session.contextHost.getContext(FLOW_KEY).client,
      approve: createApprove({ wrapped: wiring.wrapApproval(strategy) }),
      ask: (runId, _key, request, signal) => inputs({ key: runId, params: request.params, signal }),
      listPending: (runId) =>
        inbox === undefined
          ? []
          : inbox
              .list()
              .filter((entry) => entry.key === runId)
              .map(({ id, message, requestedSchema, canPrompt }) => ({
                id,
                message,
                requestedSchema,
                canPrompt,
              })),
      log,
      withdrawReason: (params) => new TaskInputWithdrawnError(params),
    })
  } catch (err) {
    await disposeAll(cleanup)
    throw err
  }

  const tools = createFacadeTools({ session, runs, inbox })

  let shutdownPromise
  function shutdown() {
    shutdownPromise ??= (async () => {
      log('Shutting down')
      await runs.shutdown()
      await disposeAll(cleanup)
      log('Shutdown complete')
    })()
    return shutdownPromise
  }

  if (stdio) {
    serveProcess({
      name: 'flow-rig',
      version: '0.1.0',
      protocolVersions: ['2026-07-28', '2025-11-25'],
      tools,
    })
    log('Facade serving on stdio')
  }

  return { tools, shutdown }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const configPath = process.env.FLOW_RIG_CONFIG ?? DEFAULT_CONFIG_PATH
  main({ configPath }).then(
    ({ shutdown }) => {
      const exit = () => {
        shutdown().then(
          () => process.exit(0),
          (err) => {
            log('Shutdown failed', err)
            process.exit(1)
          },
        )
      }
      process.once('SIGINT', exit)
      process.once('SIGTERM', exit)
      process.stdin.once('end', exit)
    },
    (err) => {
      log(errorMessage(err))
      process.exit(1)
    },
  )
}
