import type { FlowControl, InboxItem } from '@mokei/flow-client'
import { withCommandSignal } from '@tejika/cli'
import { Command } from 'commander'

import { answerInputInTerminal, submitAnswer } from '../answer-input.js'
import { withSocketPath } from '../options.js'
import {
  addJSONOption,
  fail,
  formatInboxRow,
  isObject,
  parseJSONArg,
  printJSON,
  renderTable,
} from '../output.js'
import { canPromptInTerminal, promptApproval, UnsupportedSchemaError } from '../prompts/index.js'
import { withControl } from '../with-control.js'

type CommandOptions = { socketPath: string; json?: boolean }

type ListOptions = CommandOptions & { run?: string }

type AnswerOptions = CommandOptions & { value?: string; yes?: boolean }

type DeclineOptions = CommandOptions & { reason?: string }

const INBOX_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'runID', label: 'RUN' },
  { key: 'kind', label: 'KIND' },
  { key: 'summary', label: 'SUMMARY' },
]

function printOutcome(id: string, outcome: string, json: boolean | undefined): void {
  if (json) {
    printJSON({ id, outcome })
  } else {
    process.stdout.write(`${id}  ${outcome}\n`)
  }
}

function formatItem(item: InboxItem): string {
  const lines = [`${item.id}  ${item.kind}  run ${item.runID}`]
  if (item.kind === 'input') {
    lines.push(`  ${item.message}`, `  schema: ${JSON.stringify(item.requestedSchema, null, 2)}`)
  } else {
    lines.push(`  planned tools: ${item.plan.tools.join(', ') || '(none)'}`)
  }
  return lines.join('\n')
}

async function runList(options: ListOptions): Promise<void> {
  try {
    const items = await withControl(options.socketPath, (control) => {
      return control.inbox.list(options.run == null ? {} : { runID: options.run })
    })
    if (options.json) {
      printJSON(items)
      return
    }
    renderTable(INBOX_COLUMNS, items.map(formatInboxRow))
  } catch (error) {
    fail(error)
  }
}

async function runShow(id: string, options: CommandOptions): Promise<void> {
  try {
    const item = await withControl(options.socketPath, (control) => control.inbox.get(id))
    if (options.json) {
      printJSON(item)
    } else {
      process.stdout.write(`${formatItem(item)}\n`)
    }
  } catch (error) {
    fail(error)
  }
}

async function answerApproval(
  control: FlowControl,
  item: InboxItem & { kind: 'approval' },
  options: AnswerOptions,
): Promise<void> {
  if (options.value != null) {
    throw new Error('--value is for input items; an approval is answered with --yes or the prompt')
  }
  if (!options.yes) {
    if (!canPromptInTerminal()) {
      throw new Error(`Cannot prompt without a terminal: pass --yes to approve ${item.id}`)
    }
    // `n` and Esc are indistinguishable, so neither denies: denial is `mokei inbox decline`.
    const approved = await withCommandSignal((signal) => promptApproval(item, { signal }))
    if (!approved) {
      process.stderr.write(
        `Left ${item.id} pending; deny it with: mokei inbox decline ${item.id}\n`,
      )
      process.exitCode = 1
      return
    }
  }
  await control.inbox.answer(item.id)
  printOutcome(item.id, 'answered', options.json)
}

/** Reads `--value` (inline JSON or `@file`) as the answer object, before any connection. */
async function parseAnswerValue(value: string): Promise<Record<string, unknown>> {
  const content = await parseJSONArg('--value', value)
  if (!isObject(content)) throw new Error('--value must be a JSON object')
  return content
}

async function answerInputWithValue(
  control: FlowControl,
  item: InboxItem,
  content: Record<string, unknown>,
  json: boolean | undefined,
): Promise<void> {
  if (!(await submitAnswer(control, item.id, content))) {
    process.exitCode = 1
    return
  }
  printOutcome(item.id, 'answered', json)
}

async function answerInputInteractively(
  control: FlowControl,
  item: InboxItem & { kind: 'input' },
  json: boolean | undefined,
): Promise<void> {
  if (!canPromptInTerminal()) {
    throw new Error(`Cannot prompt without a terminal: pass --value <json> to answer ${item.id}`)
  }
  let answered: boolean
  try {
    answered = await withCommandSignal((signal) => answerInputInTerminal(control, item, signal))
  } catch (error) {
    if (error instanceof UnsupportedSchemaError) {
      throw new Error(`${error.message} (mokei inbox answer ${item.id} --value <json>)`, {
        cause: error,
      })
    }
    throw error
  }
  if (answered) {
    printOutcome(item.id, 'answered', json)
  } else {
    process.exitCode = 1
  }
}

async function runAnswer(id: string, options: AnswerOptions): Promise<void> {
  try {
    // Parse before connecting: a malformed value never starts the daemon or reads the item.
    const content = options.value == null ? undefined : await parseAnswerValue(options.value)
    await withControl(options.socketPath, async (control) => {
      const item = await control.inbox.get(id)
      if (item.kind === 'approval') {
        await answerApproval(control, item, options)
      } else if (content != null) {
        await answerInputWithValue(control, item, content, options.json)
      } else {
        await answerInputInteractively(control, item, options.json)
      }
    })
  } catch (error) {
    fail(error)
  }
}

async function runDecline(id: string, options: DeclineOptions): Promise<void> {
  try {
    await withControl(options.socketPath, (control) => control.inbox.decline(id, options.reason))
    printOutcome(id, 'declined', options.json)
  } catch (error) {
    fail(error)
  }
}

async function runCancel(id: string, options: CommandOptions): Promise<void> {
  try {
    await withControl(options.socketPath, (control) => control.inbox.cancel(id))
    printOutcome(id, 'cancelled', options.json)
  } catch (error) {
    fail(error)
  }
}

async function runPrompt(id: string, options: CommandOptions): Promise<void> {
  try {
    const action = await withControl(options.socketPath, (control) => {
      const prompt = control.inbox.prompt
      if (prompt == null) throw new Error('The flow daemon does not support desktop prompts')
      return withCommandSignal((signal) => prompt.call(control.inbox, id, signal))
    })
    if (options.json) {
      printJSON({ id, action })
    } else {
      process.stdout.write(`${id}  ${action}\n`)
    }
  } catch (error) {
    fail(error)
  }
}

export function createInboxCommand(): Command {
  const inbox = new Command('inbox').description('List and settle pending run inbox items')

  const list = inbox
    .command('list')
    .description('List pending inbox items')
    .option('--run <runID>', 'only items of this run')
  addJSONOption(withSocketPath(list)).action(runList)

  const show = inbox
    .command('show')
    .description('Show an inbox item: the input request or the planned tools')
    .argument('<id>', 'inbox item id')
  addJSONOption(withSocketPath(show)).action(runShow)

  const answer = inbox
    .command('answer')
    .description('Answer an input item, or approve an approval item')
    .argument('<id>', 'inbox item id')
    .option('--value <json|@file>', 'answer for an input item as a JSON object, or @path')
    .option('--yes', 'approve an approval item without asking')
  addJSONOption(withSocketPath(answer)).action(runAnswer)

  const decline = inbox
    .command('decline')
    .description('Decline an inbox item; for an approval this denies the run')
    .argument('<id>', 'inbox item id')
    .option('--reason <text>', 'reason for declining')
  addJSONOption(withSocketPath(decline)).action(runDecline)

  const cancel = inbox
    .command('cancel')
    .description('Cancel an inbox item')
    .argument('<id>', 'inbox item id')
  addJSONOption(withSocketPath(cancel)).action(runCancel)

  const prompt = inbox
    .command('prompt')
    .description('Open the desktop dialog for an item and report the chosen action')
    .argument('<id>', 'inbox item id')
  addJSONOption(withSocketPath(prompt)).action(runPrompt)

  return inbox
}
