import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Command } from 'commander'

import { createChatCommand } from './commands/chat.js'

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string; description: string }

export function buildProgram(): Command {
  const program = new Command()
    .name('mokei')
    .description(pkg.description)
    .version(pkg.version, '-v, --version')

  program.addCommand(createChatCommand())

  return program
}
