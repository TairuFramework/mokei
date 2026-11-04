import type { FlowRunSnapshot, RunListFilter } from '@mokei/flow-client'
import { isFlowControlError } from '@mokei/flow-client'
import { useMemo } from 'react'

import { useFlow } from './FlowProvider.js'
import { applyRunEvent } from './reconcile.js'
import { type ReconciledQuery, useReconciledQuery } from './useReconciledQuery.js'

function matchesFilter(run: FlowRunSnapshot, filter?: RunListFilter): boolean {
  return (
    (filter?.states == null || filter.states.includes(run.state)) &&
    (filter?.updatedBefore == null || run.updatedAt < filter.updatedBefore)
  )
}

function filterRuns(runs: Map<string, FlowRunSnapshot>, filter?: RunListFilter) {
  const entries = [...runs.values()]
    .filter((run) => matchesFilter(run, filter))
    .sort((a, b) => b.createdAt - a.createdAt)
  return new Map(entries.map((run) => [run.runID, run]))
}

export function useRuns(filter?: RunListFilter) {
  const { control } = useFlow()
  const filterKey = JSON.stringify(filter ?? {})
  const query = useMemo<
    ReconciledQuery<Map<string, FlowRunSnapshot>, FlowRunSnapshot | undefined>
  >(() => {
    const params: RunListFilter = JSON.parse(filterKey)
    // Runs on the visible page; undefined until a snapshot lands, so early events stay conservative.
    let visible: Set<string> | undefined
    const track = (runs: Map<string, FlowRunSnapshot>) => {
      visible = new Set([...runs.keys()].slice(0, params.limit))
      return runs
    }
    const merge = (runs: Map<string, FlowRunSnapshot>, runID: string, run?: FlowRunSnapshot) => {
      const next = new Map(runs)
      next.delete(runID)
      if (run != null) next.set(runID, run)
      return track(filterRuns(next, params))
    }
    return {
      initial: new Map(),
      read: async () => {
        return track(
          filterRuns(
            new Map((await control.runs.list(params)).map((run) => [run.runID, run])),
            params,
          ),
        )
      },
      // Only a visible run leaving the filter frees a slot that a re-read must fill.
      refreshOn: (event) => {
        if (params.limit == null || event.type !== 'run:state') return false
        if (visible != null && !visible.has(event.data.runID)) return false
        return !matchesFilter(event.data, params)
      },
      affected: (event) => (event.type === 'run:state' ? event.data.runID : undefined),
      readAffected: async (runID) => {
        try {
          return await control.runs.get(runID)
        } catch (error) {
          if (!isFlowControlError(error, 'RUN_NOT_FOUND')) throw error
        }
      },
      // A buffered run may have left the page while the snapshot was in flight.
      refreshAfterAffected: (run) => {
        return params.limit != null && (run == null || !matchesFilter(run, params))
      },
      merge,
      apply: (runs, event) => track(filterRuns(applyRunEvent(runs, event), params)),
    }
  }, [control, filterKey])
  const { data, ...state } = useReconciledQuery(query)
  const runs = [...data.values()]
  return { runs: filter?.limit == null ? runs : runs.slice(0, filter.limit), ...state }
}
