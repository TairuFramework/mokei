# CLI reasoning coverage — follow-ons

**Status:** backlog
**Origin:** `completed/2026-07-27-integration-test-environment.complete.md` — deliberately
deferred while making the integration suite backend-agnostic.

Low priority. Neither blocks anything; both are coverage gaps rather than defects.

## 1. Assert reasoning separation when the backend supports it

`cli-chat.test.ts > esc cancels a turn in flight` waits on `thinking…` **or** `· streaming`,
because llama.cpp streams `<think>` tags inline in `content` for the LFM2.5 template and the
CLI's thinking state is therefore unreachable there. On ollama, which does stream reasoning
as a separate channel, that is a weaker assertion than the suite used to make.

**Fix:** add a `separatesReasoning` flag to the resolved backend in
`integration-tests/support/requirements.ts` (true for ollama, false for llama-server) and a
test gated on it that asserts `thinking…` specifically, so the reasoning path keeps direct
coverage where the backend can provide it.

## 2. Verify the OpenAI-compatible reasoning mapping against a real reasoning server

`@mokei/openai-provider` now maps `delta.reasoning_content` / `delta.reasoning` to
`reasoning-delta`. It is unit-tested with synthetic chunks, but no server exercised it
end-to-end: llama.cpp did not emit `reasoning_content` for the model on hand, whatever
`--reasoning-format`, `--jinja` or `--reasoning on` were set to.

**Fix:** run the chat suites against a server that does split reasoning — DeepSeek's API,
vLLM with a reasoning parser, or llama.cpp with a template it parses (DeepSeek-R1, Qwen3) —
and confirm the CLI renders the thinking view.

## Notes

- `MOKEI_LLAMA_GGUF` is a different backend again (in-process node-llama-cpp, not HTTP);
  whether `@mokei/llama-provider` surfaces reasoning separately has not been checked.
