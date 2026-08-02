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
  -s, --path <path>    socket path (default: ~/.mokei-daemon.sock)
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
  -s, --path <path>  socket path (default: ~/.mokei-daemon.sock)
```
