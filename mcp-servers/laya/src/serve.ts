#!/usr/bin/env node
import { serveProcess } from '@mokei/context-server-node'

import { createLayaConfig } from './config.js'

const config = createLayaConfig()

serveProcess(config)
