import { createTool } from '../../../packages/context-server/lib/index.js'
import { serveProcess } from '../../../packages/context-server-node/lib/index.js'
import { createRig } from '../../../scripts/flow-rig/serve.mjs'
import { createStubDesktop } from './stub-desktop.mjs'

const stub = createStubDesktop()
let rig

let stopping
function stop() {
  stopping ??= (async () => {
    try {
      await rig?.shutdown()
    } finally {
      await stub.dispose()
    }
  })()
  return stopping
}

function exit() {
  stop().then(
    () => process.exit(0),
    (error) => {
      console.error('[flow-rig-stub]', error)
      process.exit(1)
    },
  )
}
process.once('SIGINT', exit)
process.once('SIGTERM', exit)
process.stdin.once('end', exit)

try {
  rig = await createRig({ configPath: process.env.FLOW_RIG_CONFIG, desktop: stub.desktop })
} catch (error) {
  console.error('[flow-rig-stub]', error)
  await stop()
  process.exit(1)
}

serveProcess({
  name: 'flow-rig-stub',
  version: '0.1.0',
  protocolVersions: ['2026-07-28', '2025-11-25'],
  tools: {
    ...rig.tools,
    ...stub.tools,
    stub_shutdown: createTool({
      description: 'Shut down the rig and its siblings',
      inputSchema: { type: 'object' },
      handler: async () => {
        await stop()
        return { content: [{ type: 'text', text: '{}' }], structuredContent: {} }
      },
    }),
  },
})
