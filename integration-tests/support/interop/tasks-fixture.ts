import { createTool, type ServerConfig } from '@mokei/context-server'

export const TASK_COMPLETE_TOOL = 'completeTask'
export const TASK_INPUT_TOOL = 'askNameTask'
export const TASK_CANCEL_TOOL = 'cancelTask'

export function taskResult(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

export function createMokeiTasksConfig(
  options: { completionGate?: Promise<void>; onCompleteStarted?: () => void } = {},
): ServerConfig {
  return {
    name: 'interop-tasks-fixture',
    version: '1.0.0',
    protocolVersions: ['2026-07-28'],
    tools: {
      [TASK_COMPLETE_TOOL]: createTool({
        description: 'Complete a task',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: ({ task }) => {
          if (task == null) throw new Error('Expected task context')
          return task.run(async () => {
            options.onCompleteStarted?.()
            await options.completionGate
            return taskResult('completed')
          })
        },
      }),
      [TASK_INPUT_TOOL]: createTool({
        description: 'Request a name inside a task',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: ({ task }) => {
          if (task == null) throw new Error('Expected task context')
          return task.run(async (handle) => {
            const responses = await handle.requestInput({
              name: {
                method: 'elicitation/create',
                params: {
                  message: 'What is your name?',
                  requestedSchema: {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                    required: ['name'],
                  },
                },
              },
            })
            const response = responses.name
            if (response == null || !('action' in response) || response.action !== 'accept') {
              throw new Error('Expected accepted elicitation')
            }
            const content = response.content as Record<string, unknown> | undefined
            return taskResult(`hello: ${String(content?.name)}`)
          })
        },
      }),
      [TASK_CANCEL_TOOL]: createTool({
        description: 'Wait for cancellation',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: ({ task }) => {
          if (task == null) throw new Error('Expected task context')
          return task.run(async (handle) => {
            await new Promise<void>((resolve) => {
              handle.signal.addEventListener('abort', () => resolve(), { once: true })
            })
            return taskResult('ignored')
          })
        },
      }),
    },
  }
}
