# Llama Provider Follow-ups

## Integration testing with real models

Unit tests mock node-llama-cpp. Integration tests with actual GGUF models would validate the `promptWithMeta` return shape, function calling flow, and streaming behavior end-to-end.

## Token counting

`streamChat` currently emits `inputTokens: 0` and `outputTokens: 0` in the `done` event. node-llama-cpp may expose token counts that could be plumbed through.

## Structured output

The `output` parameter in `StreamChatParams` (JSON schema for structured output) is not yet wired to node-llama-cpp's `LlamaJsonSchemaGrammar`. This would use the `grammar` option in `promptWithMeta`.

## Conversation history in streamChat

Currently `streamChat` only extracts the last user message as the prompt. Full conversation history should be converted to node-llama-cpp's chat history format for multi-turn context.

## onProgress callback in downloadModel

The `onProgress` callback parameter is accepted in the `downloadModel` method signature but is not wired through to the `createModelDownloader` call. Should be connected or documented as not-yet-implemented.

## configurationSchema barrel export

The `configurationSchema` constant is exported from `config.ts` but not re-exported from the package barrel (`index.ts`). Other providers (ollama-provider) export it. Consider adding it for consumers who need the raw schema.
