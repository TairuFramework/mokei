# Mokei CLI

Package: `mokei`

## Installation

```bash
npm install -g mokei
```

## Commands Overview

| Command | Description |
|---------|-------------|
| `mokei chat ollama` | Interactive chat with local Ollama models |
| `mokei chat openai` | Interactive chat with OpenAI API |
| `mokei context inspect` | Inspect/test an MCP server |
| `mokei context monitor` | Start the monitor UI |
| `mokei context proxy` | Proxy an MCP server for monitoring |

## Chat Commands

### `mokei chat ollama`

Interactive chat with a local model using [Ollama](https://ollama.com/).

```bash
mokei chat ollama [--model <model>] [--api-url <url>]
```

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--model` | `-m` | Model name (e.g., `llama3.1:8b`). Prompted if not provided. |
| `--api-url` | `-p` | Ollama API URL (default: `http://localhost:11434/api`) |

**Example:**

```bash
# Start chat with default settings
mokei chat ollama

# Start chat with specific model
mokei chat ollama --model mistral:7b

# Use custom Ollama server
mokei chat ollama --api-url http://192.168.1.100:11434/api
```

### `mokei chat openai`

Interactive chat with OpenAI-compatible APIs.

```bash
mokei chat openai [--api-key <key>] [--model <model>] [--api-url <url>]
```

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--api-key` | `-k` | OpenAI API key. Can also use `OPENAI_API_KEY` env var. |
| `--model` | `-m` | Model name (e.g., `gpt-4`). Prompted if not provided. |
| `--api-url` | `-p` | API URL (default: `https://api.openai.com/v1`) |

**Example:**

```bash
# Start chat (uses OPENAI_API_KEY env var)
mokei chat openai

# Start chat with specific model and key
mokei chat openai --api-key sk-... --model gpt-4

# Use OpenAI-compatible API (e.g., Azure, local server)
mokei chat openai --api-url https://my-api.example.com/v1
```

### Chat Session Workflow

When using chat commands, you'll see an interactive prompt:

```
? Select an action …
❯ End the session
  Send a message
  Add a context
  Remove a context
  Select tools to enable
```

**Adding MCP Servers:**

1. Select "Add a context"
2. Provide a unique key (e.g., `sqlite`)
3. Enter the command to run the MCP server (e.g., `npx`)
4. Enter arguments (comma-separated, e.g., `-y,@mokei/mcp-sqlite`)
5. Select which tools to enable

**Sending Messages:**

1. Select "Send a message"
2. Choose a model (if not specified via flag)
3. Type your message
4. When the model requests tool calls, approve or deny them

## Context Commands

### `mokei context inspect`

Spawns an MCP server and runs the initialization handshake to verify it works.

```bash
mokei context inspect <command> -- <args...>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<command>` | Command to start the MCP server |
| `<args...>` | Arguments passed to the command (after `--`) |

**Example:**

```bash
# Inspect a local server
mokei context inspect node -- server.js

# Inspect an npm package
mokei context inspect npx -- -y @modelcontextprotocol/server-filesystem ./

# Inspect with arguments
mokei context inspect npx -- -y @mokei/mcp-sqlite --db ./data.db
```

**Output:**

```
✔ Initialized
{
  "capabilities": {},
  "protocolVersion": "2024-11-05",
  "serverInfo": {
    "name": "sqlite",
    "version": "0.1.0"
  }
}
```

### `mokei context monitor`

Starts a local HTTP server serving the Monitor UI for tracking MCP interactions.

```bash
mokei context monitor [--port <port>] [--path <socket-path>]
```

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--port` | `-p` | Port for the HTTP server (auto-assigned if not specified) |
| `--path` | `-s` | Socket path for daemon communication |

**Example:**

```bash
# Start monitor with auto-assigned port
mokei context monitor

# Start monitor on specific port
mokei context monitor --port 8000

# Then open in browser
open http://localhost:8000
```

The monitor UI displays:
- All MCP server connections
- Request/response pairs
- Tool calls and results
- Notifications
- Errors

### `mokei context proxy`

Proxies an MCP server through the Mokei daemon, enabling monitoring.

```bash
mokei context proxy <command> -- <args...> [--path <socket-path>]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<command>` | Command to start the MCP server |
| `<args...>` | Arguments passed to the command (after `--`) |

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--path` | `-s` | Socket path for daemon communication |

**Example:**

```bash
# Proxy an MCP server
mokei context proxy npx -- -y @mokei/mcp-sqlite

# Use in Claude Desktop config
# claude_desktop_config.json:
{
  "mcpServers": {
    "sqlite": {
      "command": "mokei",
      "args": ["context", "proxy", "npx", "--", "-y", "@mokei/mcp-sqlite"]
    }
  }
}
```

## Using with Claude Desktop

To monitor MCP servers used by Claude Desktop:

1. Start the monitor:
   ```bash
   mokei context monitor --port 8000
   ```

2. Configure Claude Desktop to use proxied servers in `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "sqlite": {
         "command": "mokei",
         "args": ["context", "proxy", "npx", "--", "-y", "@mokei/mcp-sqlite"]
       },
       "filesystem": {
         "command": "mokei",
         "args": [
           "context", "proxy", "npx", "--",
           "-y", "@modelcontextprotocol/server-filesystem", "./"
         ]
       }
     }
   }
   ```

3. Restart Claude Desktop

4. Open `http://localhost:8000` to view interactions

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key (used by `chat openai`) |

## Troubleshooting

### MCP Server Fails to Initialize

```bash
# Test the server directly
mokei context inspect <command> -- <args>

# Check if the command works standalone
<command> <args>
```

### Monitor Not Showing Events

1. Ensure the monitor is running before starting proxied servers
2. Verify the server is using the proxy command, not direct
3. Check the socket path matches between monitor and proxy

### Chat Session Hangs

1. Check if the model supports tool calling (Ollama: use a model tagged with "tools")
2. Verify API key is valid (OpenAI)
3. Check network connectivity to the API endpoint
