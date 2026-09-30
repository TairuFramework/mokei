import { createMemoryTaskStore, type TaskRecord, type TaskStore } from '../../src/task-store.js'

/** Seeded PRNG, so a failing seed replays the same schedule. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function flush(): Promise<void> {
  // setImmediate runs after every queued microtask, so continuations of a released op settle.
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * An in-memory store whose `get`, `update` and `delete` calls wait in a queue until `drain`
 * releases them in seeded random order. Revision conflicts come from the reordering itself.
 */
export function createScheduledStore(seed: number): {
  store: TaskStore
  commits: Array<TaskRecord>
  drain(): Promise<void>
} {
  const base = createMemoryTaskStore()
  const random = mulberry32(seed)
  const queue: Array<() => void> = []
  const commits: Array<TaskRecord> = []

  function schedule<T>(run: () => Promise<T>): Promise<T> {
    const { promise, resolve, reject } = Promise.withResolvers<T>()
    queue.push(() => {
      run().then(resolve, reject)
    })
    return promise
  }

  const store: TaskStore = {
    create: (record) => base.create(record),
    list: (filter) => base.list(filter),
    get: (taskID) => schedule(() => base.get(taskID)),
    update: (taskID, patch, expected) =>
      schedule(async () => {
        const updated = await base.update(taskID, patch, expected)
        commits.push(structuredClone(updated))
        return updated
      }),
    delete: (taskID) => schedule(() => base.delete(taskID)),
  }

  return {
    store,
    commits,
    async drain() {
      await flush()
      while (queue.length > 0) {
        const [release] = queue.splice(Math.floor(random() * queue.length), 1)
        release?.()
        await flush()
      }
    },
  }
}
