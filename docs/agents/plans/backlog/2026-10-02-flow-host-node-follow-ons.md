# Flow host Node follow-ons

**Origin:** flow host Node storage and observability, sub-project 2 of the [flow daemon milestone](../completed/2026-10-05-flow-daemon-milestone.complete.md)

## Historical tracing

Previously untraced persisted runs can resume after tracing is enabled without a durable trace ID being added to their run record.
The completed recovery contract preserves existing stored trace context. It does not define historical backfill.

Decide whether newly allocated recovery traces should be persisted for previously untraced runs.
If supported, verify resumed span and log lookup through the run record after another database reopen.
Preserve terminal immutability and revision checks.

## File-sink compatibility

The reviewed lockfile contains `@logtape/file@2.3.10` with a newer patch-level peer requirement than installed `@logtape/logtape@2.3.0`.
Real default setup, emission and disposal passed. Broader upstream compatibility remains unverified.

Recheck peer alignment during the next logging dependency update.
Verify rotation and teardown with real file output before changing the matched logging dependency set.
