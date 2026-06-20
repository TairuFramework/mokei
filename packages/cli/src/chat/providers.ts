import { basename } from 'node:path'

import { AnthropicProvider, type AnthropicTypes } from '@mokei/anthropic-provider'
import { ProxyHost } from '@mokei/host'
import { LlamaProvider, type LlamaTypes } from '@mokei/llama-provider'
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

const PROVIDERS = ['ollama', 'openai', 'anthropic', 'llama']

export function resolveApiKey(provider: string, apiKey?: string): string | undefined {
  return apiKey ?? process.env[API_KEY_ENV[provider] ?? '']
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

/**
 * Llama registers models by name, but the CLI takes a GGUF file path. Derive a
 * stable display name from the path so the model picker and `/model` command
 * have something readable to show.
 */
export function llamaModelName(path: string): string {
  return basename(path, '.gguf')
}

export async function buildChat(provider: string, opts: ChatOptions): Promise<BuiltChat> {
  if (!PROVIDERS.some((p) => p === provider)) {
    throw new Error(`unknown provider: ${provider}`)
  }
  const apiKey = resolveApiKey(provider, opts.apiKey)
  const envVar = API_KEY_ENV[provider]
  if (envVar != null && apiKey == null) {
    throw new Error(
      `no API key for ${provider}: set ${envVar} or pass --api-key (env var preferred — argv keys leak via \`ps\` and shell history)`,
    )
  }
  if (provider === 'llama' && (opts.model == null || opts.model.trim() === '')) {
    throw new Error('no model for llama: pass --model <path-to-gguf> (the local GGUF file path)')
  }
  const host = await ProxyHost.forDaemon()
  const timeoutMs = opts.timeoutMs

  function build<T extends ProviderTypes>(
    session: Session<T>,
    providerInstance: ModelProvider<T>,
    providerKey: string,
    initialModel: string | undefined = opts.model,
  ): BuiltChat {
    return {
      element: createElement<ChatAppProps<T>>(ChatApp, {
        session,
        provider: providerInstance,
        providerKey,
        initialModel,
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
    case 'llama': {
      // Trim to match LlamaPathCard's interactive trimming — a stray-whitespace
      // -m value should resolve to the same path either way.
      const path = (opts.model as string).trim()
      const name = llamaModelName(path)
      const p = new LlamaProvider({ models: { [name]: { path } } })
      const session = new Session<LlamaTypes>({ contextHost: host, providers: { llama: p } })
      return build(session, p, 'llama', name)
    }
    default:
      throw new Error(`unknown provider: ${provider}`)
  }
}
