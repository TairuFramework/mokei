import { ProxyHost } from '@mokei/host'
import { OpenAIProvider, type OpenAITypes } from '@mokei/openai-provider'
import { Command, Flags } from '@oclif/core'

import { ChatSession } from '../../chat-session.js'
import { modelFlag, providerAPIFlag } from '../../flags.js'

export default class ChatOpenAI extends Command {
  static description = 'Interactive chat with a model provider using OpenAI APIs'

  static flags = {
    'api-key': Flags.string({
      char: 'k',
      description: 'OpenAI API key',
      env: 'OPENAI_API_KEY',
    }),
    'api-url': providerAPIFlag,
    model: modelFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ChatOpenAI)
    const host = await ProxyHost.forDaemon()
    const provider = new OpenAIProvider({
      client: { apiKey: flags['api-key'], baseURL: flags['api-url'], timeout: false },
    })
    const session = new ChatSession<OpenAITypes>({ host, model: flags.model, provider })
    return await session.run()
  }
}
