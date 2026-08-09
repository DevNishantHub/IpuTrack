const store = new Map<string, string>()

export default {
  getItem: async (key: string) => store.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    store.set(key, value)
  },
  removeItem: async (key: string) => {
    store.delete(key)
  },
  multiRemove: async (keys: string[]) => {
    keys.forEach(k => store.delete(k))
  },
  // Not part of every real AsyncStorage call site in the app, but useful
  // for tests to reset the mock's in-memory state between cases so one
  // test's writes can't leak into the next.
  clear: async () => {
    store.clear()
  },
  getAllKeys: async () => Array.from(store.keys())
}
