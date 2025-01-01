import { Writable } from 'node:stream'
import { Command } from '@oclif/core'
import ollama from 'ollama'
import ora from 'ora'

import { getModel, getPrompt, modelFlag, promptFlag } from '../../local.js'

export default class LocalGenerate extends Command {
  static description = 'Generate a message from a prompt'

  static flags = {
    model: modelFlag,
    prompt: promptFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(LocalGenerate)
    const model = await getModel(flags)
    const prompt = await getPrompt(flags)

    const writer = Writable.toWeb(process.stdout).getWriter()
    const loader = ora('Generating...').start()

    const response = await ollama.generate({ model, prompt, stream: true })
    for await (const part of response) {
      if (loader.isSpinning) {
        loader.stop()
      }
      await writer.write(part.response)
    }
    await writer.write('\n')
  }
}
