"use client";

import Dexie, { type EntityTable } from "dexie";

export type OfflineMutation = {
  id: string;
  url: string;
  method: "POST" | "PUT" | "DELETE";
  body: Record<string, unknown>;
  createdAt: number;
};

type StaffCache = { storeId: string; payload: unknown; updatedAt: number };

const db = new Dexie("bhx-smart-store") as Dexie & {
  mutations: EntityTable<OfflineMutation, "id">;
  staffCache: EntityTable<StaffCache, "storeId">;
};

db.version(1).stores({ mutations: "id,createdAt", staffCache: "storeId,updatedAt" });

export async function cacheStaffPayload(storeId: string, payload: unknown) {
  await db.staffCache.put({ storeId, payload, updatedAt: Date.now() });
}

export async function getCachedStaffPayload<T>(storeId: string) {
  return (await db.staffCache.get(storeId))?.payload as T | undefined;
}

export async function enqueueMutation(mutation: OfflineMutation) {
  await db.mutations.put(mutation);
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    const registration = await navigator.serviceWorker.ready;
    await (registration as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync.register("bhx-sync").catch(() => undefined);
  }
}

export async function flushOfflineMutations() {
  const queued = await db.mutations.orderBy("createdAt").toArray();
  const conflicts: OfflineMutation[] = [];
  for (const item of queued) {
    try {
      const response = await fetch(item.url, { method: item.method, headers: { "content-type": "application/json" }, body: JSON.stringify(item.body) });
      if (response.ok || response.status === 409 || response.status === 422) {
        await db.mutations.delete(item.id);
        if (response.status === 409) conflicts.push(item);
      } else if (response.status >= 400 && response.status < 500) {
        await db.mutations.delete(item.id);
      } else break;
    } catch {
      break;
    }
  }
  return { remaining: await db.mutations.count(), conflicts };
}

export async function offlineQueueCount() {
  return db.mutations.count();
}
