# Laya in-process ggml / laya.cpp backend

Date: 2026-09-22
Priority: backlog

## Context

`@mokei/system-one-client` ships with a pluggable `SystemOneBackend` seam and one backend: `HTTPSystemOneBackend`,
which speaks the TypeSafe System One contract to a `laya serve` sidecar or the hosted
`api.typesafe.ai`. The seam was designed precisely so an in-process backend can slot in without
changing any client consumer. See `docs/agents/plans/completed/2026-09-22-system-one-classification.complete.md`.

## Goal

Bind ggml / `laya.cpp` (the zero-dependency C++ runtime for GGUF-compiled Laya models from
[ggmlc](https://github.com/monatis/ggmlc)) behind the existing `SystemOneBackend` interface, removing the
sidecar requirement and the network round-trip for local inference. This matches the stack's
`node-llama-cpp` GGUF precedent and enables an on-device story (native ggml) and a web story (WASM).

## Scope

- New per-platform packages (`packages/laya-ggml-*` or similar) each carrying native or WASM
  dependencies, split by platform so the neutral `system-one-client` stays free of `node:*` and native
  deps. Each implements `SystemOneBackend` (`predict`, optional `batch`, `listModels`, `close`).
- Wire them into `createSystemOneClient` via the existing `SystemOneBackendClientOptions` (custom-backend)
  form — no change to `SystemOneClient` or the HTTP path.
- GGUF loading/lifecycle owned by the backend package; GGUF *compilation* tooling
  (`uv pip install laya`, `compile_laya.py`) stays a documented prerequisite, not owned here.

## Not in scope

- Changes to the client's public surface, the HTTP backend, or the wire contract.
- A lifecycle-managed sidecar process (the HTTP path already documents running `laya serve`).
