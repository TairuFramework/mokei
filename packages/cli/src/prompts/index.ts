import type { InboxItem } from '@mokei/flow-client'
import { runInk } from '@tejika/cli'
import { createElement } from 'react'

import { ApprovalRunner } from './ApprovalPrompt.js'
import { FormRunner } from './SchemaForm.js'
import { parseElicitationForm } from './schema-form.js'

export { ApprovalPrompt, ApprovalRunner } from './ApprovalPrompt.js'
export { FormRunner, SchemaForm } from './SchemaForm.js'
export {
  type FieldValidation,
  type FormField,
  type FormFieldKind,
  parseElicitationForm,
  UnsupportedSchemaError,
  validateFieldInput,
} from './schema-form.js'

export function canPromptInTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

/**
 * Prompts for an input item's form, one field at a time. Resolves `undefined` when cancelled with
 * Esc. Throws `UnsupportedSchemaError` when the schema is not a primitive-only form.
 */
export async function promptForm(
  item: InboxItem & { kind: 'input' },
  options: { onInvalid?: (issues: Array<string>) => void } = {},
): Promise<Record<string, unknown> | undefined> {
  const fields = parseElicitationForm(item.requestedSchema as Record<string, unknown>)
  let answer: Record<string, unknown> | undefined
  await runInk(
    createElement(FormRunner, {
      title: item.message,
      fields,
      onInvalid: options.onInvalid,
      onDone: (values) => {
        answer = values
      },
    }),
  )
  return answer
}

/** Prompts to approve a planned run. Esc or `n` denies. */
export async function promptApproval(item: InboxItem & { kind: 'approval' }): Promise<boolean> {
  let approved = false
  await runInk(
    createElement(ApprovalRunner, {
      tools: item.plan.tools,
      onDone: (value) => {
        approved = value
      },
    }),
  )
  return approved
}
