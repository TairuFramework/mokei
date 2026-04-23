import { AnthropicProvider, type AnthropicTypes } from '@mokei/anthropic-provider'
import { ProxyHost } from '@mokei/host'
import { Session } from '@mokei/session'
import { Command, Flags } from '@oclif/core'
import { render } from 'ink'

import { ChatApp } from '../../chat/ChatApp.js'
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
    const session = new Session<AnthropicTypes>({
      contextHost: host,
      providers: { anthropic: provider },
    })

    const app = render(
      <ChatApp
        session={session}
        provider={provider}
        providerKey="anthropic"
        initialModel={flags.model}
      />,
      { exitOnCtrlC: false },
    )
    await app.waitUntilExit()
    await session.dispose()
  }
}
