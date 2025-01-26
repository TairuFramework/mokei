import { type HostedContext, createHostedContext } from '@mokei/host'
import { Args, Command } from '@oclif/core'
import ora from 'ora'

export default class ContextInspect extends Command {
  static strict = false
  static description = 'Inspect a context server'

  static args = {
    command: Args.string({
      description: 'Command to run the MCP server',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const loader = ora().start('Initializing...')
    const { args, argv } = await this.parse(ContextInspect)

    let hosted: HostedContext | undefined
    try {
      hosted = await createHostedContext(args.command, argv.slice(1) as Array<string>)
      const initialized = await hosted.client.initialize()
      loader.succeed('Initialized')
      this.logJson(initialized)
    } catch (err) {
      loader.fail((err as Error).message)
    } finally {
      await hosted?.transport.dispose()
    }
  }
}
