/**
 * Run manager: starts approved flow tool calls as MCP tasks, watches each task by polling
 * `tasks.get`, feeds input requests to a per-run input tracker, and reports status.
 */

import { randomUUID } from 'node:crypto'

import { createInputTracker } from './inputs.mjs'

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
const UNKNOWN_AFTER_FAILURES = 3

function errorMessage(err) {
  return err?.message ?? String(err)
}

function errorResult(text) {
  return { isError: true, content: [{ type: 'text', text }] }
}

function successResult(structuredContent) {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  }
}

function abortableSleep(signal) {
  return (ms) =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve()
        return
      }
      const done = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      signal.addEventListener('abort', done, { once: true })
    })
}

export function createRunManager({
  client,
  approve,
  ask,
  listPending,
  log,
  withdrawReason,
  pollMs = 500,
  maxBackoffMs = 5000,
  sleep,
}) {
  const runs = new Map()
  const approvals = new Set()
  const starts = new Set()
  const lateCancels = []
  const stopController = new AbortController()
  const wait = sleep ?? abortableSleep(stopController.signal)
  let shutdownPromise

  function cancelTask(taskID) {
    return Promise.resolve()
      .then(() => client.tasks.cancel(taskID))
      .catch((err) => log(`Failed to cancel task ${taskID}`, err))
  }

  function isStopped() {
    return stopController.signal.aborted
  }

  function apply(run, snapshot) {
    run.failures = 0
    run.pollError = undefined
    run.state = snapshot.status
    if (snapshot.status === 'completed') {
      run.result = snapshot.result
    } else if (snapshot.status === 'failed') {
      run.error = errorMessage(snapshot.error)
    }
    run.tracker.reconcile(snapshot)
  }

  async function watch(run) {
    while (!isStopped() && !TERMINAL.has(run.state)) {
      let snapshot
      try {
        snapshot = await client.tasks.get(run.taskID)
      } catch (err) {
        if (isStopped()) {
          return
        }
        run.failures += 1
        run.pollError = errorMessage(err)
        const delay =
          run.failures >= UNKNOWN_AFTER_FAILURES
            ? Math.min(pollMs * 2 ** (run.failures - 2), maxBackoffMs)
            : pollMs
        await wait(delay)
        continue
      }
      if (isStopped()) {
        return
      }
      apply(run, snapshot)
      if (!TERMINAL.has(run.state)) {
        await wait(pollMs)
      }
    }
  }

  function register(runID, task, label) {
    const run = {
      taskID: task.taskId,
      label,
      state: task.status ?? 'working',
      result: undefined,
      error: undefined,
      pollError: undefined,
      failures: 0,
      tracker: undefined,
    }
    run.tracker = createInputTracker({
      ask: (requestKey, request, signal) => ask(runID, requestKey, request, signal),
      update: (responses) => client.tasks.update(run.taskID, responses),
      log,
      withdrawReason: withdrawReason && ((key) => withdrawReason({ taskID: run.taskID, key })),
    })
    runs.set(runID, run)
    watch(run).catch((err) => {
      log(`Watcher for run ${runID} failed`, err)
    })
  }

  function reportedState(run) {
    return run.failures >= UNKNOWN_AFTER_FAILURES ? 'unknown' : run.state
  }

  async function callFlowTool(runID, toolName, args, meta, label) {
    let result
    try {
      result = await client.callTool({
        name: toolName,
        arguments: args,
        _meta: meta,
        task: 'handle',
      })
    } catch (err) {
      log(`Flow tool ${toolName} failed`, err)
      return errorResult(errorMessage(err))
    }
    if (typeof result?.taskId !== 'string') {
      return result
    }
    if (isStopped()) {
      lateCancels.push(cancelTask(result.taskId))
      return errorResult('Rig is shutting down')
    }
    register(runID, result, label)
    return successResult({ runID })
  }

  return {
    async start({ toolName, args, signal, label }) {
      if (isStopped()) {
        return errorResult('Rig is shutting down')
      }
      const runID = randomUUID()
      const controller = new AbortController()
      approvals.add(controller)
      const approvalSignal =
        signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal])
      let decision
      try {
        decision = await approve({ runID, toolName, args, signal: approvalSignal })
      } catch (err) {
        return errorResult(`Flow denied: ${errorMessage(err)}`)
      } finally {
        approvals.delete(controller)
      }
      if (isStopped()) {
        return errorResult('Rig is shutting down')
      }
      if (signal?.aborted) {
        return errorResult('Start cancelled')
      }
      if (!decision?.approved) {
        return errorResult(`Flow denied: ${decision?.reason}`)
      }
      const pending = callFlowTool(runID, toolName, args, decision.meta, label)
      starts.add(pending)
      try {
        return await pending
      } finally {
        starts.delete(pending)
      }
    },

    label(runID) {
      return runs.get(runID)?.label
    },

    status(runID) {
      const run = runs.get(runID)
      if (run == null) {
        return errorResult(`Unknown run: ${runID}`)
      }
      const state = reportedState(run)
      const structured = {
        state,
        pending: state === 'input_required' ? listPending(runID) : [],
      }
      if (run.result !== undefined) {
        structured.result = run.result
      }
      const error = state === 'unknown' ? run.pollError : (run.error ?? run.tracker.error)
      if (error !== undefined) {
        structured.error = error
      }
      return successResult(structured)
    },

    async cancel(runID) {
      const run = runs.get(runID)
      if (run == null) {
        return errorResult(`Unknown run: ${runID}`)
      }
      try {
        await client.tasks.cancel(run.taskID)
      } catch (err) {
        return errorResult(`Failed to cancel run ${runID}: ${errorMessage(err)}`)
      }
      try {
        const snapshot = await client.tasks.get(run.taskID)
        if (!isStopped()) {
          apply(run, snapshot)
        }
        return successResult({ state: snapshot.status })
      } catch {
        return successResult({ state: 'cancelled' })
      }
    },

    shutdown({ timeoutMs = 5000 } = {}) {
      shutdownPromise ??= (async () => {
        stopController.abort()
        for (const controller of approvals) {
          controller.abort()
        }
        for (const run of runs.values()) {
          run.tracker.abortAll()
        }
        // Starts past approval may still create tasks; those are cancelled once they settle.
        const work = [Promise.allSettled([...starts]).then(() => Promise.allSettled(lateCancels))]
        for (const run of runs.values()) {
          work.push(run.tracker.settled())
          if (!TERMINAL.has(run.state)) {
            work.push(cancelTask(run.taskID))
          }
        }
        let timer
        const timeout = new Promise((resolve) => {
          timer = setTimeout(resolve, timeoutMs)
        })
        await Promise.race([Promise.allSettled(work), timeout])
        clearTimeout(timer)
      })()
      return shutdownPromise
    },
  }
}
