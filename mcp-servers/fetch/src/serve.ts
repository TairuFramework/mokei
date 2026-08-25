#!/usr/bin/env node
import { serveProcess } from '@mokei/context-server-node'

import { createFetchConfig } from './config.js'

const config = createFetchConfig()

serveProcess(config)
