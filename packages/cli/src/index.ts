import { buildProgram } from './program.js'

export { buildProgram }

export async function run(argv: Array<string>): Promise<void> {
  const program = buildProgram()
  await program.parseAsync(argv)
}
