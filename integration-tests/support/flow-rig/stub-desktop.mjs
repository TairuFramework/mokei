import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTool } from '../../../packages/context-server/lib/index.js'

function success(structuredContent) {
  return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent }
}

export function createStubDesktop() {
  const binDir = mkdtempSync(join(tmpdir(), 'flow-rig-bin-'))
  try {
    for (const name of ['zenity', 'notify-send']) {
      writeFileSync(join(binDir, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    }
  } catch (error) {
    rmSync(binDir, { recursive: true, force: true })
    throw error
  }

  const calls = []
  const pending = new Map()
  let runnerCalls = 0
  const runner = {
    run() {
      runnerCalls += 1
      return Promise.reject(new Error('stub runner does not run'))
    },
  }

  function createBackend(name) {
    return {
      name,
      ask(request, options) {
        const call = {
          index: calls.length,
          backend: name,
          type: 'ask',
          kind: request.kind,
          title: request.title,
          text: request.text,
          pending: true,
        }
        calls.push(call)
        return new Promise((resolve, reject) => {
          const { signal } = options
          function settle(result, error) {
            call.pending = false
            pending.delete(call.index)
            signal.removeEventListener('abort', onAbort)
            if (error) reject(signal.reason)
            else resolve(result)
          }
          const onAbort = () => settle(undefined, true)
          pending.set(call.index, (result) => settle(result, false))
          signal.addEventListener('abort', onAbort, { once: true })
          if (signal.aborted) onAbort()
        })
      },
      async notify(request) {
        calls.push({
          index: calls.length,
          backend: name,
          type: 'notify',
          title: request.title,
          text: request.message,
          pending: false,
        })
      },
    }
  }

  return {
    desktop: {
      createBackend,
      runner,
      platform: 'linux',
      env: { PATH: binDir, DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/stub' },
    },
    tools: {
      stub_dialogs: createTool({
        description: 'List stub desktop calls',
        inputSchema: { type: 'object' },
        handler: () => success({ calls, runnerCalls }),
      }),
      stub_answer: createTool({
        description: 'Settle a pending stub dialog',
        inputSchema: {
          type: 'object',
          properties: { index: { type: 'integer' }, result: { type: 'object' } },
          required: ['index', 'result'],
        },
        handler: ({ input }) => {
          const answer = pending.get(input.index)
          if (answer == null) {
            return {
              isError: true,
              content: [{ type: 'text', text: `No pending dialog at ${input.index}` }],
            }
          }
          answer(input.result)
          return success({ index: input.index })
        },
      }),
    },
    dispose: () => rm(binDir, { recursive: true, force: true }),
  }
}
