"use client";

import { useEffect, useRef } from "react";

export type StoreChangeSnapshot = {
  token: string;
  taskUpdatedAt: string | null;
  notificationUpdatedAt: string | null;
  unreadCount: number;
};

export function useStoreChangePolling({ storeId, onChange, intervalMs = 4_000 }: {
  storeId: string;
  onChange(snapshot: StoreChangeSnapshot): void | Promise<void>;
  intervalMs?: number;
}): void {
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => {
    if (!storeId) return;
    let disposed = false;
    let pending = false;
    let previousToken: string | undefined;
    let controller: AbortController | undefined;
    async function check() {
      if (disposed || pending || document.visibilityState !== "visible") return;
      pending = true;
      controller = new AbortController();
      try {
        const response = await fetch(`/api/store-changes?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const snapshot = await response.json() as StoreChangeSnapshot;
        if (disposed || typeof snapshot.token !== "string") return;
        const changed = previousToken !== undefined && snapshot.token !== previousToken;
        previousToken = snapshot.token;
        if (changed) await onChangeRef.current(snapshot);
      } catch {
        // Offline and transient failures retry on the next visible check.
      } finally {
        pending = false;
      }
    }
    const refresh = () => { void check(); };
    // Deferring the baseline avoids a duplicate fetch during StrictMode setup/cleanup.
    const baseline = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, intervalMs);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearTimeout(baseline);
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [storeId, intervalMs]);
}
