#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite'
import { parseArgs } from 'node:util'
import { serveProcess } from '@mokei/context-server'

import { createSQLiteConfig } from './index.js'

const args = parseArgs({
  options: {
    db: { type: 'string' },
  },
})

const db = new DatabaseSync(args.values.db ?? ':memory:')
const config = createSQLiteConfig(db)

serveProcess(config)
