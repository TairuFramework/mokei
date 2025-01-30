import { ProxyHost } from '@mokei/host'
import { Command } from '@oclif/core'

import { ChatSession } from '../../chat-session.js'
import { modelFlag, providerAPIFlag } from '../../flags.js'
import { OllamaProvider, type OllamaTypes } from '../../providers/ollama.js'

export default class Chat extends Command {
  static description = 'Interactive chat with a local model'

  static flags = {
    'api-url': providerAPIFlag,
    model: modelFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Chat)
    const host = await ProxyHost.forDaemon()
    const provider = new OllamaProvider({ client: { baseURL: flags['api-url'] } })
    const session = new ChatSession<OllamaTypes>({ host, model: flags.model, provider })
    return await session.run()
  }
}
