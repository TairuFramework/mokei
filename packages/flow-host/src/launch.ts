import type { ContextClient } from '@mokei/context-client'
import { isCreateTaskResult } from '@mokei/context-protocol'
import type { AuthorizeResult, DecisionFlowWiring } from '@mokei/decision-flow-server'

import { resultText } from './map-task.js'
import type { RunRecord } from './types.js'

export type ChangeRun = (
  runID: string,
  compute: (record: RunRecord) => Partial<RunRecord> | undefined,
) => Promise<RunRecord>

export function createLauncher(params: {
  client: ContextClient
  wiring: DecisionFlowWiring
  change: ChangeRun
  cancelTask(runID: string, taskID: string): Promise<RunRecord>
  watch(runID: string, taskID: string): void
}) {
  return async (record: RunRecord): Promise<RunRecord> => {
    const runID = record.runID
    let authorized: AuthorizeResult
    try {
      authorized = await params.wiring.authorize(record.request)
    } catch {
      return params.change(runID, () => ({
        state: 'failed',
        error: { type: 'FlowChanged', message: 'Flow changed since approval' },
      }))
    }
    try {
      if (
        !authorized.ok ||
        authorized.digest !== record.digest ||
        JSON.stringify([...authorized.plan].sort()) !==
          JSON.stringify([...record.plan.tools].sort())
      ) {
        return params.change(runID, () => ({
          state: 'failed',
          error: { type: 'FlowChanged', message: 'Flow changed since approval' },
        }))
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
      const taskID = result.taskId
      const linked = await params.change(runID, () => ({ taskID }))
      if (linked.cancelRequested) return await params.cancelTask(runID, taskID)
      params.watch(runID, taskID)
      return linked
    } catch (error) {
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
  }
}
