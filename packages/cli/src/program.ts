import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildProgram as tejikaBuildProgram } from '@tejika/cli'
import type { Command } from 'commander'

import { createChatCommand } from './commands/chat.js'
import { createInspectCommand } from './commands/inspect.js'
import { createMonitorCommand } from './commands/monitor.js'
import { createProxyCommand } from './commands/proxy.js'

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string; description: string }

export function buildProgram(): Command {
  // `@tejika/cli` sets name/version, enables positional options, and propagates
  // showHelpAfterError to each subcommand. It does not set a description, so add
  // Mokei's here.
  const program = tejikaBuildProgram({
    name: 'mokei',
    version: pkg.version,
    commands: [
      createChatCommand(),
      createInspectCommand(),
      createMonitorCommand(),
      createProxyCommand(),
    ],
  })
  program.description(pkg.description)
  return program
}
