import { AnthropicProvider, type AnthropicTypes } from '@mokei/anthropic-provider'
import { ProxyHost } from '@mokei/host'
import type { ModelProvider, ProviderTypes } from '@mokei/model-provider'
import { OllamaProvider, type OllamaTypes } from '@mokei/ollama-provider'
import { OpenAIProvider, type OpenAITypes } from '@mokei/openai-provider'
import { Session } from '@mokei/session'
import { createElement, type ReactNode } from 'react'

import { ChatApp, type ChatAppProps } from './ChatApp.js'

const API_KEY_ENV: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
}

export type ChatOptions = {
  apiKey?: string
  apiUrl?: string
  model?: string
  timeoutMs?: number
}

export type BuiltChat = {
  element: ReactNode
  dispose: () => Promise<void>
}

export async function buildChat(provider: string, opts: ChatOptions): Promise<BuiltChat> {
  const host = await ProxyHost.forDaemon()
  const apiKey = opts.apiKey ?? process.env[API_KEY_ENV[provider] ?? '']
  const timeoutMs = opts.timeoutMs

  function build<T extends ProviderTypes>(
    session: Session<T>,
    providerInstance: ModelProvider<T>,
    providerKey: string,
  ): BuiltChat {
    return {
      element: createElement<ChatAppProps<T>>(ChatApp, {
        session,
        provider: providerInstance,
        providerKey,
        initialModel: opts.model,
        timeout: timeoutMs,
      }),
      dispose: () => session.dispose(),
    }
  }

  switch (provider) {
    case 'ollama': {
      const p = new OllamaProvider({ client: { baseURL: opts.apiUrl, timeout: false } })
      const session = new Session<OllamaTypes>({ contextHost: host, providers: { ollama: p } })
      return build(session, p, 'ollama')
    }
    case 'openai': {
      const p = new OpenAIProvider({
        client: { apiKey, baseURL: opts.apiUrl, timeout: false },
      })
      const session = new Session<OpenAITypes>({ contextHost: host, providers: { openai: p } })
      return build(session, p, 'openai')
    }
    case 'anthropic': {
      const p = new AnthropicProvider({
        client: { apiKey, baseURL: opts.apiUrl, timeout: false },
      })
      const session = new Session<AnthropicTypes>({
        contextHost: host,
        providers: { anthropic: p },
      })
      return build(session, p, 'anthropic')
    }
    default:
      throw new Error(`unknown provider: ${provider}`)
  }
}
