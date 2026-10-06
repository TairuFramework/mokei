import { join } from 'node:path'
import { startMokeiDaemon } from 'mokei/lib/daemon-entry.js'

const directory = process.argv[2]
const clicks = []
const record = (event) => process.send?.(event)
process.on('message', (message) => {
  if (message.type === 'click') clicks[message.index]?.()
})
process.channel.unref()
await startMokeiDaemon({
  socketPath: join(directory, 'daemon.sock'),
  pidPath: join(directory, 'daemon.pid'),
  databasePath: join(directory, 'mokei.db'),
  configPath: join(directory, 'mokei.json'),
  flowsConfigPath: join(directory, 'flows.json'),
  desktop: {
    canPrompt: () => true,
    prompt: ({ signal }) =>
      new Promise((resolve) => {
        record({ type: 'prompt' })
        const cancel = () => resolve({ action: 'cancel' })
        signal.addEventListener('abort', cancel, { once: true })
        if (signal.aborted) cancel()
      }),
    notify: async (message, options) => {
      const index = clicks.length
      clicks.push(options?.onClick)
      record({ type: 'notification', message, index })
    },
    dispose: async () => {},
  },
  openURL: async (url) => record({ type: 'open', url }),
})
