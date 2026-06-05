/**
 * Drives the real `mokei chat ollama` binary over a PTY (node-pty) so the CLI
 * TUI can be exercised end-to-end in integration tests. ink needs a real TTY on
 * stdin (setRawMode), which a plain child_process pipe cannot provide.
 *
 * Requires the cli `dist` to be built (the dev binary loads commands from
 * dist/commands) plus a running ollama and the built fetch MCP server.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type IPty, spawn } from 'node-pty'

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
  contextAdded: 'context fetch added',
  thinking: 'thinking…',
  approval: 'approve tool call',
  idle: '· idle',
  aborted: 'AbortError',
  assistant: '●',
} as const

// Strips ANSI/OSC escape sequences. Matching the ESC/BEL control characters is
// the whole point, so the control-char lint is intentionally disabled.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI sequences requires matching ESC/BEL
const ANSI = /\[[0-9;?]*[a-zA-Z]|[()][AB0]|[=>]|\][\s\S]*?/g
const ESC = String.fromCharCode(27) // Escape key
const ETX = String.fromCharCode(3) // ^C

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type ChatDriverOptions = {
  model?: string
  cols?: number
  rows?: number
}

export class ChatDriver {
  #pty: IPty
  #buf = ''

  constructor({ model = 'lfm2.5:latest', cols = 100, rows = 30 }: ChatDriverOptions = {}) {
    this.#pty = spawn('node', [CLI_BINARY, 'chat', 'ollama', '--model', model], {
      name: 'xterm-color',
      cols,
      rows,
      cwd: CLI_CWD,
      env: process.env as Record<string, string>,
    })
    this.#pty.onData((d) => {
      this.#buf += d
    })
  }

  /** ANSI-stripped view of everything rendered so far. */
  screen(): string {
    return this.#buf.replace(ANSI, '').replace(/\r/g, '')
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

  async addFetchContext(timeoutMs = 15_000): Promise<boolean> {
    await this.type(`/context add fetch node ${FETCH_SERVER}`)
    await delay(300)
    this.write('\r')
    return this.waitFor(UI.contextAdded, timeoutMs)
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
