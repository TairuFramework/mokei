---
'@mokei/system-one-client': patch
---

`validateQuestions`, `validateState` and `validateResult` now return a Standard Schema result (`{ value }` or `{ issues }`) instead of throwing; `SystemOneClient.predict` still throws `SystemOneInputError` or `SystemOneResponseError`. `ValidationIssue` is now `StandardSchemaV1.Issue`, and both error classes implement `StandardSchemaV1.FailureResult`. Confidence, probability, `noul` and `act_probability` bounds move into the answer schemas, with a new exported `probabilitySchema`.
