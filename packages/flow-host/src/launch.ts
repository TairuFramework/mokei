import type { ContextClient } from '@mokei/context-client'
import { isCreateTaskResult } from '@mokei/context-protocol'
import type { AuthorizeResult, DecisionFlowWiring } from '@mokei/decision-flow-server'

import { resultText } from './map-task.js'
import type { RunTracing } from './tracing.js'
import type { RunRecord } from './types.js'

export type ChangeRun = (
  runID: string,
  compute: (record: RunRecord) => Partial<RunRecord> | undefined,
) => Promise<RunRecord>

export function createLauncher(params: {
  tracing: RunTracing
  client: ContextClient
  wiring: DecisionFlowWiring
  change: ChangeRun
  cancelTask(runID: string, taskID: string): Promise<RunRecord>
  watch(runID: string, taskID: string): void
}) {
  return (record: RunRecord): Promise<RunRecord> => {
    return params.tracing.withRun(record.runID, async () => {
      const runID = record.runID
      const flowChanged = (current: RunRecord): Partial<RunRecord> => {
        return current.cancelRequested
          ? { state: 'cancelled' }
          : {
              state: 'failed',
              error: { type: 'FlowChanged', message: 'Flow changed since approval' },
            }
      }
      let authorized: AuthorizeResult
      try {
        authorized = await params.wiring.authorize(record.request)
      } catch {
        return params.change(runID, flowChanged)
      }
      let taskID: string | undefined
      let linked: RunRecord
      try {
        if (
          !authorized.ok ||
          authorized.digest !== record.digest ||
          JSON.stringify([...authorized.plan].sort()) !==
            JSON.stringify([...record.plan.tools].sort())
        ) {
          return params.change(runID, flowChanged)
        }
        const result = await params.client.callTool({
          name: record.request.toolName,
          arguments: record.request.arguments,
          _meta: { ...authorized.grant(), 'dev.mokei/flow-run': runID },
          task: 'handle',
        })
        if (!isCreateTaskResult(result)) {
          return params.change(runID, (current) =>
            current.cancelRequested
              ? { state: 'cancelled' }
              : { state: 'failed', error: { type: 'StartFailed', message: resultText(result) } },
          )
        }
        taskID = result.taskId
        linked = await params.change(runID, () => ({ taskID }))
      } catch (error) {
        if (taskID !== undefined) await params.client.tasks.cancel(taskID).catch(() => undefined)
        return params.change(runID, (current) =>
          current.cancelRequested
            ? { state: 'cancelled' }
            : {
                state: 'failed',
                error: {
                  type: 'StartFailed',
                  message: error instanceof Error ? error.message : String(error),
                },
              },
        )
      }
      params.watch(runID, taskID)
      if (linked.cancelRequested) return params.cancelTask(runID, taskID)
      return linked
    })
  }
}
