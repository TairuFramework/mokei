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
| `--provider` | `-p` | Provider: `ollama`, `openai`, or `anthropic`. Prompted if not provided. |
| `--api-key` | `-k` | API key (openai/anthropic). Falls back to `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`. |
| `--api-url` | `-u` | Provider API URL (override the default endpoint). |
| `--model` | `-m` | Model name. Prompted if not provided. |
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
| `/context add <key> <command> [args...]` | Add an MCP server context (opens a tool-select card) |
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

## `mokei inspect`

Spawns an MCP server and runs the initialization handshake to verify it works, printing
the server's capabilities.

```bash
mokei inspect <command> [args...]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<command>` | Command to start the MCP server |
| `[args...]` | Arguments passed to the command (forwarded as-is, including flags) |

**Examples:**

```bash
# Inspect a local server
mokei inspect node server.js

# Inspect an npm package
mokei inspect npx -y @modelcontextprotocol/server-filesystem ./

# Inspect with flags (passed through to the server command)
mokei inspect npx -y @mokei/mcp-sqlite --db ./data.db
```

**Output:**

```
initialized
{
  "capabilities": {},
  "protocolVersion": "2024-11-05",
  "serverInfo": {
    "name": "sqlite",
    "version": "0.1.0"
  }
}
```

## `mokei monitor`

Starts a local HTTP server serving the Monitor UI for tracking MCP interactions.

```bash
mokei monitor [--port <port>] [--path <socket-path>]
```

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--port` | `-p` | Port for the HTTP server (auto-assigned if not specified) |
| `--path` | `-s` | Socket path for daemon communication |

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
mokei proxy <command> [args...] [--path <socket-path>]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<command>` | Command to start the MCP server |
| `[args...]` | Arguments passed to the command (forwarded as-is) |

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--path` | `-s` | Socket path for daemon communication |

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
