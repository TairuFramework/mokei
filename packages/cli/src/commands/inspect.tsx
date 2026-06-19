import { StatusMessage } from '@inkjs/ui'
import { type HostedContext, spawnHostedContext } from '@mokei/host'
import { Command } from 'commander'
import { Box, Text } from 'ink'

import { renderStatic } from '../ink.js'

function InspectResult({ data }: { data: string }) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="green">initialized</Text>
      <Text>{data}</Text>
    </Box>
  )
}

function InspectError({ message }: { message: string }) {
  return <StatusMessage variant="error">{message}</StatusMessage>
}

export function createInspectCommand(): Command {
  const cmd = new Command('inspect')
    .description('Inspect an MCP context server')
    .argument('<command>', 'command to run the MCP server')
    .argument('[args...]', 'arguments for the server command')
    .passThroughOptions()

  cmd.action(async (command: string, args: Array<string>) => {
    let hosted: HostedContext | undefined
    try {
      // inspect is the debugging tool: surface the server's own stderr diagnostics
      // instead of swallowing them behind "did not respond to initialize".
      hosted = await spawnHostedContext({ command, args, stderr: 'inherit' })
      const initialized = await hosted.client.initialize()
      renderStatic(InspectResult, { data: JSON.stringify(initialized, null, 2) })
    } catch (err) {
      renderStatic(InspectError, { message: (err as Error).message })
      process.exitCode = 1
    } finally {
      await hosted?.disposer.dispose()
    }
  })

  return cmd
}
