# Mokei CLI

Package: `mokei`

## Installation

```bash
npm install -g mokei
```

## Commands Overview

| Command | Description |
|---------|-------------|
| `mokei chat` | Interactive chat with a model provider (ollama, openai, anthropic) |
| `mokei inspect` | Inspect/test an MCP server |
| `mokei monitor` | Start the monitor UI |
| `mokei proxy` | Proxy an MCP server for monitoring |

Run `mokei --help` for the full list and `mokei <command> --help` for per-command flags.

## `mokei chat`

Interactive chat with a model provider. A single command handles all providers via
`--provider`; if omitted, an interactive provider-selection prompt appears.

```bash
mokei chat [--provider <name>] [--api-key <key>] [--api-url <url>] [--model <model>] [--timeout <seconds>]
```

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--provider` | `-p` | Provider: `ollama`, `openai`, `anthropic` or `llama`. Prompted if not provided. |
| `--api-key` | `-k` | API key (openai/anthropic). Falls back to `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`, which is preferred — a key on the command line leaks via `ps` and shell history. |
| `--api-url` | `-u` | Provider API URL (override the default endpoint). |
| `--model` | `-m` | Model name, or a GGUF file path for `llama`. Prompted if not provided. |
| `--timeout` | `-t` | Agent turn timeout in seconds (default: `300`). |

**Examples:**

```bash
# Pick a provider interactively
mokei chat

# Local Ollama model
mokei chat --provider ollama --model llama3.1:8b

# OpenAI (uses OPENAI_API_KEY env var)
mokei chat --provider openai --model gpt-4

# Anthropic with an explicit key
mokei chat --provider anthropic --api-key sk-ant-... --model claude-sonnet-4-6

# Custom/compatible endpoint
mokei chat --provider ollama --api-url http://192.168.1.100:11434/api
```

### Chat session workflow

The chat UI is an interactive terminal app. Type a message and press Enter to send it.
If no model was set via `--model`, you'll be prompted to pick one on first send. When the
model requests a tool call, an approval card appears — press `y` to approve or `n` to deny.

Slash commands (type `/` to see suggestions):

| Command | Description |
|---------|-------------|
| `/context add [--protocol <version>] <key> <command> [args...]` | Add an MCP server context (opens a tool-select card) |
| `/context list` | List active contexts |
| `/context remove <key>` | Remove a context (asks to confirm) |
| `/tools` | Open the tool enable/disable card |
| `/model [name]` | Set the model, or open the model-select card |
| `/reasoning [on\|off\|last]` | Toggle reasoning display, or reprint the last turn's reasoning |
| `/details` | Print the last error's full details |
| `/help` | Show help |
| `/quit`, `/exit` | End the session (also Ctrl+C twice) |

**Adding an MCP server, for example:**

```
/context add sqlite npx -y @mokei/mcp-sqlite
```

This spawns the server, registers its tools, and opens a card to enable/disable them.

`--protocol` (or `-p`) pins the protocol revision, and must come before the context key:

```
/context add --protocol 2025-11-25 sqlite npx -y @mokei/mcp-sqlite
```

Accepted values are `2026-07-28`, `2025-11-25` and `auto`. Unlike `mokei inspect`, the
default here is `2026-07-28` — the host's default, not `auto`. Pass `--protocol auto` to
probe a server whose revision you do not know, or `--protocol 2025-11-25` to pin the older
one; a server that serves neither `2026-07-28` nor the pinned revision fails with
`Unsupported protocol version`.

## `mokei inspect`

Spawns an MCP server and asks it to describe itself, printing what it answers. What is
printed depends on the revision spoken: `2026-07-28` has no handshake, so the server is
asked for its `server/discover` result; `2025-11-25` runs the `initialize` handshake.

```bash
mokei inspect [--protocol <version>] <command> [args...]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<command>` | Command to start the MCP server |
| `[args...]` | Arguments passed to the command (forwarded as-is, including flags) |

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--protocol` | `-p` | Protocol revision: `2026-07-28`, `2025-11-25` or `auto` (default: `auto`) |

`auto` probes the server and speaks whichever revision it serves, so it is what you want
unless you are deliberately testing one revision. `--protocol` must come *before* the
server command — everything after the command is forwarded to the server untouched.

**Examples:**

```bash
# Inspect a local server
mokei inspect node server.js

# Inspect an npm package
mokei inspect npx -y @modelcontextprotocol/server-filesystem ./

# Inspect with flags (passed through to the server command)
mokei inspect npx -y @mokei/mcp-sqlite --db ./data.db

# Pin a revision on a server that serves both
mokei inspect --protocol 2025-11-25 npx -y @mokei/mcp-sqlite
```

**Output on `2026-07-28`** — a `server/discover` result, which is what `auto` prints
against a server serving the current revision:

```
discovered
{
  "ttlMs": 0,
  "cacheScope": "private",
  "capabilities": {
    "logging": {},
    "tools": {
      "listChanged": true
    }
  },
  "supportedVersions": [
    "2026-07-28",
    "2025-11-25"
  ],
  "resultType": "complete",
  "_meta": {
    "io.modelcontextprotocol/serverInfo": {
      "name": "sqlite",
      "version": "0.1.0"
    }
  }
}
```

`supportedVersions` lists every revision the server serves, so one `auto` run tells you
both what it can do and which revisions it will accept.

**Output on `2025-11-25`** — an `initialize` result, printed when the server serves only
that revision or when `--protocol 2025-11-25` is passed:

```
initialized
{
  "capabilities": {
    "logging": {},
    "tools": {
      "listChanged": true
    }
  },
  "protocolVersion": "2025-11-25",
  "serverInfo": {
    "name": "sqlite",
    "version": "0.1.0"
  }
}
```

Pinning a revision the server does not serve fails with `✘ Unsupported protocol version`.

## `mokei monitor`

Starts a local HTTP server serving the Monitor UI for tracking MCP interactions.

```bash
mokei monitor [--port <port>] [--socket-path <path>]
```

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--port` | `-p` | Port for the HTTP server (auto-assigned if not specified) |
| `--socket-path` | `-s` | Socket path for daemon communication |

**Examples:**

```bash
# Start monitor with auto-assigned port
mokei monitor

# Start monitor on a specific port, then open it
mokei monitor --port 8000
open http://localhost:8000
```

The monitor UI displays all MCP server connections, request/response pairs, tool calls
and results, notifications, and errors.

## `mokei proxy`

Proxies an MCP server through the Mokei daemon, enabling monitoring.

```bash
mokei proxy <command> [args...] [--socket-path <path>]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<command>` | Command to start the MCP server |
| `[args...]` | Arguments passed to the command (forwarded as-is) |

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--socket-path` | `-s` | Socket path for daemon communication |

**Example:**

```bash
# Proxy an MCP server
mokei proxy npx -y @mokei/mcp-sqlite
```

## Using with Claude Desktop

To monitor MCP servers used by Claude Desktop:

1. Start the monitor:
   ```bash
   mokei monitor --port 8000
   ```

2. Configure Claude Desktop to use proxied servers in `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "sqlite": {
         "command": "mokei",
         "args": ["proxy", "npx", "-y", "@mokei/mcp-sqlite"]
       },
       "filesystem": {
         "command": "mokei",
         "args": ["proxy", "npx", "-y", "@modelcontextprotocol/server-filesystem", "./"]
       }
     }
   }
   ```

3. Restart Claude Desktop

4. Open `http://localhost:8000` to view interactions

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key (used by `chat --provider openai`) |
| `ANTHROPIC_API_KEY` | Anthropic API key (used by `chat --provider anthropic`) |

## Troubleshooting

### MCP Server Fails to Initialize

```bash
# Test the server directly
mokei inspect <command> [args...]

# Check if the command works standalone
<command> <args>
```

### Monitor Not Showing Events

1. Ensure the monitor is running before starting proxied servers
2. Verify the server is using the proxy command, not direct
3. Check the socket path matches between monitor and proxy

### Chat Session Hangs

1. Check if the model supports tool calling (Ollama: use a model tagged with "tools")
2. Verify the API key is valid (OpenAI/Anthropic)
3. Check network connectivity to the API endpoint
