---
'@mokei/system-one-client': minor
---

Reject backend answers whose choice, score, noul, confidence, action probability, or probabilities violate the question's declared values and bounds. Previously accepted invalid answers now throw `SystemOneResponseError`.
