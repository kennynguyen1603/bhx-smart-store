// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "next-auth";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StaffApp } from "@/components/staff-app";
import { AdminApp } from "@/components/admin-app";
import { flushOfflineMutations, getCachedStaffPayload, offlineQueueCount } from "@/lib/offline";
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
beforeEach(() => { vi.clearAllMocks(); vi.mocked(offlineQueueCount).mockResolvedValue(0); vi.mocked(flushOfflineMutations).mockResolvedValue({ remaining: 0, conflicts: [] }); vi.mocked(getCachedStaffPayload).mockResolvedValue(null); vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"); vi.spyOn(navigator, "onLine", "get").mockReturnValue(true); vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each(["STAFF", "ADMIN"])("%s coalesces concurrent reloads and ignores an old store response", async role => {
  const pending: { storeId: string; finish: (response: Response) => void; signal: AbortSignal | null | undefined }[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => new Promise<Response>(finish => pending.push({ storeId: new URL(url, "http://localhost").searchParams.get("storeId")!, finish, signal: init?.signal }))));
  await act(async () => root.render(<StrictMode>{role === "STAFF" ? <StaffApp user={{ ...user, role: "STAFF" }} /> : <AdminApp user={user} />}</StrictMode>)); await tick();
  expect(pending).toHaveLength(1);
  await act(async () => pending[0].finish(Response.json(payload(role, "store", "Original"))));
  await act(async () => { void onRemoteChange().catch(() => undefined); void onRemoteChange().catch(() => undefined); }); expect(pending).toHaveLength(2);
  const oldRefresh = onRemoteChange;
  const select = host.querySelector(".store-selector select") as HTMLSelectElement;
  await act(async () => { select.value = "other"; select.dispatchEvent(new Event("change", { bubbles: true })); }); await tick();
  expect(pending).toHaveLength(3); expect(pending[1].signal?.aborted).toBe(true);
  await act(async () => pending[2].finish(Response.json(payload(role, "other", "Newest store address"))));
  await act(async () => pending[1].finish(Response.json(payload(role, "store", "STALE address"))));
  expect(host.querySelector(".workspace-header")?.textContent).toContain("Newest store address");
  expect(host.querySelector(".workspace-header")?.textContent).not.toContain("STALE address");
  await act(async () => { void oldRefresh().catch(() => undefined); }); expect(pending).toHaveLength(3);
  await act(async () => { void onRemoteChange().catch(() => undefined); }); const final = pending[3];
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

it.each(["STAFF", "ADMIN"])("%s propagates refresh failure and rejects a stale refresh acknowledgement", async role => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload(role, "store", "Initial"))));
  await act(async () => root.render(role === "STAFF" ? <StaffApp user={{ ...user, role: "STAFF" }} /> : <AdminApp user={user} />)); await tick();
  if (role === "STAFF") vi.mocked(getCachedStaffPayload).mockResolvedValue(payload(role, "store", "Cached offline"));
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 503 }));
  await act(async () => { await expect(onRemoteChange()).rejects.toThrow(); });
  if (role === "STAFF") expect(host.querySelector(".workspace-header")?.textContent).toContain("Cached offline");
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(done => { finish = done; }));
  let pending!: Promise<unknown>; await act(async () => { pending = onRemoteChange(); });
  const rejection = expect(pending).rejects.toThrow();
  const select = host.querySelector(".store-selector select") as HTMLSelectElement;
  await act(async () => { select.value = "other"; select.dispatchEvent(new Event("change", { bubbles: true })); }); await tick();
  await act(async () => finish(Response.json(payload(role, "store", "Stale")))); await rejection;
  expect(host.querySelector(".workspace-header")?.textContent).not.toContain("Stale");
});
it("flushes an online startup queue and retries it on visible focus without overlapping flushes", async () => {
  vi.mocked(offlineQueueCount).mockResolvedValue(1);
  vi.mocked(flushOfflineMutations).mockResolvedValueOnce({ remaining: 1, conflicts: [] });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload("STAFF", "store", "Online"))));
  await act(async () => root.render(<StrictMode><StaffApp user={{ ...user, role: "STAFF" }} /></StrictMode>)); await tick();
  expect(flushOfflineMutations).toHaveBeenCalledTimes(1);
  let finish!: (value: { remaining: number; conflicts: [] }) => void;
  vi.mocked(flushOfflineMutations).mockImplementationOnce(() => new Promise(done => { finish = done; }));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  expect(flushOfflineMutations).toHaveBeenCalledTimes(1);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); });
  expect(flushOfflineMutations).toHaveBeenCalledTimes(2);
  vi.mocked(offlineQueueCount).mockResolvedValue(0);
  await act(async () => finish({ remaining: 0, conflicts: [] }));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(flushOfflineMutations).toHaveBeenCalledTimes(2);
});
it.each(["STAFF", "ADMIN"])("%s defers a polling follow-up queued behind bootstrap if the tab becomes hidden", async role => {
  const pending: ((response: Response) => void)[] = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(finish => pending.push(finish))));
  await act(async () => root.render(role === "STAFF" ? <StaffApp user={{ ...user, role: "STAFF" }} /> : <AdminApp user={user} />)); await tick();
  let change!: Promise<unknown>; await act(async () => { change = onRemoteChange(); });
  const rejection = expect(change).rejects.toThrow();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => pending[0](Response.json(payload(role, "store", "Bootstrap"))));
  expect(pending).toHaveLength(1); await rejection;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => { change = onRemoteChange(); }); expect(pending).toHaveLength(2);
  await act(async () => pending[1](Response.json(payload(role, "store", "Visible refresh")))); await change;
});
it("remembers a visible queue retry requested while a failed flush is still in flight", async () => {
  vi.mocked(offlineQueueCount).mockResolvedValue(1);
  let finish!: (value: { remaining: number; conflicts: [] }) => void;
  vi.mocked(flushOfflineMutations).mockImplementationOnce(() => new Promise(done => { finish = done; }));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload("STAFF", "store", "Online"))));
  await act(async () => root.render(<StaffApp user={{ ...user, role: "STAFF" }} />)); await tick();
  expect(flushOfflineMutations).toHaveBeenCalledTimes(1);
  await act(async () => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  expect(flushOfflineMutations).toHaveBeenCalledTimes(1);
  await act(async () => finish({ remaining: 1, conflicts: [] }));
  expect(flushOfflineMutations).toHaveBeenCalledTimes(2);
});
it("defers a queue refresh waiting behind bootstrap when the tab hides", async () => {
  vi.mocked(offlineQueueCount).mockResolvedValue(1);
  const pending: ((response: Response) => void)[] = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(finish => pending.push(finish))));
  await act(async () => root.render(<StaffApp user={{ ...user, role: "STAFF" }} />)); await tick();
  expect(flushOfflineMutations).toHaveBeenCalledTimes(1); expect(pending).toHaveLength(1);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => pending[0](Response.json(payload("STAFF", "store", "Bootstrap"))));
  expect(pending).toHaveLength(1);
});
