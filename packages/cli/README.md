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

Inspect an MCP context server.

```
Usage: mokei inspect [options] <command> [args...]

Arguments:
  command   command to run the MCP server
  args      arguments for the server command
```

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
