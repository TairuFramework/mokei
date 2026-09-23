# System One Wire Contract and Backend Setup

`@mokei/system-one-client` speaks the TypeSafe System One HTTP API, a typed-question classification contract. Two interchangeable backends serve it today: `laya.cpp` (the `laya serve` binary from ggmlc, local) and the hosted TypeSafe API. This document describes the wire contract and how to run each backend.

## Backends

The System One client connects to one of two backends:

- **laya.cpp (local)**: the `laya serve` binary from [ggmlc](https://github.com/monatis/ggmlc) releases, running a Laya GGUF model on your machine.
- **Hosted TypeSafe**: the TypeSafe AI API at `https://api.typesafe.ai`, using a Bearer token for authentication.

Both backends speak the same protocol, so client code is identical regardless of which you choose.

## API Endpoints

All endpoints use `application/json` for request and response bodies. The server returns HTTP status `401` or `403` for authentication failures and `404` when a model or endpoint is not found.

| Method | Path | Request | Response |
|--------|------|---------|----------|
| POST | `/v1/systemone` | `{ state, model, questions }` | `{ model, answers, usage }` |
| GET | `/v1/models` | (empty) | `{ models: [{ name, description, release_date }] }` |
| POST | `/v1/decide/batch` | `{ states: [...], model, questions }` | `{ results: [{ model, answers, usage }] }` |

The `/v1/decide/batch` endpoint is a `laya.cpp` extension, available on the local backend only. The HTTP backend only calls it when created with `batch: true`; otherwise `predictBatch` issues individual `/v1/systemone` requests, at most `concurrency` at a time (default 4), and aborts the rest on the first failure.

## Answer Shapes

The `answers` object in responses contains one entry per question, keyed by the same names as the `questions` map. Each answer includes a `type` field identifying the primitive.

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

The `legend` object is defined by the server and describes the score scale -- the example shows a typical scale definition, but servers may use different properties.

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

## Local Setup (laya.cpp)

To run the local backend, you need a Laya GGUF model file and the `laya serve` binary.

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
import { createSystemOneClient } from '@mokei/system-one-client'

// Local laya serve
const local = createSystemOneClient({
  url: 'http://localhost:8000',
  batch: true,
  defaultModel: 'english',
})

const result = await local.predict({
  state: 'I was double charged on my last invoice',
  model: 'english',
  questions: {
    department: {
      type: 'choice',
      instructions: 'Which department should handle this?',
      criteria: { billing: 'invoices and payments', technical: 'bugs and outages' },
    },
  },
})

// Access the answer via the keyed object:
// result.answers.department.choice, .confidence, .probabilities
```

### Against the Hosted Backend

```ts
import { createSystemOneClient } from '@mokei/system-one-client'

// Hosted TypeSafe
const hosted = createSystemOneClient({
  url: 'https://api.typesafe.ai',
  apiKey: process.env.TYPESAFE_API_KEY,
  defaultModel: 'english',
})

const result = await hosted.predict({
  state: 'I was double charged on my last invoice',
  model: 'english',
  questions: {
    department: {
      type: 'choice',
      instructions: 'Which department should handle this?',
      criteria: { billing: 'invoices and payments', technical: 'bugs and outages' },
    },
  },
})

// Access the answer via the keyed object:
// result.answers.department.choice, .confidence, .probabilities
```

## MCP Server Environment Variables

When running the System One MCP server, configure the backend connection via environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `SYSTEM_ONE_URL` | Backend URL (defaults to `http://localhost:8000`) | `http://localhost:8000` or `https://api.typesafe.ai` |
| `SYSTEM_ONE_API_KEY` | Bearer token for hosted backend (optional) | `sk-...` |
| `SYSTEM_ONE_MODEL` | Default model name | `english` |

Example startup:

```bash
export SYSTEM_ONE_URL="https://api.typesafe.ai"
export SYSTEM_ONE_API_KEY="sk-your-key-here"
export SYSTEM_ONE_MODEL="english"
node mcp-servers/system-one/lib/serve.js
```

## Future: In-Process Backend

A future version will support an in-process backend that binds ggml or `laya.cpp` (native or WebAssembly) behind the same `SystemOneBackend` interface. This will remove the sidecar requirement and eliminate the network round-trip. The ONNX path via external binaries is superseded by this direction.
