# Surface stdio framing-limit overrides through Session / CLI

**Priority:** low
**Origin:** code review of `fix/stdio-framing` (stdio framing limits, completed 2026-06-16)

## Context

`ContextHost.addLocalContext` and `spawnHostedContext` accept optional
`maxBufferSize` / `maxMessageSize` overrides (default `maxBufferSize` 8 MiB,
`maxMessageSize` unset). Today nothing above the host passes them: `Session`
(`packages/session/src/...`) calls `addLocalContext({ key, command, args, env })`
with no framing fields, so every real context uses the 8 MiB default and the
override is unreachable from the CLI.

## Work

Thread the two optional fields through `Session`'s add-context params (and any
CLI/config surface that configures local contexts) so a user can tune the cap
per server — e.g. a tighter cap for an untrusted server, or a larger one for a
server with legitimately huge tool results.

## Notes

- Pure plumbing; the host side is already in place and tested.
- The 8 MiB default fully protects the CLI path as-is, so this is an enhancement,
  not a fix.
