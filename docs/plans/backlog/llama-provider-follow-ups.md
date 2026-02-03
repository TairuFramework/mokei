# Llama Provider Follow-ups

## Integration testing with real models

Unit tests mock node-llama-cpp. Integration tests with actual GGUF models would validate the `promptWithMeta` return shape, function calling flow, and streaming behavior end-to-end.

## ~~Token counting~~ (done)

`streamChat` now emits actual token counts from `LlamaContextSequence.tokenMeter` via `getState()`/`diff()`.

## ~~Structured output~~ (done)

The `output` parameter in `StreamChatParams` is now wired to `createGrammarForJsonSchema`. Grammar and function calling are mutually exclusive with a clear error message.

## ~~Conversation history in streamChat~~ (done)

`streamChat` now converts the full Mokei message history to node-llama-cpp's `ChatHistoryItem[]` format via `#convertMessages`, including tool result attachment.

## ~~onProgress callback in downloadModel~~ (done)

The `onProgress` callback is now wired through to `createModelDownloader`, adapting from `{totalSize, downloadedSize}` to `{downloaded, total, percent}`.

## ~~configurationSchema barrel export~~ (done)

The barrel now uses `export * from './config.js'`, matching other providers.
