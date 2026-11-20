// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaffApp } from "@/components/staff-app";
import type { TaskSummary } from "@/components/esl-scanner-modal";
import { enqueueMutation } from "@/lib/offline";

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/components/barcode-scanner", () => ({ BarcodeScanner: () => null }));
vi.mock("@/lib/offline", () => ({
  cacheStaffPayload: vi.fn(async () => undefined), enqueueMutation: vi.fn(async () => undefined),
  markCachedStaffNotificationsRead: vi.fn(async () => undefined),
  flushOfflineMutations: vi.fn(async () => ({ remaining: 0, conflicts: [] })),
  getCachedStaffPayload: vi.fn(async () => null), offlineQueueCount: vi.fn(async () => 0),
}));

const user = { id: "staff-1", name: "Nhân viên Demo", email: "staff@demo.bhx", role: "STAFF", storeIds: ["store-1"], defaultStoreId: "store-1" } as Session["user"];
const task: TaskSummary = {
  id: "task-1", type: "RESTOCK", status: "OPEN", priority: "HIGH", title: "Bổ sung sữa", note: "Kiểm tra tồn kệ",
  createdAt: "2026-11-16T00:00:00Z", completedAt: null, assignee: null,
  product: { id: "product-1", name: "Sữa tươi", emoji: "🥛", basePriceVnd: 17000 },
  shelf: { id: "shelf-1", code: "K-01", label: "Kệ sữa", esls: [{ code: "ESL-01" }] }, lot: null,
  inventory: { id: "inventory-1", onShelf: 2, backroom: 10, capacity: 12, lowThreshold: 3, version: 4, product: { id: "product-1", name: "Sữa tươi", emoji: "🥛" }, shelf: { id: "shelf-1", code: "K-01", label: "Kệ sữa" } },
};
const stylesheet = readFileSync("src/app/globals.css", "utf8");
let tasks: TaskSummary[];
let container: HTMLDivElement;
let root: Root;
let style: HTMLStyleElement;
let writes: { url: string; body: Record<string, unknown> }[];
let startResponse: () => Promise<Response>;
function button(text: string) {
  const result = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text);
  expect(result, `button: ${text}`).toBeDefined(); return result!;
}
async function click(target: HTMLElement) { await act(async () => target.click()); }
/** Opens the task filter dropdown and returns its options as [label, count] pairs. */
async function openTaskFilter() {
  await click(container.querySelector<HTMLButtonElement>(".task-filter-trigger")!);
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => [option.querySelector(".task-filter-label")?.textContent, option.querySelector(".task-filter-count")?.textContent]);
}
async function chooseTaskFilter(label: string) {
  await openTaskFilter();
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.querySelector(".task-filter-label")?.textContent === label);
  expect(option, `filter option: ${label}`).toBeDefined(); await click(option!);
}
async function render(role: Session["user"]["role"] = "STAFF") {
  await act(async () => root.render(createElement(StaffApp, { user: { ...user, role } })));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.mocked(enqueueMutation).mockClear();
  tasks = [structuredClone(task)]; writes = [];
  startResponse = async () => Response.json({ task: { id: tasks[0].id, status: "IN_PROGRESS", startedAt: "2026-11-17T00:00:00Z" } });
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "POST") { writes.push({ url: String(url), body: JSON.parse(String(init.body)) }); return startResponse(); }
    return Response.json({ stores: [{ id: "store-1", code: "BHX-01", name: "BHX Demo", address: "123 Demo" }], selectedStoreId: "store-1", tasks, inventories: [], notifications: [], recentEvents: [], metrics: { openTasks: 1, highPriority: 1, lowShelves: 1, fefoTasks: 0, completionRate: 0 } });
  }));
  style = document.createElement("style"); style.textContent = stylesheet; document.head.append(style);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); style.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("deliberate staff task interaction", () => {
  it.each(["STAFF", "MANAGER"] as const)("%s task destination selects details without a mutation", async role => {
    await act(async () => root.render(<StaffApp user={{ ...user, role }} initialStoreId="store-1" initialTaskId="task-1" />));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(container.querySelector(".staff-task-modal h2")?.textContent).toBe("Bổ sung sữa");
    expect(writes).toEqual([]); expect(enqueueMutation).not.toHaveBeenCalled();
    if (role === "MANAGER") expect(container.querySelector(".staff-task-modal")?.textContent).not.toContain("Bắt đầu");
  });
  it("does not select a task absent from the authorized feed", async () => {
    await act(async () => root.render(<StaffApp user={user} initialTaskId="someone-elses-task" />));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(container.querySelector(".staff-task-modal")).toBeNull(); expect(writes).toEqual([]);
  });
  it.each(["OPEN", "BLOCKED"] as const)("opening %s is local inspection; explicit start sends once and updates only after success", async (status) => {
    tasks[0].status = status;
    let resolve!: (response: Response) => void;
    startResponse = () => new Promise((done) => { resolve = done; });
    await render(); await click(container.querySelector<HTMLButtonElement>(".task-row")!);
    expect(container.querySelector(".staff-task-modal h2")?.textContent).toBe("Bổ sung sữa");
    expect(writes).toEqual([]); expect(enqueueMutation).not.toHaveBeenCalled();
    const start = button("Bắt đầu");
    await act(async () => { start.click(); start.click(); });
    expect(writes).toHaveLength(1); expect(writes[0].url).toBe("/api/staff/tasks/task-1/start");
    expect(writes[0].body.clientMutationId).toEqual(expect.any(String));
    expect(start.disabled).toBe(true);
    expect(container.querySelector(".staff-task-modal .product-summary")?.textContent).toContain(status === "OPEN" ? "Mới" : "Bị chặn");
    await act(async () => resolve(Response.json({ task: { id: tasks[0].id, status: "IN_PROGRESS", startedAt: "2026-11-17T00:00:00Z" } })));
    expect(container.querySelector(".staff-task-modal .product-summary")?.textContent).toContain("Đang làm");
    expect(container.querySelector(".task-row")?.textContent).toContain("Đang làm");
    expect([...container.querySelectorAll("button")].some((item) => item.textContent === "Bắt đầu")).toBe(false);
    expect(writes).toHaveLength(1);
  });

  it.each(["OPEN", "BLOCKED", "IN_PROGRESS"] as const)("Manager can inspect %s without execution controls", async (status) => {
    tasks[0].status = status;
    await render("MANAGER"); const row = container.querySelector<HTMLButtonElement>(".task-row")!;
    expect(row.disabled).toBe(false); await click(row);
    const modal = container.querySelector(".staff-task-modal")!;
    expect(modal.textContent).toContain("Chế độ chỉ xem");
    expect(modal.textContent).not.toContain("Bắt đầu"); expect(modal.textContent).not.toContain("Xác nhận bổ sung");
    expect(writes).toEqual([]); expect(enqueueMutation).not.toHaveBeenCalled();
  });

  it("retains inspect state and allows retry after start is rejected", async () => {
    startResponse = async () => Response.json({ error: { message: "Nhiệm vụ đã được nhận" } }, { status: 409 });
    await render(); await click(container.querySelector<HTMLButtonElement>(".task-row")!); await click(button("Bắt đầu"));
    expect(container.querySelector(".staff-task-modal .product-summary")?.textContent).toContain("Mới");
    expect(button("Bắt đầu").disabled).toBe(false); expect(container.textContent).toContain("Nhiệm vụ đã được nhận");
  });

  it("places staff toast at the top-right and lets staff dismiss it", async () => {
    startResponse = async () => Response.json({ error: { message: "Nhiệm vụ đã được nhận" } }, { status: 409 });
    await render(); await click(container.querySelector<HTMLButtonElement>(".task-row")!); await click(button("Bắt đầu"));
    const stack = container.querySelector<HTMLElement>(".toast-stack")!;
    const stackStyle = getComputedStyle(stack);
    expect(stackStyle.position).toBe("fixed");
    expect(stackStyle.top).toBe("20px");
    expect(stackStyle.right).toBe("20px");
    expect(stackStyle.bottom).toBe("auto");
    const close = container.querySelector<HTMLButtonElement>('[aria-label="Đóng thông báo"]')!;
    expect(close).not.toBeNull();
    expect(parseFloat(getComputedStyle(close).minHeight)).toBeGreaterThanOrEqual(44);
    await click(close);
    expect(container.querySelector(".toast-stack")).toBeNull();
  });

  it("keeps offline start queued through the existing mutation contract", async () => {
    await render(); await click(container.querySelector<HTMLButtonElement>(".task-row")!);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await click(button("Bắt đầu"));
    expect(writes).toEqual([]);
    expect(enqueueMutation).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: "/api/staff/tasks/task-1/start", method: "POST", body: { clientMutationId: expect.any(String) } }));
    expect(container.textContent).toContain("Đã lưu thao tác offline");
    expect(container.querySelector(".staff-task-modal .product-summary")?.textContent).toContain("Mới");
  });

  // Catches treating superseded FEFO work as a new markdown instead of acknowledging closure.
  it("closes superseded FEFO details, reloads tasks and explains why the task was closed", async () => {
    tasks = [{ ...structuredClone(task), type: "FEFO", title: "Dán nhãn FEFO sữa", inventory: null, lot: { batchCode: "LOT-FEFO-01", expiryDate: "2026-11-20T00:00:00Z", quantity: 4, origin: "Việt Nam", markdownPercent: 30, supplier: { name: "Nhà cung cấp Demo" } } }];
    startResponse = async () => {
      const id = tasks[0].id;
      tasks = [];
      return Response.json({ resolution: "ALREADY_APPLIED", task: { id, status: "CANCELLED", note: "Không cần xử lý: lô đã giảm 30%, bằng hoặc cao hơn quy tắc 20%." }, lot: { id: "lot-1", status: "MARKED_DOWN", markdownPercent: 30, markdownPriceVnd: 11900 } });
    };
    await render();
    await click(container.querySelector<HTMLButtonElement>(".task-row")!);
    expect(container.querySelector(".staff-task-modal h2")?.textContent).toBe("Dán nhãn FEFO sữa");
    await click(button("Xác nhận đã dán nhãn"));
    expect(writes).toEqual([{ url: "/api/staff/tasks/task-1/fefo", body: { clientMutationId: expect.any(String) } }]);
    expect(container.querySelector(".staff-task-modal")).toBeNull();
    expect(container.querySelector(".task-row")).toBeNull();
    expect(container.querySelector(".toast")?.textContent).toContain("Nhiệm vụ đã được đóng vì lô đã có mức giảm giá phù hợp.");
    expect(container.querySelector(".toast")?.textContent).not.toContain("Đã áp dụng nhãn FEFO.");
  });

  it("renders all five Vietnamese status badges alongside priority", async () => {
    tasks = (["OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"] as const).map((status) => ({ ...task, id: status, title: status, status }));
    await render(); await click(container.querySelectorAll<HTMLButtonElement>(".side-nav button")[1]);
    expect(container.querySelectorAll(".task-row")).toHaveLength(3);
    expect(await openTaskFilter()).toEqual([["Đang mở", "3"], ["Bổ sung hàng", "5"], ["FEFO", "0"], ["Cách ly", "0"], ["Hoàn thành", "1"]]);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await chooseTaskFilter("Bổ sung hàng");
    expect(container.querySelector(".task-filter-trigger")?.textContent).toBe("Bổ sung hàng5");
    const rows = [...container.querySelectorAll(".task-row")];
    expect(rows).toHaveLength(5);
    const variants = new Set<string | undefined>();
    rows.forEach((row, index) => {
      const badge = row.querySelector('[data-slot="badge"]');
      expect(badge?.textContent).toBe(["Mới", "Đang làm", "Bị chặn", "Hoàn thành", "Đã huỷ"][index]);
      variants.add((badge as HTMLElement)?.dataset.variant);
      expect(row.textContent).toContain("Cao");
    });
    expect(variants.size).toBe(5);
  });
});
