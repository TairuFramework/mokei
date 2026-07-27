/**
 * Resolves the chat backend the model-facing suites run against, so a missing one skips
 * them instead of failing them. Two backends are supported, both serving OpenAI-
 * (`/v1/chat/completions`) and Anthropic-compatible (`/v1/messages`) endpoints:
 *
 * - **llama.cpp** — the default, probed at `LLAMA_SERVER_URL` or `http://127.0.0.1:8080`.
 *   Start it with `--jinja`, without which it parses no tool calls and the suites that
 *   assert one fail. Suites reach it through `OpenAIProvider` / `AnthropicProvider`, and
 *   the CLI through `--provider openai --api-url`.
 * - **ollama** — the alternative, used when `OLLAMA_HOST` is set or when no llama-server
 *   answers. Adds its own native API, which llama-server has no equivalent of.
 *
 * Resolution order: `LLAMA_SERVER_URL` (explicit) → `OLLAMA_HOST` (explicit) → a
 * llama-server on the default port → ollama. So an unconfigured machine running either
 * one is picked up without setup.
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

/**
 * llama-server's default port. `127.0.0.1` rather than `localhost`: anything holding
 * `*:8080` wins the IPv6 lookup ahead of a server bound to the loopback address, and the
 * suites would then probe the wrong process and skip.
 */
const DEFAULT_LLAMA_SERVER_URL = 'http://127.0.0.1:8080'

const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434'

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

/**
 * Model to request from an OpenAI-compatible `/v1/models` endpoint. `llama-server` loads a
 * single model, but `llama serve` routes to many, so prefer the LFM2.5 the suites' timings
 * and assertions were written against and fall back to whatever is listed first.
 */
async function selectModelID(openaiBaseURL: string): Promise<string | null> {
  const body = (await fetchJSON(`${openaiBaseURL}/models`)) as {
    data?: Array<{ id?: unknown }>
  } | null
  const ids = (body?.data ?? [])
    .map((model) => model?.id)
    .filter((id): id is string => typeof id === 'string' && id !== '')
  return ids.find((id) => /lfm-?2\.?5/i.test(id)) ?? ids[0] ?? null
}

async function resolveLlamaServer(url: string): Promise<ChatBackend> {
  const baseURL = normalizeURL(url)
  const openaiBaseURL = `${baseURL}/v1`
  // Prefer an id the server actually advertises over the hardcoded default, since that is
  // what it was started with.
  const model = await selectModelID(openaiBaseURL)
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

async function resolveOllama(url: string): Promise<ChatBackend> {
  const baseURL = normalizeURL(url)
  return {
    kind: 'ollama',
    available: await reachable(baseURL),
    baseURL,
    openaiBaseURL: `${baseURL}/v1`,
    model: OLLAMA_MODEL,
    cliProvider: 'ollama',
  }
}

async function resolveBackend(): Promise<ChatBackend> {
  // An explicitly configured backend is used as-is, reachable or not: silently falling
  // through to the other one would hide a typo or a server that failed to start.
  const llamaServer = process.env.LLAMA_SERVER_URL
  if (llamaServer != null && llamaServer !== '') {
    return await resolveLlamaServer(llamaServer)
  }
  const ollamaHost = process.env.OLLAMA_HOST
  if (ollamaHost != null && ollamaHost !== '') {
    return await resolveOllama(ollamaHost)
  }

  // Unconfigured: prefer a llama-server on the default port, fall back to ollama.
  const llamaDefault = await resolveLlamaServer(DEFAULT_LLAMA_SERVER_URL)
  return llamaDefault.available ? llamaDefault : await resolveOllama(DEFAULT_OLLAMA_HOST)
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

/**
 * Prompt for the suites asserting a tool call. It names the tool outright: they exercise
 * the tool-call plumbing, not the model's judgement, and a 1.2B model asked merely to
 * "summarise a URL" answers from memory often enough to make them flaky.
 */
export const TOOL_CALL_PROMPT =
  'Use the fetch:get_markdown tool to fetch https://mokei.dev, then summarise it in one sentence.'

/**
 * Retries for the assertions that depend on the model *choosing* to call the tool. Even
 * with an explicit prompt a small local model occasionally answers directly; retrying is
 * honest about that, where loosening the assertion would stop testing the tool path.
 * Applied per-suite rather than in the vitest config so a deterministic suite elsewhere
 * cannot quietly become flaky.
 */
export const TOOL_CALL_RETRY = 2
