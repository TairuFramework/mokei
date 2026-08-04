# Mokei

TypeScript toolkit for creating, interacting with, and monitoring clients and servers using the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).

## Features

- **MCP Server & Client** - Full protocol implementation
- **Protocol Revisions** - Serves and speaks both `2025-11-25` and `2026-07-28`, selected per context or negotiated automatically
- **Multi-Context Host** - Manage multiple MCP servers with tool namespacing
- **Session Management** - High-level chat abstraction with tool calling
- **Agent Loop** - Automatic tool execution with configurable approval
- **Model Providers** - OpenAI, Anthropic, Ollama, and local GGUF (llama.cpp) integration
- **Monitoring** - Real-time observation of MCP traffic
- **CLI** - Interactive chat and server inspection tools

## Quick Start

```bash
pnpm add @mokei/session @mokei/openai-provider
```

```typescript
import { Session } from '@mokei/session'
import { OpenAIProvider } from '@mokei/openai-provider'

const session = new Session({
  providers: {
    openai: OpenAIProvider.fromConfig({
      apiKey: process.env.OPENAI_API_KEY
    })
  }
})

// Add an MCP server
await session.addContext({
  key: 'myserver',
  command: 'node',
  args: ['my-mcp-server.js']
})

// Chat with tool access
const response = await session.chat({
  provider: 'openai',
  model: 'gpt-4',
  messages: [{ source: 'client', role: 'user', text: 'Hello!' }]
})
```

## Documentation

- **[Full Documentation](https://mokei.dev)** - Complete guides and API reference
- **[Quick Start Guide](docs/guides/quick-start.md)** - Get running in minutes
- **[docs/](docs/index.md)** - Local documentation

## Packages

| Package | Description |
|---------|-------------|
| `@mokei/context-server` | MCP server implementation |
| `@mokei/context-client` | MCP client implementation |
| `@mokei/host` | Multi-context orchestrator |
| `@mokei/session` | High-level session management |
| `@mokei/openai-provider` | OpenAI integration |
| `@mokei/anthropic-provider` | Anthropic Claude integration |
| `@mokei/ollama-provider` | Ollama integration |
| `@mokei/llama-provider` | Local GGUF inference via node-llama-cpp |
| `@mokei/http-client` | MCP Streamable HTTP client transport |
| `@mokei/http-server` | MCP Streamable HTTP server transport |
| `mokei` | CLI tool |

## CLI

```bash
mokei monitor            # Start the monitor UI for MCP server traffic
mokei inspect            # Inspect an MCP server (prints how it describes itself)
mokei chat -p openai     # Interactive chat
mokei proxy <command>    # Proxy an MCP server through the daemon
```

## Contributing

See [AGENTS.md](AGENTS.md) for development setup and code style guidelines.

## License

MIT
