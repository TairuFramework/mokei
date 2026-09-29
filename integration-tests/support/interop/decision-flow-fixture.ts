import { createMemoryTaskStore, createTaskManager, createTool } from '@mokei/context-server'
import { addDecisionFlow } from '@mokei/decision-flow-server'
import { createSystemOneConfig } from '@mokei/mcp-system-one'
import { Session } from '@mokei/session'
import { SystemOneClient, type SystemOneResult } from '@mokei/system-one-client'
import type { FlowDefinition } from '@sozai/flow-graph'

import example from '../../../packages/decision-flow/examples/support-triage.json' with {
  type: 'json',
}

export type Ticket = { team: string; message: string }

const ticketSchema = {
  type: 'object' as const,
  properties: {
    ticket: {
      type: 'object' as const,
      properties: {
        team: { type: 'string' as const },
        message: { type: 'string' as const },
      },
      required: ['team', 'message'],
    },
  },
  required: ['ticket'],
}

export async function createDecisionFlowFixture(
  options: {
    pauseTicket?: boolean
    responses?: Array<SystemOneResult>
    client?: SystemOneClient
  } = {},
) {
  const tickets: Array<Ticket> = []
  const siblingStore = createMemoryTaskStore()
  const siblingTasks = createTaskManager({ store: siblingStore })
  const flowStore = createMemoryTaskStore()
  const session = new Session({ elicit: true })
  let startTicket!: () => void
  const ticketStarted = new Promise<void>((resolve) => {
    startTicket = resolve
  })
  let answerIndex = 0
  const client =
    options.client ??
    new SystemOneClient({
      backend: {
        predict: async () => {
          const response = options.responses?.[answerIndex++]
          if (!response) throw new Error('Unexpected System One prediction')
          return response
        },
      },
      defaultModel: 'test-model',
    })
  const definition = {
    ...example,
    nodes: {
      ...example.nodes,
      billing: {
        kind: 'tool',
        tool: 'support:createTicketTask',
        args: example.nodes.billing.args,
        next: 'done',
      },
      technical: {
        kind: 'tool',
        tool: 'support:createTicket',
        args: example.nodes.technical.args,
        next: 'done',
      },
    },
  } as FlowDefinition

  session.contextHost.addDirectContext({
    key: 'system-one',
    protocolVersion: '2026-07-28',
    config: createSystemOneConfig({ client }),
  })
  session.contextHost.addDirectContext({
    key: 'support',
    protocolVersion: '2026-07-28',
    config: {
      name: 'support',
      version: '1.0.0',
      protocolVersions: ['2026-07-28'],
      tasks: siblingTasks,
      tools: {
        createTicket: createTool({
          description: 'Create a support ticket',
          inputSchema: ticketSchema,
          handler: ({ input }) => {
            tickets.push(input.ticket as Ticket)
            return { content: [], structuredContent: { created: true } }
          },
        }),
        createTicketTask: createTool({
          description: 'Create a support ticket in a task',
          inputSchema: ticketSchema,
          handler: ({ input, task }) => {
            if (!task) throw new Error('Task context missing')
            return task.run(async (handle) => {
              startTicket()
              if (options.pauseTicket) {
                await new Promise<void>((resolve) => {
                  if (handle.signal.aborted) resolve()
                  else handle.signal.addEventListener('abort', () => resolve(), { once: true })
                })
              } else {
                tickets.push(input.ticket as Ticket)
              }
              return { content: [], structuredContent: { created: true } }
            })
          },
        }),
      },
    },
  })
  await Promise.all([
    session.contextHost.setup({ key: 'system-one' }),
    session.contextHost.setup({ key: 'support' }),
  ])
  const wiring = await addDecisionFlow(session, { key: 'flow', store: flowStore })
  return {
    definition,
    tickets,
    session,
    wiring,
    ticketStarted,
    siblingTasks,
    siblingStore,
    flowStore,
    async dispose() {
      await wiring.dispose()
      await session.dispose()
      await siblingTasks.dispose()
    },
  }
}
