import { ProxyHost } from '@mokei/host'
import { OllamaProvider, type OllamaTypes } from '@mokei/ollama-provider'
import { Session } from '@mokei/session'
import { Command } from '@oclif/core'
import { render } from 'ink'

import { ChatApp } from '../../chat/ChatApp.js'
import { modelFlag, providerAPIFlag } from '../../flags.js'

export default class ChatOllama extends Command {
  static description = 'Interactive chat with a local model'

  static flags = {
    'api-url': providerAPIFlag,
    model: modelFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ChatOllama)
    const host = await ProxyHost.forDaemon()
    const provider = new OllamaProvider({ client: { baseURL: flags['api-url'], timeout: false } })
    const session = new Session<OllamaTypes>({
      contextHost: host,
      providers: { ollama: provider },
    })
    const app = render(
      <ChatApp
        session={session}
        provider={provider}
        providerKey="ollama"
        initialModel={flags.model}
      />,
      { exitOnCtrlC: false },
    )
    await app.waitUntilExit()
    await session.dispose()
  }
}
