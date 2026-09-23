# System One Wire Contract and Backend Setup

`@mokei/system-one-client` speaks the TypeSafe System One HTTP API, a typed-question classification contract. Two interchangeable backends serve it: `laya-serve` (the Python HTTP server from [laya](https://github.com/NandhaKishorM/laya), local) and the hosted TypeSafe API. This document describes the wire contract and how to run each backend.

## Backends

- **laya-serve (local)**: `laya-serve` from the `laya[serve]` Python package, running the Laya checkpoints on your machine (CPU, CUDA or Apple Silicon).
- **Hosted TypeSafe**: the TypeSafe AI API at `https://api.typesafe.ai`, using a Bearer token for authentication.

Both backends speak the same protocol, so client code is identical regardless of which you choose.

## API Endpoint

The contract is one endpoint. Request and response bodies are `application/json`.

| Method | Path | Request | Response |
|--------|------|---------|----------|
| POST | `/v1/systemone` | `{ state, model, questions }` | `{ model, answers, usage }` |

`state` is a string, object or array. Each question has a `type` (`choice`, `score` or `noul`) and
`instructions` (a string, or an object or array that carries the question with the data it
references); both are required. `choice` questions take a `criteria` map of options, `score`
questions take a `criteria` list of 2 to 10 ordered levels, and `noul` questions take optional
`criteria`. The client validates this before sending.

The client exposes this endpoint only, as `predict`. There is no batch or model-listing endpoint:
classify several states with one `predict` call each.

### Errors

| Status | Client error |
|--------|--------------|
| `401`, `403` | `SystemOneAuthError` |
| `404` | `SystemOneModelError` |
| other (`422` validation, `429` rate limit, `529` overloaded, `5xx`) | `SystemOneConnectionError` |

When the error body carries a reason (a FastAPI `detail`, a `message`, an `error` string or
`{ message }`, or plain text), the client appends it to the message, for example
`System One backend returned 422: question 'dept': no 'instructions'; add the text the model should answer`.

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

Laya also returns `action: { "act_probability": 0.81 }` on every answer, and `confidence` on
noul answers. The client accepts both as optional fields. `laya-serve` adds a top-level `routing`
object (the checkpoint it picked and why), which the client keeps in `result.extras`.

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

## Local Setup (laya-serve)

Install `laya[serve]` into a Python environment (Python 3.12 works on macOS and Linux) and start the
server:

```bash
uv venv --python 3.12
uv pip install "laya[serve]"
LAYA_HOST=127.0.0.1 LAYA_MODELS=english .venv/bin/laya-serve
```

The server listens on `http://127.0.0.1:8000`. The first start downloads the checkpoints from
Hugging Face. `LAYA_DEVICE` is picked automatically (CUDA, then Apple Silicon MPS, then CPU); on
an M-series Mac a warm request takes about 50 ms.

| Variable | Meaning | Default |
|----------|---------|---------|
| `LAYA_HOST` / `LAYA_PORT` | Bind address and port | `0.0.0.0` / `8000` |
| `LAYA_MODELS` | Comma list of checkpoints to preload (`english`, `multilingual`, `typed-decisions`) | all |
| `LAYA_PRELOAD` | Load the checkpoints at startup rather than on first use | `1` |
| `LAYA_DEVICE` | Torch device (`cuda`, `mps`, `cpu`) | auto |
| `LAYA_THREADS` | Cap torch threads for CPU inference; keep at or below physical cores | torch default |
| `LAYA_API_KEY` | Require `Authorization: Bearer <key>` | none |

The request `model` is honoured when it names a checkpoint (`english`, `multilingual`,
`typed-decisions`); any other value lets `laya-serve` pick the checkpoint from the text's script
and language.

## Client Usage

### Against the Local Backend

```ts
import { createSystemOneClient } from '@mokei/system-one-client'

// Local laya-serve
const local = createSystemOneClient({
  url: 'http://localhost:8000',
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
  defaultModel: 'jev-latest',
})

const result = await hosted.predict({
  state: 'I was double charged on my last invoice',
  model: 'jev-latest',
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
| `SYSTEM_ONE_MODEL` | Default model name | `english` (laya-serve) or `jev-latest` (hosted) |

Example startup:

```bash
export SYSTEM_ONE_URL="https://api.typesafe.ai"
export SYSTEM_ONE_API_KEY="sk-your-key-here"
export SYSTEM_ONE_MODEL="jev-latest"
node mcp-servers/system-one/lib/serve.js
```

## Future: In-Process Backend

A future version may bind a Laya runtime directly (N-API or WebAssembly) behind the same
`SystemOneBackend` interface, removing the separate process. See
`docs/agents/plans/backlog/2026-09-22-laya-in-process-ggml-backend.md`.
