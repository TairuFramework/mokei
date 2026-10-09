import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPIDPath } from '@tejika/env'
import { startMokeiDaemonWithDependencies } from 'mokei/lib/daemon-entry.js'

import {
  loadMokeiConfig,
  openMokeiDatabase,
  setupMokeiTelemetry,
} from '../../../packages/app-node/lib/index.js'

const directory = process.argv[2]
const record = (event) => {
  appendFileSync(
    join(directory, 'desktop.jsonl'),
    `${JSON.stringify({ pid: process.pid, ...event })}\n`,
  )
}
const prompts = new Map()
let index = 0
process.on('message', (message) => {
  if (message.type !== 'answer') return
  const resolve = prompts.get(message.index)
  if (resolve == null) throw new Error(`Unknown prompt: ${message.index}`)
  prompts.delete(message.index)
  resolve(
    message.content === undefined
      ? { action: message.action }
      : { action: message.action, content: message.content },
  )
  record({ type: 'resolved', index: message.index })
})
// IPC is a control surface, not a reason to keep a closed daemon alive.
process.channel.unref()
await startMokeiDaemonWithDependencies(
  {
    socketPath: join(directory, 'daemon.sock'),
    pidPath: getPIDPath('mokei'),
    databasePath: join(directory, 'mokei.db'),
    configPath: join(directory, 'mokei.json'),
    flowsConfigPath: join(directory, 'flows.json'),
    desktop: {
      canPrompt: () => true,
      prompt: ({ params, signal }) =>
        new Promise((resolve) => {
          const current = index++
          prompts.set(current, resolve)
          record({ type: 'prompt', index: current, requestedSchema: params.requestedSchema })
          // Deliberately defer native completion to exercise late answers after cancellation.
          const aborted = () => record({ type: 'aborted', index: current })
          signal.addEventListener('abort', aborted, { once: true })
          if (signal.aborted) aborted()
        }),
      notify: async (message) => record({ type: 'notification', message }),
      dispose: async () => {
        for (const resolve of prompts.values()) resolve({ action: 'cancel' })
        prompts.clear()
        record({ type: 'disposed' })
      },
    },
  },
  {
    loadConfig: loadMokeiConfig,
    openDatabase: openMokeiDatabase,
    setupTelemetry: (params) =>
      setupMokeiTelemetry({
        ...params,
        flushIntervalMs:
          process.env.MOKEI_TEST_FLUSH_INTERVAL_MS === undefined
            ? undefined
            : Number(process.env.MOKEI_TEST_FLUSH_INTERVAL_MS),
      }),
  },
)
record({ type: 'started' })
