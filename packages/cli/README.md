# Mokei CLI

## Usage

```sh-session
$ pnpm install -g mokei
$ mokei COMMAND
$ mokei --help
$ mokei --version
```

## Commands

### `mokei chat`

Interactive chat with a model provider.

```
Usage: mokei chat [options]

Options:
  -p, --provider <name>    model provider (ollama, openai, anthropic)
  -k, --api-key <key>      provider API key
  -u, --api-url <url>      provider API URL
  -m, --model <name>       name of the model to use
  -t, --timeout <seconds>  agent turn timeout in seconds (default: "300")
  -h, --help               display help for command
```

If `--provider` is omitted, an interactive provider selection prompt appears.

### `mokei inspect`

Inspect an MCP context server: prints its `server/discover` result on `2026-07-28`, or its
`initialize` result on `2025-11-25`.

```
Usage: mokei inspect [options] <command> [args...]

Arguments:
  command                   command to run the MCP server
  args                      arguments for the server command

Options:
  -p, --protocol <version>  protocol revision to speak: 2026-07-28, 2025-11-25
                            or auto (default: "auto")
```

The default `auto` probes the server and speaks whichever revision it supports. Pass
`--protocol` before the server command to pin one instead — anything after the command is
forwarded to the server.

### `mokei monitor`

Start a context host monitor.

```
Usage: mokei monitor [options]

Options:
  -s, --socket-path <path>  socket path (default: the mokei daemon socket)
  -p, --port <number>  port for the monitor UI server
```

### `mokei proxy`

Proxy an MCP context server on a host.

```
Usage: mokei proxy [options] <command> [args...]

Arguments:
  command   command to run the MCP server
  args      arguments for the server command

Options:
  -s, --socket-path <path>  socket path (default: the mokei daemon socket)
```

### Flow commands

The `daemon`, `flows`, `runs` and `inbox` commands drive the flow service of the mokei host daemon.
They all accept `-s, --socket-path <path>` (default: the mokei daemon socket, resolved by
`@tejika/env` for the app `mokei`, the same socket the daemon binds) and, except `flows mcp` and
`daemon logs`, `--json` to print one JSON document. `runs`, `inbox` and `flows` start the daemon
when it is not running.

### `mokei daemon`

Manage the host daemon.

```
mokei daemon start                 start the daemon and wait for the flow service
mokei daemon stop                  stop the daemon, letting in-flight work drain
mokei daemon status                show whether the daemon is running
mokei daemon restart               stop then start, applying flows.json changes
mokei daemon logs [-n <count>] [-f]  print the daemon log (default 50 lines); -f follows
```

`start`, `stop`, `status` and `restart` accept `--pid-path <path>` to select a custom pid file.
The default comes from `@tejika/env` for the app `mokei`.

`stop` waits up to 75 s for in-flight work to drain, then force-kills the daemon and says so. It
only signals a daemon serving the selected socket. With `--json`, `stop` prints
`{ state, pid?, forced? }` (`forced` when `state` is `stopped`), and `restart` prints the same shape
as its `stop` field next to `start`.

### `mokei flows`

```
mokei flows list                   list the configured flows
mokei flows check <file>           validate a flow definition; exits 1 on issues
mokei flows mcp                    serve the flow control tools as an MCP server over stdio
```

### `mokei runs`

```
mokei runs start [flow] [--file <definition.json>] [--input <json|@file>] [--label <text>] [--wait]
mokei runs get <runID>             status, pending items, result or error
mokei runs list [--state <state...>] [--limit <n>]
mokei runs cancel <runID>
mokei runs trace <runID>           span tree with durations, then the run logs
```

With `--wait`, `start` watches the run until it ends and, in a terminal, answers each pending item
in place. It exits 0 when the run completes and 1 otherwise. Without a terminal, or with `--json`,
it only watches and prints each changed status. Ctrl-C, also inside a prompt, stops the command
and leaves the item pending.

### `mokei inbox`

```
mokei inbox list [--run <runID>]   table of pending items
mokei inbox show <id>              the input request and schema, or the approval's planned tools
mokei inbox answer <id> [--value <json|@file>] [--yes]
mokei inbox decline <id> [--reason <text>]
mokei inbox cancel <id>
mokei inbox prompt <id>            open the desktop dialog and report the chosen action
```

`answer` on an input item prompts from the schema in a terminal; pass `--value` to answer without
one (also needed for schemas the terminal form cannot render). Esc leaves the item pending. On an
approval item, `answer` approves after a confirmation, skipped with `--yes`; answering `n` or
pressing Esc leaves it pending. Denying an approval is the explicit `decline` command, which
denies the run.
