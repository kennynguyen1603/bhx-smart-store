// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "next-auth";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminApp } from "@/components/admin-app";
import { referenceOverview } from "../fixtures/admin-reference";
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/components/logo", () => ({ Logo: () => null }));
const user = { id: "admin", name: "Admin", role: "ADMIN", storeIds: ["store"], defaultStoreId: "store" } as Session["user"];
const row = { id: "n1", type: "TASK_COMPLETED", title: "Đã hoàn thành bổ sung", body: "Kệ đã đầy", readAt: null, createdAt: "2026-11-17T00:00:00Z", taskId: "t1" };
let host: HTMLDivElement, root: Root, data: typeof referenceOverview & { notifications: typeof row[] };
let write: () => Promise<Response>, fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  data = { ...structuredClone(referenceOverview), notifications: [row, { ...row, id: "n2", title: "Task bị chặn" }] };
  write = async () => Response.json({ readAt: "2026-11-17T01:00:00Z" });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/store-changes")) return Response.json({ token: "base" });
    if (init?.method === "PATCH") return write();
    return Response.json(data);
  });
  vi.stubGlobal("fetch", fetchMock); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount(role = "ADMIN") {
  await act(async () => root.render(<AdminApp user={{ ...user, role: role as "ADMIN" | "MANAGER" }} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const bell = host.querySelector<HTMLButtonElement>(".notification-button"); expect(bell).not.toBeNull();
  await act(async () => bell!.click()); return bell!;
}
it.each(["ADMIN", "MANAGER"])("%s uses shared center and reads one notification while preserving another", async role => {
  const bell = await mount(role); expect(bell.textContent).toBe("2");
  await act(async () => document.querySelector<HTMLButtonElement>('.notification-row button[aria-label="Đánh dấu đã đọc"]')!.click());
  expect(bell.textContent).toBe("1");
  expect(JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")![1]?.body))).toEqual({ storeId: "store", ids: ["n1"] });
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Tải lại dữ liệu"]')!.click());
  expect(bell.textContent).toBe("1");
});
it("rolls back the selected row and supports mark-all retry", async () => {
  const bell = await mount(); write = async () => new Response(null, { status: 503 });
  await act(async () => document.querySelector<HTMLButtonElement>('.notification-row button[aria-label="Đánh dấu đã đọc"]')!.click());
  expect(bell.textContent).toBe("2");
  write = async () => Response.json({ readAt: "2026-11-17T01:00:00Z" });
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent === "Đánh dấu tất cả đã đọc")!.click());
  expect(bell.textContent).toBe("");
});

it("does not restore another store after a pending read fails", async () => {
  let finish!: (response: Response) => void;
  write = () => new Promise(resolve => { finish = resolve; });
  await mount();
  await act(async () => document.querySelector<HTMLButtonElement>('.notification-row button[aria-label="Đánh dấu đã đọc"]')!.click());
  data = { ...data, selectedStoreId: "store-other", notifications: [{ ...row, id: "other", title: "Thông báo cửa hàng khác" }] };
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>(".store-selector select")!;
    select.value = "store-other"; select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  await act(async () => finish(new Response(null, { status: 503 })));
  await act(async () => host.querySelector<HTMLButtonElement>(".notification-button")!.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Thông báo cửa hàng khác");
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Đã hoàn thành bổ sung");
});
it("rejects a stale overview completed after a successful individual read", async () => {
  const bell = await mount();
  let finish!: (response: Response) => void;
  const stale = structuredClone(data);
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Tải lại dữ liệu"]')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('.notification-row button[aria-label="Đánh dấu đã đọc"]')!.click());
  expect(bell.textContent).toBe("1");
  await act(async () => finish(Response.json(stale)));
  expect(bell.textContent).toBe("1");
});
