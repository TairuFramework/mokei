---
'@mokei/host-desktop': patch
'@mokei/decision-flow-server': patch
---

Compile runtime schemas on an isolated validator factory that is recycled after 256 distinct compiles, so long-running processes stop accumulating compiled validators. Also stop the decision-flow server from recompiling schemas on every run.
