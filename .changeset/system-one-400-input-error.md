---
'@mokei/system-one-client': patch
---

Map a `400` from the System One backend to `SystemOneInputError`, as llama.cpp's `/v1/systemone` rejects an invalid request with `400` where laya-serve uses `422`.
