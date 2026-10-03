import { type FlowControl, type InboxItem, isFlowControlError } from '@mokei/flow-client'

import { promptForm } from './prompts/index.js'

/** The issues of an `INBOX_ANSWER_INVALID` error, or its message when it carries none. */
export function invalidIssues(error: {
  message: string
  data?: Record<string, unknown>
}): Array<string> {
  const issues = error.data?.issues
  return Array.isArray(issues) && issues.length > 0 ? issues.map(String) : [error.message]
}

/**
 * Answers `answer`, printing the issues and resolving `false` when the daemon rejects it as
 * `INBOX_ANSWER_INVALID`. Other failures reject.
 */
export async function submitAnswer(
  control: FlowControl,
  id: string,
  answer: Record<string, unknown>,
): Promise<boolean> {
  try {
    await control.inbox.answer(id, answer)
    return true
  } catch (error) {
    if (!isFlowControlError(error, 'INBOX_ANSWER_INVALID')) throw error
    for (const line of invalidIssues(error)) process.stderr.write(`✘ ${line}\n`)
    return false
  }
}

/**
 * Prompts for an input item's form in the terminal and answers it, prompting again after an
 * `INBOX_ANSWER_INVALID` rejection (its issues printed). Resolves `true` once answered, or `false`
 * when the form is cancelled with Esc, after telling the user the item stays pending. Rejects with
 * `UnsupportedSchemaError` for a form the terminal cannot render, and with the abort reason when
 * `signal` aborts.
 */
export async function answerInputInTerminal(
  control: FlowControl,
  item: InboxItem & { kind: 'input' },
  signal: AbortSignal,
): Promise<boolean> {
  for (;;) {
    const values = await promptForm(item, { signal })
    if (values === undefined) {
      process.stderr.write(
        `Left ${item.id} pending; answer it later with: mokei inbox answer ${item.id}\n`,
      )
      return false
    }
    if (await submitAnswer(control, item.id, values)) return true
  }
}
