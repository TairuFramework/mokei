import { StatusMessage } from '@inkjs/ui'
import type { ContextClient } from '@mokei/context-client'
import { PROTOCOLS, type ProtocolVersion } from '@mokei/context-protocol'
import { type HostedContext, spawnHostedContext } from '@mokei/host'
import { renderStatic } from '@tejika/cli'
import { Command } from 'commander'
import { Box, Text } from 'ink'

import { PROTOCOL_OPTION_DESCRIPTION, parseProtocolOption } from '../options.js'

function InspectResult({ title, data }: { title: string; data: string }) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="green">{title}</Text>
      <Text>{data}</Text>
    </Box>
  )
}

function InspectError({ message }: { message: string }) {
  return <StatusMessage variant="error">{message}</StatusMessage>
}

/**
 * Asks the server to describe itself using whichever call its revision provides: the
 * `initialize` handshake on a revision that requires one, `server/discover` on a revision that
 * replaced it.
 *
 * Under `'auto'` the revision is not known until the client's probe settles, and the probe only
 * runs when a request is made — so `discover()` is tried first and, if it fails, the resolved
 * revision (readable by then, because the failed call ran the probe) decides whether to fall
 * back or to report the failure. The catch is narrowed by that check rather than swallowing
 * every error.
 *
 * Reading `protocolVersion` is itself wrapped only defensively: the getter throws while an
 * `'auto'` probe is unresolved, and treating that as "no fallback" reports the original error,
 * which is the informative one.
 */
async function describeContext(client: ContextClient): Promise<{ title: string; data: unknown }> {
  try {
    return { title: 'discovered', data: await client.discover() }
  } catch (cause) {
    let resolved: ProtocolVersion | undefined
    try {
      resolved = client.protocolVersion
    } catch {
      resolved = undefined
    }
    // Derived from the revision's own definition rather than a version literal, matching how
    // the client and both transports gate: every revision with a handshake answers
    // `initialize`, and one added later inherits the fallback instead of silently losing it.
    if (resolved != null && PROTOCOLS[resolved].requiresHandshake) {
      return { title: 'initialized', data: await client.initialize() }
    }
    throw cause
  }
}

export function createInspectCommand(): Command {
  const cmd = new Command('inspect')
    .description('Inspect an MCP context server')
    .argument('<command>', 'command to run the MCP server')
    .argument('[args...]', 'arguments for the server command')
    .option('-p, --protocol <version>', PROTOCOL_OPTION_DESCRIPTION, 'auto')
    .passThroughOptions()

  cmd.action(async (command: string, args: Array<string>, opts: { protocol: string }) => {
    let hosted: HostedContext | undefined
    try {
      const protocolVersion = parseProtocolOption(opts.protocol)
      // inspect is the debugging tool: surface the server's own stderr diagnostics
      // instead of swallowing them behind a bare connection failure.
      hosted = await spawnHostedContext({ command, args, stderr: 'inherit', protocolVersion })
      const { title, data } = await describeContext(hosted.client)
      renderStatic(<InspectResult title={title} data={JSON.stringify(data, null, 2)} />)
    } catch (err) {
      renderStatic(<InspectError message={(err as Error).message} />)
      process.exitCode = 1
    } finally {
      await hosted?.disposer.dispose()
    }
  })

  return cmd
}
