/**
 * Flow rig facade: runs decision flows against local sibling MCP servers and exposes them to
 * Claude Code as an MCP server over stdio. All logs go to stderr; stdout carries MCP.
 */

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createTool } from '../../packages/context-server/lib/index.js'
import { serveProcess } from '../../packages/context-server-node/lib/index.js'
import { createFlowHost } from '../../packages/flow-host/lib/index.js'
import { createDesktopInputSurface } from '../../packages/host-desktop/lib/index.js'
import { NodeSession } from '../../packages/session-node/lib/index.js'
import { loadConfig } from './config.mjs'
import { createFakePredictor } from './fake-predictor.mjs'

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

function createFacadeTools({ session, flowHost, surface, config, dialogs, promptItem, start }) {
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
        'Start a registered flow (`flow` id) or an inline flow (`definition`); returns a runID',
      inputSchema: {
        type: 'object',
        properties: {
          flow: { type: 'string' },
          definition: { type: 'object' },
          input: { type: 'object' },
        },
      },
      handler: async ({ input }) => {
        const { flow, definition } = input
        if ((flow === undefined) === (definition === undefined)) {
          return errorResult('Provide exactly one of `flow` or `definition`')
        }
        try {
          const snapshot = await start({
            ...(flow === undefined ? { definition } : { flow }),
            ...(input.input === undefined ? {} : { input: input.input }),
          })
          return successResult({ runID: snapshot.runID })
        } catch (err) {
          return errorResult(errorMessage(err))
        }
      },
    }),
    flow_status: createTool({
      description: 'Get the state, pending inputs and result of a run',
      inputSchema: {
        type: 'object',
        properties: { runID: { type: 'string' } },
        required: ['runID'],
      },
      handler: async ({ input }) => {
        const snapshot = await flowHost.get(input.runID)
        if (snapshot === undefined) return errorResult(`Unknown run: ${input.runID}`)
        const pending = TERMINAL.has(snapshot.state)
          ? []
          : flowHost.inbox
              .list({ runID: input.runID })
              .filter(
                (item) =>
                  item.kind === 'input' && !(config.input === 'dialog' && dialogs.has(item.id)),
              )
              .map((item) => ({
                id: item.id,
                message: item.message,
                requestedSchema: item.requestedSchema,
                canPrompt: surface.canPrompt(inputRequest(item, snapshot.label)),
              }))
        const result =
          snapshot.result === undefined
            ? undefined
            : {
                content: snapshot.result.content,
                structuredContent: {
                  ...(snapshot.result.outcome === undefined
                    ? {}
                    : { outcome: snapshot.result.outcome }),
                  ...('output' in snapshot.result ? { output: snapshot.result.output } : {}),
                },
              }
        return successResult({
          state: snapshot.state,
          pending,
          ...(result === undefined ? {} : { result }),
          ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
        })
      },
    }),
    cancel_flow: createTool({
      description: 'Cancel a run',
      inputSchema: {
        type: 'object',
        properties: { runID: { type: 'string' } },
        required: ['runID'],
      },
      handler: async ({ input }) => {
        try {
          return successResult({ state: (await flowHost.cancel(input.runID)).state })
        } catch (err) {
          return errorResult(errorMessage(err))
        }
      },
    }),
  }

  if (config.input !== 'inbox') {
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
    handler: async ({ input, signal }) => {
      try {
        const item = openItem(flowHost, input.id)
        if (item?.kind !== 'input') return errorResult(`Unknown input: ${input.id}`)
        const result = await promptItem(item, signal)
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
    handler: async ({ input }) => {
      try {
        if (openItem(flowHost, input.id)?.kind !== 'input')
          return errorResult(`Unknown input: ${input.id}`)
        await flowHost.inbox.answer(input.id, input.value)
        return successResult({ id: input.id, action: 'accept' })
      } catch (err) {
        return errorResult(errorMessage(err))
      }
    },
  })
  tools.decline_input = createTool({
    description: 'Decline a pending input',
    inputSchema: idSchema,
    handler: async ({ input }) => {
      try {
        if (openItem(flowHost, input.id)?.kind !== 'input')
          return errorResult(`Unknown input: ${input.id}`)
        await flowHost.inbox.decline(input.id)
        return successResult({ id: input.id, action: 'decline' })
      } catch (err) {
        return errorResult(errorMessage(err))
      }
    },
  })
  return tools
}

// Settled items of terminal runs are pruned, so `get` throws for them.
function openItem(flowHost, id) {
  try {
    return flowHost.inbox.get(id)
  } catch {
    return undefined
  }
}

async function disposeAll(steps, log) {
  for (const [name, step] of steps) {
    try {
      await step()
    } catch (err) {
      log(`Failed to dispose ${name}`, err)
    }
  }
}

const TERMINAL = new Set(['denied', 'completed', 'failed', 'cancelled'])

function inputRequest(item, label = item.runID, signal = new AbortController().signal) {
  return {
    key: `flow-rig: ${label}`,
    params: { message: item.message, requestedSchema: item.requestedSchema },
    signal,
  }
}

export async function createRig({ configPath, desktop, logger = console.error }) {
  const log = (...args) => logger('[flow-rig]', ...args)
  const config = await loadConfig(configPath)
  const fake = config.predictor === 'fake'
  const surface = createDesktopInputSurface(desktop ?? {})
  const session = new NodeSession({
    elicit: (request) => surface.prompt(request, { signal: request.signal }),
  })
  let flowHost
  const dialogs = new Map()
  const starts = new Set()
  let stopping = false
  const cleanup = [
    ['flow host', () => flowHost?.dispose()],
    ['desktop surface', () => surface.dispose()],
    ['session', () => session.dispose()],
  ]

  function promptItem(item, signal) {
    const existing = dialogs.get(item.id)
    if (existing !== undefined) return existing.promise
    const controller = new AbortController()
    const stop =
      signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal])
    const entry = { controller, promise: undefined }
    dialogs.set(item.id, entry)
    entry.promise = (async () => {
      const snapshot = await flowHost.get(item.runID)
      stop.throwIfAborted()
      let request
      if (item.kind === 'approval') {
        const title = `Run flow "${snapshot.label}" with tools: ${item.plan.tools.join(', ') || 'none'}`
        request = {
          key: `flow-rig: ${snapshot.label}`,
          params: {
            message: title,
            requestedSchema: {
              type: 'object',
              properties: { approve: { type: 'boolean', title } },
              required: ['approve'],
            },
          },
          signal: stop,
        }
      } else {
        request = inputRequest(item, snapshot.label, stop)
      }
      if (!surface.canPrompt(request)) throw new Error(`Input ${item.id} cannot be prompted`)
      const result = await surface.prompt(request, { signal: stop })
      stop.throwIfAborted()
      if (item.kind === 'approval') {
        if (result.action === 'accept' && result.content?.approve === true) {
          await flowHost.inbox.answer(item.id)
        } else {
          await flowHost.inbox.decline(item.id)
        }
      } else if (result.action === 'accept') {
        await flowHost.inbox.answer(item.id, result.content)
      } else if (result.action === 'decline') {
        await flowHost.inbox.decline(item.id)
      } else {
        await flowHost.inbox.cancel(item.id)
      }
      return result
    })().finally(() => {
      if (dialogs.get(item.id) === entry) dialogs.delete(item.id)
    })
    return entry.promise
  }

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
      flowHost = await createFlowHost({
        session,
        key: FLOW_KEY,
        flows,
        predictor: fake ? createFakePredictor(config.fakeAnswers) : undefined,
        approval: { allow: config.allow },
      })
    } catch (err) {
      throw new Error(`Failed to register flows from ${files.join(', ')}: ${errorMessage(err)}`, {
        cause: err,
      })
    }
    log(`Registered flows: ${flows.map((flow) => flow.id).join(', ')}`)
    flowHost.events.on('inbox:settled', ({ item }) => {
      dialogs.get(item.id)?.controller.abort(new Error(`Input ${item.id} settled`))
    })
    flowHost.events.on('inbox:added', (item) => {
      let pending
      if (item.kind === 'approval') {
        pending =
          config.confirm === 'approve'
            ? flowHost.inbox.answer(item.id)
            : config.confirm === 'deny'
              ? flowHost.inbox.decline(item.id)
              : promptItem(item)
      } else {
        pending =
          config.input === 'dialog'
            ? promptItem(item)
            : flowHost.get(item.runID).then((snapshot) => {
                return surface.notify(inputRequest(item, snapshot.flowID ?? 'inline flow'))
              })
      }
      // Dialogs must not hold up the run queue that settles their inbox items.
      pending.catch((err) => {
        if (!stopping && flowHost.inbox.list().some((open) => open.id === item.id))
          log('Desktop input failed', err)
      })
    })
  } catch (err) {
    await disposeAll(cleanup, log)
    throw err
  }

  async function start(params) {
    if (stopping) throw new Error('Rig is shutting down')
    const pending = flowHost.start(params)
    starts.add(pending)
    try {
      return await pending
    } finally {
      starts.delete(pending)
    }
  }
  const tools = createFacadeTools({
    session,
    flowHost,
    surface,
    config,
    dialogs,
    promptItem,
    start,
  })
  let shutdownPromise
  function shutdown() {
    stopping = true
    shutdownPromise ??= (async () => {
      log('Shutting down')
      await Promise.allSettled(starts)
      for (const run of await flowHost.list()) {
        if (!TERMINAL.has(run.state)) {
          await flowHost
            .cancel(run.runID)
            .catch((err) => log(`Failed to cancel run ${run.runID}`, err))
        }
      }
      for (const entry of dialogs.values())
        entry.controller.abort(new Error('Rig is shutting down'))
      await Promise.allSettled([...dialogs.values()].map((entry) => entry.promise))
      await disposeAll(cleanup, log)
      log('Shutdown complete')
    })()
    return shutdownPromise
  }
  return { tools, shutdown }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const configPath = process.env.FLOW_RIG_CONFIG ?? DEFAULT_CONFIG_PATH
  createRig({ configPath }).then(
    ({ tools, shutdown }) => {
      serveProcess({
        name: 'flow-rig',
        version: '0.1.0',
        protocolVersions: ['2026-07-28', '2025-11-25'],
        tools,
      })
      log('Facade serving on stdio')
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
