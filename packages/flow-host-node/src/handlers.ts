import type { ProcedureHandlers } from '@enkaku/server'
import type { StartRunParams } from '@mokei/flow-host'
import { InboxItemNotFoundError, RunNotFoundError } from '@mokei/flow-host'
import type { FlowProcedure, Protocol } from '@mokei/host-protocol'

import { toHandlerError } from './handler-errors.js'
import type { FlowResources, FlowService } from './service.js'

export type FlowHandlers = Pick<ProcedureHandlers<Protocol>, FlowProcedure>

export function createFlowHandlers(service: FlowService): FlowHandlers {
  async function run<T>(work: (resources: FlowResources) => T | Promise<T>): Promise<T> {
    try {
      return await service.run(work)
    } catch (error) {
      throw toHandlerError(error)
    }
  }
  return {
    'flows.list': () => run(({ host }) => host.flows()),
    'flows.check': ({ param }) => {
      return run(async ({ host }) => {
        const checked = await host.check(param.definition)
        const details = { warnings: checked.warnings, formatted: checked.formatted }
        return checked.issues
          ? { issues: [...checked.issues], ...details }
          : { value: checked.value, ...details }
      })
    },
    // The wire validates JSON inputs; the runtime validates inline flow definitions.
    'runs.start': ({ param }) => run(({ host }) => host.start(param as StartRunParams)),
    'runs.get': ({ param }) => {
      return run(async ({ host }) => {
        const snapshot = await host.get(param.runID)
        if (snapshot == null) throw new RunNotFoundError({ runID: param.runID })
        return snapshot
      })
    },
    'runs.list': ({ param }) => run(({ host }) => host.list(param)),
    'runs.cancel': ({ param }) => run(({ host }) => host.cancel(param.runID)),
    'runs.trace': ({ param }) => {
      return run(async ({ host, traceStore }) => {
        const snapshot = await host.get(param.runID)
        if (snapshot == null) throw new RunNotFoundError({ runID: param.runID })
        if (snapshot.traceID == null) return { spans: [], logs: [] }
        const trace = await traceStore.getTrace(snapshot.traceID)
        return {
          spans: trace.spans,
          logs: trace.logs.map((log) => {
            const properties = { ...log.properties }
            delete properties['dev.mokei/logID']
            return { ...log, properties }
          }),
        }
      })
    },
    'inbox.list': ({ param }) => run(({ host }) => host.inbox.list(param)),
    'inbox.get': ({ param }) => {
      return run(({ host }) => {
        const item = host.inbox.get(param.id)
        if (item == null) throw new InboxItemNotFoundError({ itemID: param.id })
        return item
      })
    },
    'inbox.answer': ({ param }) => {
      return run(async ({ host }) => {
        await host.inbox.answer(param.id, param.content)
        return { settled: true as const }
      })
    },
    'inbox.decline': ({ param }) => {
      return run(async ({ host }) => {
        await host.inbox.decline(param.id, param.reason)
        return { settled: true as const }
      })
    },
    'inbox.cancel': ({ param }) => {
      return run(async ({ host }) => {
        await host.inbox.cancel(param.id)
        return { settled: true as const }
      })
    },
    'inbox.prompt': ({ param, signal }) => run(() => service.prompt(param.id, signal)),
  }
}
