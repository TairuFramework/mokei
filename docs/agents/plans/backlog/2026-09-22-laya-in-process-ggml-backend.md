# Laya in-process ggml / laya.cpp backend

Date: 2026-09-22
Priority: backlog

## Context

`@mokei/system-one-client` ships with a pluggable `SystemOneBackend` seam and one backend: `HTTPSystemOneBackend`,
which speaks the TypeSafe System One contract to a local `laya-serve` (the Python HTTP server from
[laya](https://github.com/NandhaKishorM/laya)) or the hosted `api.typesafe.ai`. The seam was designed precisely so an in-process backend can slot in without
changing any client consumer. See `docs/agents/plans/completed/2026-09-22-system-one-classification.complete.md`.

On 2026-09-23 `laya-serve` became the canonical local backend. A `@mokei/laya-backend` package that
ran `laya.cpp` through `laya daemon` over stdio was built and then dropped before release: `laya.cpp`
v0.9.2 crashed on every inference (`std::regex_error` in its compat preprocessor), and `laya-serve`
covers local inference on CPU, CUDA and Apple Silicon. This item only matters again if a
process-free binding is needed. Note that `laya.cpp` ships as an executable only (no library
target or C API), so a binding means building a C API around the `examples/laya` sources.

## Goal

Bind ggml / `laya.cpp` (the zero-dependency C++ runtime for GGUF-compiled Laya models from
[ggmlc](https://github.com/monatis/ggmlc)) behind the existing `SystemOneBackend` interface, removing the
sidecar requirement and the network round-trip for local inference. This matches the stack's
`node-llama-cpp` GGUF precedent and enables an on-device story (native ggml) and a web story (WASM).

## Scope

- New per-platform packages (`packages/laya-ggml-*` or similar) each carrying native or WASM
  dependencies, split by platform so the neutral `system-one-client` stays free of `node:*` and native
  deps. Each implements `SystemOneBackend` (`predict`, optional `close`).
- Wire them into `createSystemOneClient` via the existing `SystemOneClientParams` (custom-backend)
  form — no change to `SystemOneClient` or the HTTP path.
- GGUF loading/lifecycle owned by the backend package; GGUF *compilation* tooling
  (`uv pip install laya`, `compile_laya.py`) stays a documented prerequisite, not owned here.

## Not in scope

- Changes to the client's public surface, the HTTP backend, or the wire contract.
- A lifecycle-managed sidecar process (the HTTP path already documents running `laya-serve`).
