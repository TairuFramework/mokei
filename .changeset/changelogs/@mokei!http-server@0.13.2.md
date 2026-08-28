## 0.13.2

### Patch Changes

- SSE streams now apply reader-demand backpressure. `createSSEStream` previously enqueued into the response stream without consulting the reader, so a slow network reader let the internal queue grow without bound. It now parks the producer once the readable side holds `SSE_STREAM_HIGH_WATER_MARK` (16) un-consumed frames and resumes when the reader drains, and exposes a `release()` teardown hook so closing a stream never wedges behind a parked write. Session GET resumption is sized to buffer its whole replay snapshot, publishes its stream before replaying, and gates live server messages behind the replay so they are never dropped, interleaved into the snapshot, or lost when a reconnecting GET supersedes an in-flight one.
