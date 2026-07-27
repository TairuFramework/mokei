/**
 * Drives the real `mokei chat` binary over a PTY (node-pty) so the CLI TUI can be
 * exercised end-to-end in integration tests. ink needs a real TTY on stdin (setRawMode),
 * which a plain child_process pipe cannot provide.
 *
 * Requires the cli `dist` to be built (the dev binary loads commands from dist/commands),
 * the built fetch MCP server, and a chat backend — ollama by default, or llama-server via
 * `LLAMA_SERVER_URL`, which the suites gate on with `hasChatBackend`.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type IPty, spawn } from 'node-pty'
import stripAnsi from 'strip-ansi'

import { chatBackend } from './requirements.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const CLI_CWD = resolve(ROOT, 'packages/cli')
export const CLI_BINARY = resolve(CLI_CWD, 'bin/dev.js')
export const FETCH_SERVER = resolve(ROOT, 'mcp-servers/fetch/lib/serve.js')

/**
 * Observable TUI strings the driver waits on / asserts against. Centralised so a
 * CLI render change is a one-line update here rather than scattered through the
 * suites.
 */
export const UI = {
  ready: 'type a message',
  providerSelect: 'select a provider',
  llamaPath: 'enter GGUF model path',
  contextAdded: 'context fetch added',
  thinking: 'thinking…',
  streaming: '· streaming',
  approval: 'approve tool call',
  idle: '· idle',
  aborted: 'AbortError',
  assistant: '●',
  toolSelect: 'enable tools',
  confirm: 'remove context',
  denied: 'tool denied',
  removed: 'removed',
} as const

const ESC = String.fromCharCode(27) // Escape key
const ETX = String.fromCharCode(3) // ^C

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type ChatDriverOptions = {
  provider?: string | null
  model?: string | null
  cols?: number
  rows?: number
}

export type ChatExit = { exitCode: number; signal?: number }

export class ChatDriver {
  #pty: IPty
  #buf = ''
  #exit: ChatExit | null = null

  constructor({ provider, model, cols = 100, rows = 30 }: ChatDriverOptions = {}) {
    // An explicit provider (the llama GGUF suite) opts out of the resolved backend, so its
    // API URL and key are not applied to a provider they do not belong to.
    const usesBackend = provider === undefined
    const resolvedProvider = usesBackend ? chatBackend.cliProvider : provider
    const resolvedModel = model === undefined ? chatBackend.model : model

    const args = [CLI_BINARY, 'chat']
    if (resolvedProvider != null) {
      args.push('--provider', resolvedProvider)
    }
    if (resolvedModel != null) {
      args.push('--model', resolvedModel)
    }
    if (usesBackend && chatBackend.cliAPIURL != null) {
      args.push('--api-url', chatBackend.cliAPIURL)
    }

    const env = { ...process.env } as Record<string, string>
    if (usesBackend && resolvedProvider === 'openai' && env.OPENAI_API_KEY == null) {
      // A local llama-server needs no credential, but the CLI requires the key to be set.
      env.OPENAI_API_KEY = 'llama.cpp'
    }

    this.#pty = spawn('node', args, {
      name: 'xterm-color',
      cols,
      rows,
      cwd: CLI_CWD,
      env,
    })
    this.#pty.onData((d) => {
      this.#buf += d
    })
    this.#pty.onExit((e) => {
      this.#exit = e
    })
  }

  /** Send a single Ctrl+C (^C) without killing the pty, to drive the quit flow. */
  interrupt(): void {
    this.#pty.write(ETX)
  }

  /** Resolve with the process exit info once it exits, or null on timeout. */
  async waitForExit(timeoutMs: number): Promise<ChatExit | null> {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      if (this.#exit != null) return this.#exit
      await delay(100)
    }
    return null
  }

  /** ANSI-stripped view of everything rendered so far. */
  screen(): string {
    return stripAnsi(this.#buf).replace(/\r/g, '')
  }

  write(data: string): void {
    this.#pty.write(data)
  }

  /** Type at human speed; instant writes race React's render and the slash autocomplete. */
  async type(text: string, cps = 50): Promise<void> {
    for (const ch of text) {
      this.#pty.write(ch)
      await delay(1000 / cps)
    }
  }

  esc(): void {
    this.#pty.write(ESC)
  }

  approve(): void {
    this.#pty.write('y')
  }

  deny(): void {
    this.#pty.write('n')
  }

  /** Resolve once `text` appears on screen, or false on timeout. */
  async waitFor(text: string, timeoutMs: number): Promise<boolean> {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      if (this.screen().includes(text)) return true
      await delay(100)
    }
    return false
  }

  /**
   * Whether the *current* status line is idle. The buffer accumulates every
   * frame, so "back to idle" means the latest `idle` marker sits after the
   * latest active-state marker — not merely that `idle` appears anywhere.
   */
  isIdle(): boolean {
    const s = this.screen()
    const idle = s.lastIndexOf(`${UI.idle}`)
    const active = Math.max(
      s.lastIndexOf('· streaming'),
      s.lastIndexOf('· awaiting-approval'),
      s.lastIndexOf('· calling-tool'),
    )
    return idle > active
  }

  /**
   * Wait until a turn is in flight, whichever way it presents. `thinking…` only renders
   * when the backend streams reasoning as a separate channel — ollama does, and so does any
   * OpenAI-compatible server sending `reasoning_content`, but llama.cpp leaves `<think>`
   * tags inline in the content for templates it does not parse, so the turn goes straight
   * to `streaming`. Tests that just need an in-flight turn should wait on this.
   */
  async waitForActive(timeoutMs: number): Promise<boolean> {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      const screen = this.screen()
      if (screen.includes(UI.thinking) || screen.includes(UI.streaming)) return true
      await delay(100)
    }
    return false
  }

  /** Wait until the turn settles back to idle. */
  async waitForIdle(timeoutMs: number): Promise<boolean> {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      if (this.isIdle()) return true
      await delay(150)
    }
    return false
  }

  /** Wait for the prompt, then add the fetch MCP context via the slash command. */
  async start(timeoutMs = 15_000): Promise<boolean> {
    return this.waitFor(UI.ready, timeoutMs)
  }

  /** Wait for the GGUF path card, type the path, and submit it. */
  async enterLlamaPath(path: string, timeoutMs = 15_000): Promise<boolean> {
    if (!(await this.waitFor(UI.llamaPath, timeoutMs))) return false
    await this.type(path)
    await delay(300)
    this.write('\r')
    return true
  }

  async addFetchContext(timeoutMs = 15_000): Promise<boolean> {
    await this.type(`/context add fetch node ${FETCH_SERVER}`)
    await delay(300)
    this.write('\r')
    const added = await this.waitFor(UI.contextAdded, timeoutMs)
    // New flow: a tool-select card opens after add — accept defaults (all enabled).
    if (await this.waitFor(UI.toolSelect, 5_000)) {
      this.write('\r')
    }
    return added
  }

  /** Wait for the tool-approval card. */
  waitForApproval(timeoutMs = 45_000): Promise<boolean> {
    return this.waitFor(UI.approval, timeoutMs)
  }

  /** Wait for the confirm-removal card. */
  waitForConfirm(timeoutMs = 5_000): Promise<boolean> {
    return this.waitFor(UI.confirm, timeoutMs)
  }

  async submit(prompt: string): Promise<void> {
    await this.type(prompt)
    await delay(300)
    this.write('\r')
  }

  kill(): void {
    try {
      this.#pty.write(ETX)
      this.#pty.kill()
    } catch {
      // Already exited.
    }
  }
}
