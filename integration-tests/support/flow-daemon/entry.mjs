import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { startMokeiDaemon } from 'mokei/lib/daemon-entry.js'

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
  resolve({ action: 'accept', content: { value: message.value } })
  record({ type: 'resolved', index: message.index })
})
// IPC is a control surface, not a reason to keep a closed daemon alive.
process.channel.unref()
await startMokeiDaemon({
  socketPath: join(directory, 'daemon.sock'),
  pidPath: join(directory, 'daemon.pid'),
  databasePath: join(directory, 'flows.db'),
  configPath: join(directory, 'config.json'),
  desktop: {
    canPrompt: () => true,
    prompt: ({ signal }) =>
      new Promise((resolve) => {
        const current = index++
        prompts.set(current, resolve)
        record({ type: 'prompt', index: current })
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
})
record({ type: 'started' })
