/**
 * An async key-value store. Implementations decide where values live; every method may cross a
 * process boundary, so callers must not assume a value read is still current unless they read it
 * inside {@link KeyValueStore.update}.
 */
export type KeyValueStore<V> = {
  get(key: string): Promise<V | undefined>
  set(key: string, value: V): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<Array<string>>
  /**
   * Atomic read-decide-write on one key. `fn` receives the current value and returns the next
   * one, or `undefined` to delete it. Returning `current` itself writes nothing. If `fn` throws,
   * nothing is written and the error propagates. No other `set`, `delete` or `update` of the
   * key, through this store or any other store sharing its backing, runs while `fn` does.
   * Resolves to the value the key holds afterwards.
   */
  update(
    key: string,
    fn: (current: V | undefined) => V | undefined | Promise<V | undefined>,
  ): Promise<V | undefined>
}

/** An in-memory {@link KeyValueStore}. `update` is serialised per key within this store. */
export function createMemoryStore<V>(): KeyValueStore<V> {
  const map = new Map<string, V>()
  // Tail of each key's chain of pending writes.
  const tails = new Map<string, Promise<unknown>>()

  function serialise<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve()
    const result = previous.then(run, run)
    const tail = result.then(
      () => {},
      () => {},
    )
    tails.set(key, tail)
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key)
    })
    return result
  }

  return {
    async get(key) {
      return map.get(key)
    },
    set(key, value) {
      return serialise(key, async () => {
        map.set(key, value)
      })
    },
    delete(key) {
      return serialise(key, async () => {
        map.delete(key)
      })
    },
    async keys() {
      return [...map.keys()]
    },
    update(key, fn) {
      return serialise(key, async () => {
        const current = map.get(key)
        const next = await fn(current)
        if (next === current) return current
        if (next === undefined) map.delete(key)
        else map.set(key, next)
        return next
      })
    },
  }
}
