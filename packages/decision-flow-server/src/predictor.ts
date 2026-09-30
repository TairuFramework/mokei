import type { CallToolResult } from '@mokei/context-protocol'
import type { Predictor, PredictParams } from '@mokei/decision-flow'
import type { PredictResult, QuestionMap } from '@mokei/system-one-client'
import { SystemOneError, SystemOneResponseError } from '@mokei/system-one-client'

import { callMeta, FLOW_DEPTH_META } from './call-meta.js'
import { cancelSibling, type ToolCaller } from './tool-caller.js'
import { validatorFor } from './validators.js'

export type PredictorFactory = ((run: { depth: number }) => Predictor) & { tool: string }

function errorText(result: CallToolResult): string {
  return result.content
    .filter(
      (part): part is Extract<(typeof result.content)[number], { type: 'text' }> =>
        part.type === 'text',
    )
    .map((part) => part.text)
    .join('')
}

export function createMCPPredictor(
  caller: ToolCaller,
  options: { tool?: string } = {},
): PredictorFactory {
  const tool = options.tool ?? 'system-one:predict'

  return Object.assign(
    (run: { depth: number }): Predictor => ({
      async predict(params: PredictParams): Promise<PredictResult<QuestionMap>> {
        const signal = params.signal ?? new AbortController().signal
        const args = {
          state: params.state,
          questions: params.questions,
          ...(params.model === undefined ? {} : { model: params.model }),
        } as Parameters<ToolCaller['callTool']>[0]['arguments']
        const meta = params.call
          ? callMeta({
              depth: run.depth + 1,
              key: `${params.call.runID}:${params.call.invocationID}:predict`,
              attempt: params.call.attempt,
            })
          : { [FLOW_DEPTH_META]: run.depth + 1 }
        const outcome = await caller.callTool({ id: tool, arguments: args, meta, signal })
        let result: CallToolResult
        if ('task' in outcome) {
          const task = { id: tool, taskId: outcome.task.taskId }
          const onAbort = () => {
            void cancelSibling(caller, task).catch(() => {})
          }
          signal.addEventListener('abort', onAbort, { once: true })
          if (signal.aborted) onAbort()
          try {
            result = await caller.waitTask({ ...task, signal })
          } catch (cause) {
            // biome-ignore lint/style/useErrorCause: SystemOneError accepts cause in its params object.
            throw new SystemOneError({ message: 'Predictor task failed', cause })
          } finally {
            signal.removeEventListener('abort', onAbort)
          }
        } else {
          result = outcome.result
        }

        if (result.isError === true) {
          throw new SystemOneError({ message: errorText(result) || 'Predictor tool failed' })
        }
        const outputSchema = caller.listTools().find((entry) => entry.id === tool)?.outputSchema
        if (outputSchema === undefined || result.structuredContent === undefined) {
          throw new SystemOneResponseError({ message: 'Predictor returned no structured output' })
        }
        const validated = validatorFor(outputSchema)(result.structuredContent)
        if (validated.issues) {
          throw new SystemOneResponseError({
            message: 'Predictor output failed validation',
            issues: validated.issues,
          })
        }
        return validated.value as PredictResult<QuestionMap>
      },
    }),
    { tool },
  )
}

export function resolvePredictor(
  predictor: Predictor | PredictorFactory,
  run: { depth: number },
): Predictor {
  return typeof predictor === 'function' ? predictor(run) : predictor
}
