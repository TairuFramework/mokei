import { Args, Command, Flags } from '@oclif/core'
import ora from 'ora'

import { ContextHost } from '../../mcp.js'

export default class MCPInspect extends Command {
  static description = 'Inspect a MCP server'

  static args = {
    command: Args.string({
      description: 'Command to run the MCP server',
      required: true,
    }),
  }

  static flags = {
    arg: Flags.string({
      char: 'a',
      description: 'Arguments to pass to the command',
      multiple: true,
    }),
  }

  async run(): Promise<void> {
    const loader = ora().start('Initializing...')
    const { args, flags } = await this.parse(MCPInspect)

    const host = new ContextHost()
    try {
      const client = await host.spawn('inspect', args.command, flags.arg)
      const initialized = await client.initialize()
      loader.succeed('Initialized')
      this.logJson(initialized)
    } catch (err) {
      loader.fail((err as Error).message)
    } finally {
      await host.dispose()
    }
  }
}
