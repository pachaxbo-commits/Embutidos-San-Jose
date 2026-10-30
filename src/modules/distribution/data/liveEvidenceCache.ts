/** Scoped to one query/tenant. Evidence stays live; removed references release listeners. */
export function createLiveEvidenceCache<T>(watch: (id: string, next: (value: T | undefined) => void, error: (error: Error) => void) => () => void, changed: () => void) {
  const entries = new Map<string, { value: Promise<T | undefined>; stop: () => void }>()
  let disposed = false
  return {
    get(id: string): Promise<T | undefined> {
      const existing = entries.get(id)
      if (existing) return existing.value
      let resolve!: (value: T | undefined) => void
      let reject!: (error: Error) => void
      const entry = { value: new Promise<T | undefined>((yes, no) => { resolve = yes; reject = no }), stop: () => {} }
      entries.set(id, entry)
      let initial = true
      entry.stop = watch(id, value => {
        if (disposed || entries.get(id) !== entry) return
        entry.value = Promise.resolve(value)
        resolve(value)
        if (!initial) changed()
        initial = false
      }, error => {
        if (disposed || entries.get(id) !== entry) return
        // Retain the rejected result until the listener recovers; never emit stale evidence.
        const failed = Promise.reject<T | undefined>(error)
        void failed.catch(() => {})
        entry.value = failed
        reject(error)
        if (!initial) changed()
        initial = false
      })
      return entry.value
    },
    retain(ids: Set<string>) {
      for (const [id, entry] of entries) if (!ids.has(id)) { entries.delete(id); entry.stop() }
    },
    dispose() {
      disposed = true
      for (const entry of entries.values()) entry.stop()
      entries.clear()
    },
  }
}
