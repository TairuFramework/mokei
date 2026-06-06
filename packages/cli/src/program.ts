import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Command } from 'commander'

import { createChatCommand } from './commands/chat.js'
import { createInspectCommand } from './commands/inspect.js'
import { createMonitorCommand } from './commands/monitor.js'
import { createProxyCommand } from './commands/proxy.js'

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string; description: string }

export function buildProgram(): Command {
  const program = new Command()
    .name('mokei')
    .description(pkg.description)
    .version(pkg.version, '-v, --version')
    .enablePositionalOptions()
    // On a usage error (missing argument, unknown option, ...) print the full
    // help after the error message instead of a bare one-liner. Propagates to
    // subcommands.
    .showHelpAfterError()

  program.addCommand(createChatCommand())
  program.addCommand(createInspectCommand())
  program.addCommand(createMonitorCommand())
  program.addCommand(createProxyCommand())

  // `addCommand` (unlike `.command()`) does not copy this inherited setting, so
  // propagate the error-help behaviour to each subcommand explicitly.
  for (const command of program.commands) {
    command.showHelpAfterError()
  }

  return program
}
