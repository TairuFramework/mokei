/**
 * Per-run reconciliation of a flow task's pending input requests with desktop prompts.
 * Record states: `asking` (handler running), `sending` (result held until `tasks.update`
 * succeeds), `done` (answered, withdrawn or failed; never dispatched again).
 */

const INVALID_PARAMS = -32602

export function createInputTracker({ ask, update, log, withdrawReason, maxAttempts = 3 }) {
  const records = new Map()
  const inFlight = new Set()
  let error

  function send(key, record) {
    record.attempts += 1
    record.inFlight = true
    let pending
    try {
      pending = Promise.resolve(update({ [key]: record.result }))
    } catch (err) {
      pending = Promise.reject(err)
    }
    const promise = pending
      .then(
        () => {
          record.state = 'done'
        },
        (err) => {
          if (record.state !== 'sending') {
            return
          }
          if (err?.code === INVALID_PARAMS) {
            record.state = 'done'
            log(`Input ${key} is no longer pending`, err)
          } else if (record.attempts >= maxAttempts) {
            record.state = 'done'
            error = `Failed to send input ${key}: ${err?.message ?? String(err)}`
            log(error, err)
          }
        },
      )
      .finally(() => {
        record.inFlight = false
        inFlight.delete(promise)
      })
    inFlight.add(promise)
  }

  function start(key, request) {
    const controller = new AbortController()
    const record = { state: 'asking', controller, result: undefined, attempts: 0, inFlight: false }
    records.set(key, record)
    let pending
    try {
      pending = Promise.resolve(ask(key, request, controller.signal))
    } catch (err) {
      pending = Promise.reject(err)
    }
    pending
      .catch((err) => {
        // A handler rejecting after its withdrawal is expected: nothing to log or send.
        if (record.state === 'asking') {
          log(`Input handler failed for ${key}`, err)
        }
        return { action: 'cancel' }
      })
      .then((result) => {
        if (record.state !== 'asking') {
          return
        }
        record.state = 'sending'
        record.result = result
        send(key, record)
      })
  }

  function withdraw(key, record) {
    record.controller.abort(withdrawReason?.(key))
    record.state = 'done'
  }

  return {
    records,
    get error() {
      return error
    },
    reconcile(snapshot) {
      const requests = snapshot.inputRequests ?? {}
      const inputRequired = snapshot.status === 'input_required'
      for (const [key, record] of records) {
        const present = inputRequired && Object.hasOwn(requests, key)
        if (record.state === 'asking' && !present) {
          withdraw(key, record)
        } else if (record.state === 'sending') {
          if (!present) {
            record.state = 'done'
          } else if (!record.inFlight) {
            send(key, record)
          }
        }
      }
      if (!inputRequired) {
        return
      }
      for (const [key, request] of Object.entries(requests)) {
        if (!records.has(key)) {
          start(key, request)
        }
      }
    },
    abortAll() {
      for (const [key, record] of records) {
        if (record.state === 'asking') {
          withdraw(key, record)
        }
      }
    },
    async settled() {
      while (inFlight.size > 0) {
        await Promise.all(inFlight)
      }
    },
  }
}
