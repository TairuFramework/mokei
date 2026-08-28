## 0.13.2

### Patch Changes

- Completed the per-revision server-message split: the `2025-11-25` revision module now defines its own `serverRequest`, `serverNotification`, `serverResult`, `serverResponse`, and `serverMessage` unions rather than borrowing the cross-revision ones from `server.ts`, mirroring the client side and the `2026-07-28` revision. The unqualified `ServerRequest`/`ServerNotification`/`ServerResult`/`ServerMessage` exports remain as a cross-revision convenience; per-connection wire validation now uses each revision's own `serverMessage`.
