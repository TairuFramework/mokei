import { type InboxItem, type InboxOutcome, isFlowControlError } from '@mokei/flow-client'
import { useMemo, useRef } from 'react'

import { useFlow, useInboxSettlements } from './FlowProvider.js'
import { applyInboxEvent, type InboxState, mergeInboxSnapshot } from './reconcile.js'
import { type ReconciledQuery, useReconciledQuery } from './useReconciledQuery.js'

export function useInboxQuery(itemID?: string, runID?: string) {
  const { control } = useFlow()
  const sessionSettled = useInboxSettlements()
  const settled = useRef(new Map<string, InboxOutcome>())
  const query = useMemo<ReconciledQuery<InboxState, InboxItem | undefined>>(() => {
    const history = () => new Map([...sessionSettled, ...settled.current])
    const matches = (item: InboxItem) =>
      (itemID == null || item.id === itemID) && (runID == null || item.runID === runID)
    const get = async (id: string) => {
      if (history().has(id)) return
      try {
        return await control.inbox.get(id)
      } catch (error) {
        if (!isFlowControlError(error, 'INBOX_ITEM_NOT_FOUND')) throw error
      }
    }
    return {
      initial: { items: new Map(), settled: history() },
      read: async () => {
        const snapshot =
          itemID == null
            ? await control.inbox.list(runID == null ? undefined : { runID })
            : await get(itemID)
        const items = snapshot == null ? [] : Array.isArray(snapshot) ? snapshot : [snapshot]
        return mergeInboxSnapshot({ items: new Map(), settled: history() }, items)
      },
      observe: (event) => {
        if (event.type === 'inbox:settled')
          settled.current.set(event.data.item.id, event.data.outcome)
      },
      affected: (event) => {
        const item =
          event.type === 'inbox:added'
            ? event.data
            : event.type === 'inbox:settled'
              ? event.data.item
              : undefined
        return item != null && matches(item) ? item.id : undefined
      },
      readAffected: get,
      merge: (state, id, item) => {
        const items = new Map(state.items)
        items.delete(id)
        if (item != null && matches(item)) items.set(id, item)
        return mergeInboxSnapshot({ items, settled: history() }, [...items.values()])
      },
      apply: applyInboxEvent,
    }
  }, [control, itemID, runID, sessionSettled])
  return useReconciledQuery(query)
}
