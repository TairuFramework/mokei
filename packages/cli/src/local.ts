import { input, select } from '@inquirer/prompts'
import { Flags } from '@oclif/core'
import ollama from 'ollama'

export const modelFlag = Flags.string({
  name: 'model',
  char: 'm',
  description: 'Name of the installed Ollama model to use.',
})

export const promptFlag = Flags.string({
  name: 'prompt',
  char: 'p',
  description: 'The prompt to send to the model.',
})

export async function getModel(flags: { model?: string } = {}): Promise<string> {
  if (flags.model != null && flags.model.trim() !== '') {
    return flags.model
  }

  const list = await ollama.list()
  if (list.models.length === 0) {
    throw new Error('No models installed. Please install a model with `ollama pull <model>`')
  }

  return await select({
    message: 'Select a model',
    choices: list.models.map((m) => ({ name: m.name, value: m.name })),
  })
}

export async function getPrompt(flags: { prompt?: string } = {}): Promise<string> {
  if (flags.prompt != null && flags.prompt.trim() !== '') {
    return flags.prompt
  }

  return await input({ message: 'Prompt' })
}
