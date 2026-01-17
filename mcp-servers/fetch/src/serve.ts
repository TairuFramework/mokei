#!/usr/bin/env node
import { serveProcess } from '@mokei/context-server'

import { createFetchConfig } from './config.js'

const config = createFetchConfig()

serveProcess(config)
