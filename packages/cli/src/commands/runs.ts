import {
  type RunListFilter,
  type RunState,
  runStatus,
  type StartRunParams,
} from '@mokei/flow-client'
import { withCommandSignal } from '@tejika/cli'
import { Command, Option } from 'commander'

import { withSocketPath } from '../options.js'
import {
  addJSONOption,
  fail,
  formatSnapshotRow,
  formatTrace,
  isObject,
  parseJSONArg,
  printJSON,
  renderTable,
} from '../output.js'
import { canPromptInTerminal } from '../prompts/index.js'
import { followRun, formatRunDetails } from '../run-follow.js'
import { withControl } from '../with-control.js'

type CommandOptions = { socketPath: string; json?: boolean }

type StartOptions = CommandOptions & {
  file?: string
  input?: string
  label?: string
  wait?: boolean
}

type ListOptions = CommandOptions & { state?: Array<RunState>; limit?: string }

const RUN_STATES: Array<RunState> = [
  'awaiting_approval',
  'denied',
  'working',
  'input_required',
  'completed',
  'failed',
  'cancelled',
]

const RUN_COLUMNS = [
  { key: 'runID', label: 'ID' },
  { key: 'flow', label: 'FLOW' },
  { key: 'label', label: 'LABEL' },
  { key: 'state', label: 'STATE' },
  { key: 'updated', label: 'UPDATED' },
]

async function parseStartParams(
  flow: string | undefined,
  options: StartOptions,
): Promise<StartRunParams> {
  if (flow != null && options.file != null) {
    throw new Error('Give either a flow id or --file, not both')
  }
  if (flow == null && options.file == null) {
    throw new Error('Give a flow id or --file <definition.json>')
  }
  const extra: { input?: Record<string, unknown>; label?: string } = {}
  if (options.input != null) {
    const input = await parseJSONArg('--input', options.input)
    if (!isObject(input)) throw new Error('--input must be a JSON object')
    extra.input = input
  }
  if (options.label != null) extra.label = options.label
  if (flow != null) return { flow, ...extra } as StartRunParams
  const definition = await parseJSONArg('--file', `@${options.file}`)
  if (!isObject(definition)) throw new Error('--file must contain a JSON object')
  return { definition, ...extra } as StartRunParams
}

async function runStart(flow: string | undefined, options: StartOptions): Promise<void> {
  try {
    const params = await parseStartParams(flow, options)
    await withControl(options.socketPath, async (control) => {
      const snapshot = await control.runs.start(params)
      if (!options.wait) {
        if (options.json) {
          printJSON(snapshot)
        } else {
          process.stdout.write(`${snapshot.runID}  ${snapshot.state}\n`)
        }
        return
      }
      const json = options.json === true
      const status = await withCommandSignal((signal) => {
        return followRun(control, snapshot.runID, {
          interactive: !json && canPromptInTerminal(),
          json,
          signal,
        })
      })
      if (status.state !== 'completed') process.exitCode = 1
    })
  } catch (error) {
    fail(error)
  }
}

async function runGet(runID: string, options: CommandOptions): Promise<void> {
  try {
    const status = await withControl(options.socketPath, (control) => runStatus(control, runID))
    if (options.json) {
      printJSON(status)
    } else {
      process.stdout.write(`${formatRunDetails(status)}\n`)
    }
  } catch (error) {
    fail(error)
  }
}

function parseLimit(value: string): number {
  const limit = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(limit)) {
    throw new Error(`--limit must be a non-negative integer, got "${value}"`)
  }
  return limit
}

async function runList(options: ListOptions): Promise<void> {
  try {
    const filter: RunListFilter = {}
    if (options.state != null) filter.states = options.state
    if (options.limit != null) filter.limit = parseLimit(options.limit)
    const runs = await withControl(options.socketPath, (control) => control.runs.list(filter))
    if (options.json) {
      printJSON(runs)
      return
    }
    renderTable(RUN_COLUMNS, runs.map(formatSnapshotRow))
  } catch (error) {
    fail(error)
  }
}

async function runCancel(runID: string, options: CommandOptions): Promise<void> {
  try {
    const snapshot = await withControl(options.socketPath, (control) => control.runs.cancel(runID))
    if (options.json) {
      printJSON(snapshot)
    } else {
      process.stdout.write(`${snapshot.runID}  ${snapshot.state}\n`)
    }
  } catch (error) {
    fail(error)
  }
}

async function runTrace(runID: string, options: CommandOptions): Promise<void> {
  try {
    const trace = await withControl(options.socketPath, (control) => {
      if (control.runs.trace == null) {
        throw new Error('The flow daemon does not expose run traces')
      }
      return control.runs.trace(runID)
    })
    if (options.json) {
      printJSON(trace)
    } else {
      process.stdout.write(`${formatTrace(trace)}\n`)
    }
  } catch (error) {
    fail(error)
  }
}

export function createRunsCommand(): Command {
  const runs = new Command('runs').description('Start, inspect and cancel flow runs')

  const start = runs
    .command('start')
    .description('Start a flow run')
    .argument('[flow]', 'id of a configured flow')
    .option('--file <definition.json>', 'start an inline flow definition instead of a flow id')
    .option('--input <json|@file>', 'run input as a JSON object, or @path to a JSON file')
    .option('--label <text>', 'label for the run')
    .option('--wait', 'watch the run until it ends, answering pending items when interactive')
  addJSONOption(withSocketPath(start)).action(runStart)

  const get = runs
    .command('get')
    .description('Show a run status, pending items and result')
    .argument('<runID>', 'run id')
  addJSONOption(withSocketPath(get)).action(runGet)

  const list = runs
    .command('list')
    .description('List runs')
    .addOption(new Option('--state <state...>', 'only runs in these states').choices(RUN_STATES))
    .option('--limit <n>', 'maximum number of runs')
  addJSONOption(withSocketPath(list)).action(runList)

  const cancel = runs.command('cancel').description('Cancel a run').argument('<runID>', 'run id')
  addJSONOption(withSocketPath(cancel)).action(runCancel)

  const trace = runs
    .command('trace')
    .description('Show a run trace: spans with durations, then logs')
    .argument('<runID>', 'run id')
  addJSONOption(withSocketPath(trace)).action(runTrace)

  return runs
}
