/**
 * Resolves the chat backend the model-facing suites run against, so a missing one skips
 * them instead of failing them. Two backends are supported:
 *
 * - **llama.cpp** — set `LLAMA_SERVER_URL` to a running `llama-server`. It serves an
 *   OpenAI-compatible API only, so suites reach it through `OpenAIProvider` and the CLI
 *   through `--provider openai --api-url`. Takes precedence when set.
 * - **ollama** — the default, probed at `OLLAMA_HOST`. Serves its native API plus OpenAI-
 *   and Anthropic-compatible endpoints, so all three providers are exercised.
 *
 * Suites read `hasChatBackend` for `skipIf` and `CHAT_MODEL` / `createChatProvider()` for
 * the backend-specific bits.
 */
import type { AnthropicTypes } from '@mokei/anthropic-provider'
import type { ModelProvider } from '@mokei/model-provider'
import { OllamaProvider, type OllamaTypes } from '@mokei/ollama-provider'
import { OpenAIProvider, type OpenAITypes } from '@mokei/openai-provider'

export type ChatProviderTypes = AnthropicTypes | OllamaTypes | OpenAITypes

export type ChatBackend = {
  kind: 'llama-server' | 'ollama'
  /** Whether the server answered — suites skip when false. */
  available: boolean
  /** Root URL of the server. */
  baseURL: string
  /** OpenAI-compatible endpoint. */
  openaiBaseURL: string
  /** Model the suites request, discovered from llama-server, fixed for ollama. */
  model: string
  /** `mokei chat --provider` value reaching this backend. */
  cliProvider: string
  /** `mokei chat --api-url` value, when the backend is not the CLI provider's default. */
  cliAPIURL?: string
}

/** Fixed ollama model — small, tool-capable, and what the suites' assertions assume. */
const OLLAMA_MODEL = 'lfm2.5:latest'

/**
 * Default llama-server model: the same LFM2.5 the ollama runs use. `llama-server -hf
 * LiquidAI/LFM2.5-1.2B-Thinking-GGUF` reports this id, so discovery normally matches it —
 * it is the fallback when the server does not advertise one.
 */
const LLAMA_SERVER_MODEL = 'LiquidAI/LFM2.5-1.2B-Thinking-GGUF'

function normalizeURL(url: string): string {
  const withScheme = /^https?:\/\//.test(url) ? url : `http://${url}`
  return withScheme.replace(/\/+$/, '')
}

async function fetchJSON(url: string, timeout = 2_000): Promise<unknown | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

async function reachable(url: string, timeout = 2_000): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    return response.ok
  } catch {
    return false
  }
}

/** First model id served by an OpenAI-compatible `/v1/models` endpoint. */
async function firstModelID(openaiBaseURL: string): Promise<string | null> {
  const body = (await fetchJSON(`${openaiBaseURL}/models`)) as {
    data?: Array<{ id?: unknown }>
  } | null
  const id = body?.data?.[0]?.id
  return typeof id === 'string' && id !== '' ? id : null
}

async function resolveBackend(): Promise<ChatBackend> {
  const llamaServer = process.env.LLAMA_SERVER_URL
  if (llamaServer != null && llamaServer !== '') {
    const baseURL = normalizeURL(llamaServer)
    const openaiBaseURL = `${baseURL}/v1`
    // llama-server serves a single loaded model; prefer the id it advertises, since that is
    // what it was actually started with.
    const model = await firstModelID(openaiBaseURL)
    return {
      kind: 'llama-server',
      available: model != null || (await reachable(`${openaiBaseURL}/models`)),
      baseURL,
      openaiBaseURL,
      model: model ?? LLAMA_SERVER_MODEL,
      cliProvider: 'openai',
      cliAPIURL: openaiBaseURL,
    }
  }

  const baseURL = normalizeURL(process.env.OLLAMA_HOST ?? 'http://localhost:11434')
  return {
    kind: 'ollama',
    available: await reachable(baseURL),
    baseURL,
    openaiBaseURL: `${baseURL}/v1`,
    model: OLLAMA_MODEL,
    cliProvider: 'ollama',
  }
}

/** Awaited at module scope so suites can use it in `describe.skipIf`, which needs it at collection time. */
export const chatBackend: ChatBackend = await resolveBackend()

export const hasChatBackend = chatBackend.available
export const CHAT_MODEL = chatBackend.model

/**
 * Provider reaching the resolved backend natively where possible: ollama's own API when
 * running against ollama, the OpenAI-compatible one against llama-server.
 */
export function createChatProvider(): ModelProvider<ChatProviderTypes> {
  const provider =
    chatBackend.kind === 'ollama'
      ? new OllamaProvider({ client: { baseURL: chatBackend.baseURL } })
      : new OpenAIProvider({ client: { baseURL: chatBackend.openaiBaseURL, apiKey: 'llama.cpp' } })
  return provider as ModelProvider<ChatProviderTypes>
}

/** Provider key the CLI and `Session` register the backend provider under. */
export const CHAT_PROVIDER_KEY = chatBackend.cliProvider
