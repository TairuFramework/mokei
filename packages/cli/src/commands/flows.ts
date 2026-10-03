import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveProcess } from '@mokei/context-server-node'
import { createFlowControlServer } from '@mokei/flow-client'
import { Command } from 'commander'

import { connectFlowControl, withCommandSignal } from '../flow-control.js'
import { withSocketPath } from '../options.js'
import { addJSONOption, fail, parseJSONArg, printJSON } from '../output.js'
import { withControl } from '../with-control.js'

type CommandOptions = { socketPath: string; json?: boolean }

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json')
const CLI_VERSION = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version

async function runList(options: CommandOptions): Promise<void> {
  try {
    const flows = await withControl(options.socketPath, (control) => control.flows.list())
    if (options.json) {
      printJSON(flows)
      return
    }
    for (const flow of flows) {
      process.stdout.write(`${flow.id} v${flow.version} ${flow.name}\n`)
    }
  } catch (error) {
    fail(error)
  }
}

async function runCheck(file: string, options: CommandOptions): Promise<void> {
  try {
    const definition = await parseJSONArg('<file>', `@${file}`)
    const result = await withControl(options.socketPath, (control) =>
      control.flows.check(definition),
    )
    if (options.json) {
      printJSON(result)
    } else {
      process.stdout.write(`${result.formatted}\n`)
    }
    if ('issues' in result) process.exitCode = 1
  } catch (error) {
    fail(error)
  }
}

async function runMCP(options: CommandOptions): Promise<void> {
  let connection: Awaited<ReturnType<typeof connectFlowControl>> | undefined
  try {
    connection = await connectFlowControl({ socketPath: options.socketPath, autoStart: true })
    const server = serveProcess(
      createFlowControlServer(connection.control, { version: CLI_VERSION }),
    )
    // Stdout belongs to the MCP transport. The server does not dispose itself when stdin reaches
    // EOF, so stdin closure, SIGINT and SIGTERM all dispose it explicitly.
    await withCommandSignal(async (signal) => {
      const stop = () => void server.dispose()
      signal.addEventListener('abort', stop, { once: true })
      process.stdin.once('end', stop)
      process.stdin.once('close', stop)
      try {
        await server.disposed
      } finally {
        signal.removeEventListener('abort', stop)
        process.stdin.off('end', stop)
        process.stdin.off('close', stop)
      }
    })
  } catch (error) {
    fail(error)
  } finally {
    await connection?.dispose()
  }
}

export function createFlowsCommand(): Command {
  const flows = new Command('flows').description('Inspect flows and serve the flow MCP server')

  const list = flows.command('list').description('List the configured flows')
  addJSONOption(withSocketPath(list)).action(runList)

  const check = flows
    .command('check')
    .description('Validate a flow definition file')
    .argument('<file>', 'path to a flow definition JSON file')
  addJSONOption(withSocketPath(check)).action(runCheck)

  const mcp = flows
    .command('mcp')
    .description('Serve the flow MCP server over stdio (diagnostics go to stderr)')
  withSocketPath(mcp).action(runMCP)

  return flows
}
