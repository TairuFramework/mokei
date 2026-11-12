---
"@mokei/host-node": patch
---

**Behaviour change:** callers that pass `env` must now include `PATH` (and anything else the server needs). The command is looked up with the child's `PATH`, so `command: 'node'` with `env: { API_KEY }` and no `PATH` fails with `ENOENT`.

Spawn stdio contexts with exactly the given `env`: an explicit `env` is now the child's whole environment and no longer merges with the parent's `process.env`, so daemon variables stop leaking into MCP servers. Omit `env` to inherit the parent environment. On Windows, libuv still adds a few non-sensitive system variables (`PATH`, `TEMP`, `USERPROFILE`, `USERNAME`, `SYSTEMROOT`), and `env` keys that differ only by case can collide.
