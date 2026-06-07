import { buildProgram } from './program.js'

export { buildProgram }

export async function run(argv: Array<string>): Promise<void> {
  const program = buildProgram()
  // With subcommands but no root action, commander prints help to stderr and
  // exits 1 when invoked with no command. Treat the no-arg case as success:
  // print help to stdout and exit 0. (A root action would instead break
  // `mokei help` / `mokei bogus` under enablePositionalOptions.)
  if (argv.slice(2).length === 0) {
    program.outputHelp()
    return
  }
  await program.parseAsync(argv)
}
