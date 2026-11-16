// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "next-auth";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StaffApp } from "@/components/staff-app";
import { AdminApp } from "@/components/admin-app";
import { overview, store } from "../fixtures/admin-core";
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/components/barcode-scanner", () => ({ BarcodeScanner: () => null }));
vi.mock("@/lib/offline", () => ({ cacheStaffPayload: vi.fn(async () => undefined), getCachedStaffPayload: vi.fn(async () => null), offlineQueueCount: vi.fn(async () => 0), flushOfflineMutations: vi.fn(async () => ({ remaining: 0, conflicts: [] })), enqueueMutation: vi.fn(), markCachedStaffNotificationsRead: vi.fn() }));
let onRemoteChange: () => Promise<unknown>;
vi.mock("@/lib/use-store-change-polling", () => ({ useStoreChangePolling: ({ onChange }: { onChange: () => Promise<unknown> }) => { onRemoteChange = onChange; } }));
const user = { id: "user", name: "Demo", role: "ADMIN", storeIds: ["store", "other"], defaultStoreId: "store" } as Session["user"];
let root: Root; let host: HTMLDivElement;
const stores = [store, { ...store, id: "other", code: "OTHER", name: "Cửa hàng khác" }];
function payload(role: string, selectedStoreId: string, address: string) {
  const currentStores = stores.map(s => s.id === selectedStoreId ? { ...s, address } : s);
  return role === "ADMIN" ? { ...overview, selectedStoreId, stores: currentStores } : { stores: currentStores, selectedStoreId, tasks: [], inventories: [], notifications: [], recentEvents: [], metrics: {} };
}
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); }
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each(["STAFF", "ADMIN"])("%s coalesces concurrent reloads and ignores an old store response", async role => {
  const pending: { storeId: string; finish: (response: Response) => void; signal: AbortSignal | null | undefined }[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => new Promise<Response>(finish => pending.push({ storeId: new URL(url, "http://localhost").searchParams.get("storeId")!, finish, signal: init?.signal }))));
  await act(async () => root.render(<StrictMode>{role === "STAFF" ? <StaffApp user={{ ...user, role: "STAFF" }} /> : <AdminApp user={user} />}</StrictMode>)); await tick();
  expect(pending).toHaveLength(1);
  await act(async () => pending[0].finish(Response.json(payload(role, "store", "Original"))));
  await act(async () => { void onRemoteChange(); void onRemoteChange(); }); expect(pending).toHaveLength(2);
  const oldRefresh = onRemoteChange;
  const select = host.querySelector(".store-selector select") as HTMLSelectElement;
  await act(async () => { select.value = "other"; select.dispatchEvent(new Event("change", { bubbles: true })); }); await tick();
  expect(pending).toHaveLength(3); expect(pending[1].signal?.aborted).toBe(true);
  await act(async () => pending[2].finish(Response.json(payload(role, "other", "Newest store address"))));
  await act(async () => pending[1].finish(Response.json(payload(role, "store", "STALE address"))));
  expect(host.querySelector(".workspace-header")?.textContent).toContain("Newest store address");
  expect(host.querySelector(".workspace-header")?.textContent).not.toContain("STALE address");
  await act(async () => { void oldRefresh(); }); expect(pending).toHaveLength(3);
  await act(async () => { void onRemoteChange(); }); const final = pending[3];
  await act(async () => root.render(null)); expect(final.signal?.aborted).toBe(true);
  await act(async () => final.finish(Response.json(payload(role, "other", "unmounted"))));
});
it.each(["STAFF", "ADMIN"])("%s queues one authoritative refresh when a remote token changes during an older load", async role => {
  const pending: ((response: Response) => void)[] = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(finish => pending.push(finish))));
  await act(async () => root.render(role === "STAFF" ? <StaffApp user={{ ...user, role: "STAFF" }} /> : <AdminApp user={user} />)); await tick();
  let changed: Promise<unknown>;
  await act(async () => { changed = onRemoteChange(); });
  expect(pending).toHaveLength(1);
  await act(async () => pending[0](Response.json(payload(role, "store", "Old snapshot"))));
  expect(pending).toHaveLength(2);
  await act(async () => pending[1](Response.json(payload(role, "store", "Remote update"))));
  await changed!;
  expect(host.querySelector(".workspace-header")?.textContent).toContain("Remote update");
});
