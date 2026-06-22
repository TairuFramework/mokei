import { runDaemon } from '@mokei/host'
import { startMonitor } from '@mokei/host-monitor'
import { Command } from 'commander'
import { Box, Text } from 'ink'

import { runInk } from '../ink.js'
import { withSocketPath } from '../options.js'

function MonitorStatus({ url }: { url: string }) {
  return (
    <Box paddingX={1}>
      <Text color="green">monitor running on {url}</Text>
    </Box>
  )
}

export function createMonitorCommand(): Command {
  const cmd = new Command('monitor').description('Start a context host monitor')

  withSocketPath(cmd)
  cmd.option('-p, --port <number>', 'port for the monitor UI server')

  cmd.action(async (opts: Record<string, string | undefined>) => {
    const socketPath = opts.path
    const port = opts.port != null ? Number.parseInt(opts.port, 10) : undefined
    await runDaemon({ socketPath })
    const monitor = await startMonitor({ port, socketPath })
    const url = `${monitor.url}/`
    // Rely on ink's own Ctrl+C handling (exitOnCtrlC) instead of a manual SIGINT
    // handler: when the user quits, waitUntilExit() resolves and we dispose below.
    // A non-TTY signal (e.g. `kill -INT`) bypasses this — acceptable for an
    // interactive monitor.
    await runInk(MonitorStatus, { url }, { exitOnCtrlC: true })
    await monitor.disposer.dispose()
  })

  return cmd
}
