# Laya TypeSafe Wire Contract and Sidecar Setup

`@mokei/laya-client` speaks the TypeSafe System One HTTP API, served by two interchangeable backends. This document describes the wire contract and how to run each backend.

## Backends

The Laya client connects to one of two backends:

- **Local backend**: the `laya serve` binary from [ggmlc](https://github.com/monatis/ggmlc) releases, running on your machine.
- **Hosted backend**: the TypeSafe AI API at `https://api.typesafe.ai`, using a Bearer token for authentication.

Both backends speak the same protocol, so client code is identical regardless of which you choose.

## API Endpoints

All endpoints use `application/json` for request and response bodies. The server returns HTTP status `401` or `403` for authentication failures and `404` when a model or endpoint is not found.

| Method | Path | Request | Response |
|--------|------|---------|----------|
| POST | `/v1/systemone` | `{ state, model, questions }` | `{ model, answers, usage }` |
| GET | `/v1/models` | (empty) | `{ models: [{ name, description, release_date }] }` |
| POST | `/v1/decide/batch` | `{ states: [...], model, questions }` | `{ results: [{ model, answers, usage }] }` |

The `/v1/decide/batch` endpoint is available on the local backend (`laya.cpp`) only.

## Answer Shapes

The `answers` array in responses contains one answer per question. Each answer includes a `type` field identifying the primitive.

### Choice Primitive

```json
{
  "type": "choice",
  "choice": "option_a",
  "confidence": 0.92,
  "probabilities": {
    "option_a": 0.92,
    "option_b": 0.05,
    "option_c": 0.03
  }
}
```

### Score Primitive

```json
{
  "type": "score",
  "score": 7.5,
  "confidence": 0.88,
  "legend": {
    "min": 0,
    "max": 10,
    "step": 0.5
  },
  "probabilities": {
    "0": 0.01,
    "0.5": 0.02,
    "1": 0.03,
    "7.5": 0.88
  }
}
```

### Noul Primitive

```json
{
  "type": "noul",
  "noul": 0.7
}
```

### Usage

All responses include a `usage` object:

```json
{
  "usage": {
    "input_tokens": 150,
    "output_tokens": 42
  }
}
```

## Local Setup

To run the local Laya backend, you need the GGUF model file and the `laya serve` binary.

### Step 1: Compile the GGUF Model

This requires Python and the `uv` package manager:

```bash
# Compile a GGUF once (one-off step)
uv pip install laya
python examples/laya/compile_laya.py --family english --quantize f16
```

This produces `english-f16.gguf`.

### Step 2: Run the Server

Download a `ggmlc` release binary and start the server:

```bash
# Run the server from a ggmlc release binary
laya serve english-f16.gguf --port 8000 --device auto
```

The server listens on `http://localhost:8000` by default. Omit `--port` to use port 8000; set `--device` to `cpu`, `gpu`, or `auto` (recommended).

## Client Usage

### Against the Local Backend

```ts
import { createLayaClient } from '@mokei/laya-client'

// Local laya serve
const local = createLayaClient({
  url: 'http://localhost:8000',
  defaultModel: 'english',
})

const result = await local.predict({
  state: 'User is interested in technology',
  model: 'english',
  questions: [
    { id: 'q1', type: 'choice', text: 'Choose an option:', options: ['A', 'B'] },
  ],
})
```

### Against the Hosted Backend

```ts
import { createLayaClient } from '@mokei/laya-client'

// Hosted TypeSafe
const hosted = createLayaClient({
  url: 'https://api.typesafe.ai',
  apiKey: process.env.TYPESAFE_API_KEY,
  defaultModel: 'english',
})

const result = await hosted.predict({
  state: 'User is interested in technology',
  model: 'english',
  questions: [
    { id: 'q1', type: 'choice', text: 'Choose an option:', options: ['A', 'B'] },
  ],
})
```

## MCP Server Environment Variables

When running the Laya MCP server, configure the backend connection via environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `LAYA_URL` | Backend URL (required) | `http://localhost:8000` or `https://api.typesafe.ai` |
| `LAYA_API_KEY` | Bearer token for hosted backend (optional) | `sk-...` |
| `LAYA_MODEL` | Default model name | `english` |

Example startup:

```bash
export LAYA_URL="https://api.typesafe.ai"
export LAYA_API_KEY="sk-your-key-here"
export LAYA_MODEL="english"
node packages/mcp-laya/dist/server.js
```

## Future: In-Process Backend

A future version will support an in-process backend that binds ggml or `laya.cpp` (native or WebAssembly) behind the same `LayaBackend` interface. This will remove the sidecar requirement and eliminate the network round-trip. The ONNX path via external binaries is superseded by this direction.
