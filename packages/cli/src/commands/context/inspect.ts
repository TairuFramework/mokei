import { type HostedContext, spawnHostedContext } from '@mokei/host'
import { Args, Command } from '@oclif/core'

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
    const { args, argv } = await this.parse(ContextInspect)

    console.log('Initializing...')
    let hosted: HostedContext | undefined
    try {
      hosted = await spawnHostedContext({
        command: args.command,
        args: argv.slice(1) as Array<string>,
      })
      const initialized = await hosted.client.initialize()
      console.log('Initialized')
      this.logJson(initialized)
    } catch (err) {
      console.error((err as Error).message)
    } finally {
      await hosted?.disposer.dispose()
    }
  }
}
