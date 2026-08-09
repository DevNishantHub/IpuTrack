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
  }
}
