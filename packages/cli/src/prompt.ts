import enquirer from 'enquirer'

export type Choice = {
  name: string
  message?: string
  value?: unknown
  hint?: string
  role?: string
  enabled?: boolean
  disabled?: boolean | string
  choices?: Array<string | Choice>
}

export type PromptOptions = Parameters<typeof enquirer.prompt>[0]

export async function prompt<T extends Record<string, unknown> = Record<string, never>>(
  options: PromptOptions,
): Promise<T | null> {
  try {
    return await enquirer.prompt(options)
  } catch (reason) {
    return null
  }
}

export async function confirm(message: string, initial = false): Promise<boolean> {
  const result = await prompt<{ confirmed: boolean }>({
    type: 'confirm',
    name: 'confirmed',
    required: false,
    initial,
    message,
  })
  return result?.confirmed ?? false
}

export async function input(message: string, initial?: string): Promise<string | null> {
  const result = await prompt<{ value: string }>({
    type: 'input',
    name: 'value',
    initial,
    message,
  })
  return result?.value ?? null
}
