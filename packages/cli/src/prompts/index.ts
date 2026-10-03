import type { InboxItem } from '@mokei/flow-client'
import { runInk } from '@tejika/cli'
import { createElement, type ReactElement } from 'react'

import { ApprovalRunner } from './ApprovalPrompt.js'
import { ExitOnAbort } from './ExitOnAbort.js'
import { FormRunner } from './SchemaForm.js'
import { parseElicitationForm } from './schema-form.js'

export { ApprovalPrompt, ApprovalRunner } from './ApprovalPrompt.js'
export { ExitOnAbort } from './ExitOnAbort.js'
export { FormRunner, SchemaForm } from './SchemaForm.js'
export {
  type FieldValidation,
  type FormField,
  type FormFieldKind,
  parseElicitationForm,
  UnsupportedSchemaError,
  validateFieldInput,
} from './schema-form.js'

/**
 * Runs a prompt app. With a signal, an abort closes and unmounts the prompt, then rejects with the
 * abort reason (also when already aborted), whatever the prompt reported.
 */
async function runPrompt(element: ReactElement, signal?: AbortSignal): Promise<void> {
  if (signal == null) {
    await runInk(element)
    return
  }
  signal.throwIfAborted()
  await runInk(createElement(ExitOnAbort, { signal }, element))
  signal.throwIfAborted()
}

export type PromptOptions = { signal?: AbortSignal }

export function canPromptInTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

/**
 * Prompts for an input item's form, one field at a time. Resolves `undefined` when cancelled with
 * Esc. Throws `UnsupportedSchemaError` when the schema is not a primitive-only form. Rejects with
 * the abort reason when `signal` aborts.
 */
export async function promptForm(
  item: InboxItem & { kind: 'input' },
  options: PromptOptions & { onInvalid?: (issues: Array<string>) => void } = {},
): Promise<Record<string, unknown> | undefined> {
  const fields = parseElicitationForm(item.requestedSchema as Record<string, unknown>)
  let answer: Record<string, unknown> | undefined
  await runPrompt(
    createElement(FormRunner, {
      title: item.message,
      fields,
      onInvalid: options.onInvalid,
      onDone: (values) => {
        answer = values
      },
    }),
    options.signal,
  )
  return answer
}

/**
 * Prompts to approve a planned run. Resolves `false` on `n` or Esc. Rejects with the abort reason
 * when `signal` aborts.
 */
export async function promptApproval(
  item: InboxItem & { kind: 'approval' },
  options: PromptOptions = {},
): Promise<boolean> {
  let approved = false
  await runPrompt(
    createElement(ApprovalRunner, {
      tools: item.plan.tools,
      onDone: (value) => {
        approved = value
      },
    }),
    options.signal,
  )
  return approved
}
