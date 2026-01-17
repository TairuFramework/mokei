import { AnthropicProvider, type AnthropicTypes } from '@mokei/anthropic-provider'
import { ProxyHost } from '@mokei/host'
import { Command, Flags } from '@oclif/core'

import { ChatSession } from '../../chat-session.js'
import { modelFlag, providerAPIFlag } from '../../flags.js'

export default class ChatAnthropic extends Command {
  static description = 'Interactive chat with a model provider using Anthropic APIs'

  static flags = {
    'api-key': Flags.string({
      char: 'k',
      description: 'Anthropic API key',
      env: 'ANTHROPIC_API_KEY',
    }),
    'api-url': providerAPIFlag,
    model: modelFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ChatAnthropic)
    const host = await ProxyHost.forDaemon()
    const provider = new AnthropicProvider({
      client: { apiKey: flags['api-key'], baseURL: flags['api-url'], timeout: false },
    })
    const session = new ChatSession<AnthropicTypes>({ host, model: flags.model, provider })
    return await session.run()
  }
}
