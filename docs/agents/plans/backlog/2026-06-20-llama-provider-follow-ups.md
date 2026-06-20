# Llama provider — follow-ups

**Status:** backlog
**Origin:** `completed/2026-06-20-cli-chat-llama-wiring.complete.md` (non-blocking follow-ups).

CLI `chat --provider llama` and gated real-GGUF integration tests shipped (PR #34). These
are the deliberately-deferred, optional refinements. Low priority — local-inference tuning
and test hardening only; no correctness gap.

## Items

1. **`gpu` / `contextSize` flags** — path-only MVP uses node-llama-cpp defaults. Add CLI
   flags (and matching interactive card fields) if local-inference users want tuning.
2. **Positive tool-call assertion** — integration tests assert clean stream termination and
   validate a tool call's name only *if one appears* (small local models don't reliably emit
   tool calls). A deterministic prompt + soft warning could positively assert tool-calling
   later to harden the suite.

## Notes

- Both deferred on purpose in the original spec; not gating anything.
- Integration tests gated on `MOKEI_LLAMA_GGUF`, excluded from CI (`integration-tests/`).
