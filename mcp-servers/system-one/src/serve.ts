#!/usr/bin/env node
import { serveProcess } from '@mokei/context-server-node'

import { createSystemOneConfig } from './config.js'

const config = createSystemOneConfig()

serveProcess(config)
