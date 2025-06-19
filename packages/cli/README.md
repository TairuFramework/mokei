# Mokei CLI

<!-- toc -->
* [Mokei CLI](#mokei-cli)
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g mokei
$ mokei COMMAND
running command...
$ mokei (--version)
mokei/0.3.2 darwin-arm64 node-v24.2.0
$ mokei --help [COMMAND]
USAGE
  $ mokei COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`mokei chat ollama`](#mokei-chat-ollama)
* [`mokei chat openai`](#mokei-chat-openai)
* [`mokei context inspect COMMAND`](#mokei-context-inspect-command)
* [`mokei context monitor`](#mokei-context-monitor)
* [`mokei context proxy COMMAND`](#mokei-context-proxy-command)
* [`mokei help [COMMAND]`](#mokei-help-command)

## `mokei chat ollama`

Interactive chat with a local model

```
USAGE
  $ mokei chat ollama [-p <value>] [-m <value>]

FLAGS
  -m, --model=<value>    Name of the model to use
  -p, --api-url=<value>  Provider API URL

DESCRIPTION
  Interactive chat with a local model
```

## `mokei chat openai`

Interactive chat with a model provider using OpenAI APIs

```
USAGE
  $ mokei chat openai [-k <value>] [-p <value>] [-m <value>]

FLAGS
  -k, --api-key=<value>  OpenAI API key
  -m, --model=<value>    Name of the model to use
  -p, --api-url=<value>  Provider API URL

DESCRIPTION
  Interactive chat with a model provider using OpenAI APIs
```

## `mokei context inspect COMMAND`

Inspect a context server

```
USAGE
  $ mokei context inspect COMMAND...

ARGUMENTS
  COMMAND...  Command to run the MCP server

DESCRIPTION
  Inspect a context server
```

## `mokei context monitor`

Start a context host monitor

```
USAGE
  $ mokei context monitor [-s <value>] [-p <value>]

FLAGS
  -p, --port=<value>  Port to use for the monitor UI server
  -s, --path=<value>  [default: /Users/paul/.mokei-daemon.sock] Socket path

DESCRIPTION
  Start a context host monitor
```

## `mokei context proxy COMMAND`

Proxy a context server on a host

```
USAGE
  $ mokei context proxy COMMAND... [-s <value>]

ARGUMENTS
  COMMAND...  Command to run the MCP server

FLAGS
  -s, --path=<value>  [default: /Users/paul/.mokei-daemon.sock] Socket path

DESCRIPTION
  Proxy a context server on a host
```

## `mokei help [COMMAND]`

Display help for mokei.

```
USAGE
  $ mokei help [COMMAND...] [-n]

ARGUMENTS
  COMMAND...  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for mokei.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.2.29/src/commands/help.ts)_
<!-- commandsstop -->
