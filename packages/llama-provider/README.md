# @mokei/llama-provider

Local GGUF model provider for Mokei, powered by [node-llama-cpp](https://node-llama-cpp.withcat.ai/).

Runs `.gguf` models in-process — no external server required — behind the same
`ModelProvider` interface used by the OpenAI, Anthropic, and Ollama providers.

## Installation

`node-llama-cpp` is a peer dependency and must be installed alongside the provider:

```bash
pnpm add @mokei/llama-provider node-llama-cpp
```

## Usage

Register your models up front by name, each pointing at a `.gguf` file on disk:

```typescript
import { LlamaProvider } from '@mokei/llama-provider'

const provider = LlamaProvider.fromConfig({
  models: {
    'llama-3.1-8b': {
      path: '/models/Meta-Llama-3.1-8B-Instruct.Q4_K_M.gguf',  // Required
      contextSize: 8192,  // Optional
      gpu: 'auto',        // Optional: true | false | 'auto'
    },
  },
})

// Stream a chat completion
const request = provider.streamChat({
  model: 'llama-3.1-8b',
  messages: [
    { source: 'client', role: 'user', text: 'Hello!' }
  ],
})

const stream = await request
const reader = stream.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  if (value.type === 'text-delta') {
    process.stdout.write(value.text)
  }
}

// Free loaded models and GPU resources when done
await provider.dispose()
```

Models are loaded lazily on first use.

## Documentation

See the full documentation at [mokei.dev](https://mokei.dev).

## License

MIT
