import { buildProgram as tejikaBuildProgram } from '@tejika/cli'
import type { Command } from 'commander'

import { createChatCommand } from './commands/chat.js'
import { createDaemonCommand } from './commands/daemon.js'
import { createFlowsCommand } from './commands/flows.js'
import { createInboxCommand } from './commands/inbox.js'
import { createInspectCommand } from './commands/inspect.js'
import { createMonitorCommand } from './commands/monitor.js'
import { createProxyCommand } from './commands/proxy.js'
import { createRunsCommand } from './commands/runs.js'
import { pkg } from './package-info.js'

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
      createDaemonCommand(),
      createFlowsCommand(),
      createRunsCommand(),
      createInboxCommand(),
    ],
  })
  program.description(pkg.description)
  return program
}
