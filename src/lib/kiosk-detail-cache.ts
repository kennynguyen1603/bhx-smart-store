type CacheEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

export function createKioskDetailCache<T>(ttlMs = 60_000) {
  const entries = new Map<string, CacheEntry<T>>();

  function get(key: string, loader: () => Promise<T>) {
    const now = Date.now();
    const cached = entries.get(key);
    if (cached && cached.expiresAt > now) return cached.promise;

    const promise = loader().catch((error) => {
      if (entries.get(key)?.promise === promise) entries.delete(key);
      throw error;
    });
    entries.set(key, { expiresAt: now + ttlMs, promise });
    return promise;
  }

  return {
    get,
    prefetch: get,
    clearStore(storeCode: string) {
      for (const key of entries.keys()) {
        if (key.split(":").includes(storeCode)) entries.delete(key);
      }
    },
    clear() {
      entries.clear();
    },
  };
}
