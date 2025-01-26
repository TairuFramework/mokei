import { Command } from '@oclif/core'

import { ChatSession } from '../chat-session.js'
import { modelFlag } from '../ollama.js'

export default class Chat extends Command {
  static description = 'Interactive chat with a local model'

  static flags = {
    model: modelFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Chat)
    const session = new ChatSession({ model: flags.model })
    return await session.run()
  }
}
