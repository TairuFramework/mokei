# System One answer field tolerance

Each answer schema in `packages/system-one-client/src/types.ts` (choice, score, noul) sets
`additionalProperties: false`. Unknown top-level response fields are safe: they go to
`result.extras`. An unknown per-answer field makes every `predict` throw
`SystemOneResponseError`. Supporting laya-serve needed schema changes for exactly this reason: it
adds `action.act_probability` on every answer and `confidence` on noul answers.

Options:

- Set `additionalProperties: true` on the answer schemas and keep the unknown fields on the answer.
- Collect unknown answer fields into a per-answer `extras`, mirroring the top-level handling.

Either way, update the "still rejects an unknown answer field" validation test. This is low
priority until the hosted API or laya-serve adds another per-answer field.
