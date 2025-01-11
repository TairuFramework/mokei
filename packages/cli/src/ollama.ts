import { Flags } from '@oclif/core'
import enquirer from 'enquirer'

import { ollama } from './clients/ollama.js'

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

  const models = await ollama.listModels()
  if (models.length === 0) {
    throw new Error('No models installed. Please install a model with `ollama pull <model>`')
  }

  const { model } = await enquirer.prompt<{ model: string }>({
    type: 'select',
    name: 'model',
    message: 'Select a model',
    choices: models.map((m) => m.name),
  })
  return model
}

export async function getPrompt(flags: { prompt?: string } = {}): Promise<string> {
  if (flags.prompt != null && flags.prompt.trim() !== '') {
    return flags.prompt
  }

  const { text } = await enquirer.prompt<{ text: string }>({
    type: 'input',
    message: 'Prompt',
    name: 'text',
  })
  return text
}
