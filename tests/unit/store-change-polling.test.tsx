// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStoreChangePolling } from "@/lib/use-store-change-polling";
let root: Root;
let host: HTMLDivElement;
let visibility: DocumentVisibilityState;
let token: string;
let respond: () => Promise<Response>;
const onChange = vi.fn();
function Probe({ storeId = "store-1", intervalMs }: { storeId?: string; intervalMs?: number }) { useStoreChangePolling({ storeId, onChange, intervalMs }); return null; }
function response(value: string) { return Response.json({ token: value, taskUpdatedAt: null, notificationUpdatedAt: null, unreadCount: 0 }); }
async function tick(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function render(storeId = "store-1", intervalMs?: number) { await act(async () => root.render(<StrictMode><Probe storeId={storeId} intervalMs={intervalMs} /></StrictMode>)); await tick(); }
async function event(type: "focus" | "visibilitychange") { await act(async () => { (type === "focus" ? window : document).dispatchEvent(new Event(type)); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); visibility = "visible"; token = "a";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  respond = async () => response(token); onChange.mockReset(); vi.stubGlobal("fetch", vi.fn(() => respond()));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("makes one StrictMode baseline and checks every four seconds without reloading unchanged data", async () => {
  await render(); expect(fetch).toHaveBeenCalledTimes(1); expect(onChange).not.toHaveBeenCalled();
  await tick(3999); expect(fetch).toHaveBeenCalledTimes(1); await tick(1); expect(fetch).toHaveBeenCalledTimes(2);
  token = "b"; await tick(4000); expect(onChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ token: "b" }));
  await tick(8000); expect(onChange).toHaveBeenCalledTimes(1);
});
it("makes zero hidden requests and checks immediately on visible return and focus", async () => {
  visibility = "hidden"; await render(); await tick(12000); await event("focus"); expect(fetch).not.toHaveBeenCalled();
  visibility = "visible"; await event("visibilitychange"); expect(fetch).toHaveBeenCalledTimes(1);
  token = "b"; await event("focus"); expect(fetch).toHaveBeenCalledTimes(2); expect(onChange).toHaveBeenCalledTimes(1);
  visibility = "hidden"; await event("visibilitychange"); await tick(12000); expect(fetch).toHaveBeenCalledTimes(2);
});
it("never overlaps fetches or onChange refreshes during repeated focus/visibility events", async () => {
  let finish!: (response: Response) => void; respond = () => new Promise(done => { finish = done; });
  await render(); await tick(12000); await event("focus"); await event("visibilitychange"); expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => finish(response("a"))); respond = async () => response("b");
  let refreshed!: () => void; onChange.mockImplementation(() => new Promise<void>(done => { refreshed = done; }));
  await event("focus"); await tick(8000); await event("focus"); expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => refreshed()); await tick(4000); expect(fetch).toHaveBeenCalledTimes(3); expect(onChange).toHaveBeenCalledTimes(1);
});
it("aborts and ignores obsolete responses on store change and unmount", async () => {
  const pending: ((response: Response) => void)[] = []; respond = () => new Promise(done => pending.push(done));
  await render(); const oldSignal = vi.mocked(fetch).mock.calls[0][1]?.signal;
  await render("store-2"); expect(oldSignal?.aborted).toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => pending[0](response("obsolete"))); expect(onChange).not.toHaveBeenCalled();
  await act(async () => pending[1](response("new-baseline"))); token = "new-change"; respond = async () => response(token);
  await event("focus"); expect(onChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ token }));
  await act(async () => root.render(null)); await tick(12000); await event("focus"); expect(fetch).toHaveBeenCalledTimes(3);
});
it("retries failed checks, supports custom interval, and ignores empty stores", async () => {
  await render(""); await tick(10000); expect(fetch).not.toHaveBeenCalled();
  respond = async () => { throw new TypeError("offline"); }; await render("store-1", 1000); expect(fetch).toHaveBeenCalledTimes(1);
  respond = async () => response("a"); await tick(1000); expect(fetch).toHaveBeenCalledTimes(2); expect(onChange).not.toHaveBeenCalled();
  respond = async () => Response.json({}, { status: 503 }); await tick(1000); token = "b"; respond = async () => response(token); await tick(1000); expect(onChange).toHaveBeenCalledTimes(1);
});
