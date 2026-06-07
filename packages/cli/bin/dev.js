#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import { run } from '../dist/index.js'

await run(process.argv)
