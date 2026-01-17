# Mokei Documentation

> TypeScript toolkit for creating, interacting with, and monitoring clients and servers using the Model Context Protocol (MCP).

## Overview

Mokei provides a comprehensive framework for building MCP-based applications with AI model integration. It includes libraries for creating MCP servers and clients, a host system for managing multiple server connections, session management for chat with tool calling, and model provider integrations.

**Website**: https://mokei.dev
**Repository**: https://github.com/TairuFramework/mokei

## Packages

| Package | Description |
|---------|-------------|
| `@mokei/context-protocol` | MCP protocol constants, schemas and TypeScript types |
| `@mokei/context-rpc` | JSON-RPC implementation for MCP |
| `@mokei/context-server` | MCP server implementation |
| `@mokei/context-client` | MCP client implementation |
| `@mokei/host` | Host system for managing multiple MCP server connections |
| `@mokei/session` | High-level session management combining hosts with model providers |
| `@mokei/model-provider` | Model provider interface definitions |
| `@mokei/openai-provider` | OpenAI model provider integration |
| `@mokei/anthropic-provider` | Anthropic Claude model provider integration |
| `@mokei/ollama-provider` | Ollama model provider integration |
| `mokei` | CLI for interacting with MCP servers and AI models |

## Guides

Start here to learn Mokei:

- [Quick Start](guides/quick-start.md) - Get up and running in minutes
- [Creating MCP Servers](guides/server.md) - Build servers with tools, prompts, and resources
- [Creating MCP Clients](guides/client.md) - Connect to MCP servers
- [Managing Connections](guides/host.md) - Orchestrate multiple MCP servers
- [Chat Sessions](guides/session.md) - High-level chat with tool calling
- [Agent Sessions](guides/agent.md) - Automatic agent loops with tool execution
- [Model Providers](guides/providers.md) - OpenAI, Anthropic, and Ollama integration
- [CLI Reference](guides/cli.md) - Command-line interface usage

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AgentSession                             │
│  (Automatic agent loop with tool execution)                  │
├─────────────────────────────────────────────────────────────┤
│                        Session                               │
│  (High-level abstraction for chat + MCP)                    │
├─────────────────────────────────────────────────────────────┤
│                     ContextHost                              │
│  (Manages multiple MCP server connections)                   │
├─────────────────────────────────────────────────────────────┤
│   ContextClient          │          Model Providers          │
│   (MCP client)           │   (OpenAI, Anthropic, Ollama)    │
├──────────────────────────┼──────────────────────────────────┤
│   ContextServer          │                                   │
│   (MCP server)           │                                   │
└─────────────────────────────────────────────────────────────┘
```

## Communication Flow

1. Host spawns MCP server processes via stdio streams (or connects via HTTP)
2. Client initializes connection and discovers tools/prompts
3. Tools are namespaced as `contextKey:toolName` (or `local:toolName` for local tools)
4. Session routes tool calls to appropriate MCP servers
5. Results are aggregated and returned to model providers

## Project Planning

- [Roadmap](plans/roadmap.md) - Project vision, completed work, and planned features
