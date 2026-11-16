// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "next-auth";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminApp } from "@/components/admin-app";
import { ReferenceReadOnly } from "@/components/admin/forms/core-form";
import { toast } from "@/components/ui/sonner";
import { referenceOverview, referenceStore, secondProduct, shelf, lot } from "../fixtures/admin-reference";
const user: Session["user"] = { id: "admin", name: "Admin", role: "ADMIN", storeIds: ["store"], defaultStoreId: "store" };
const task = { id: "task-1", title: "Bổ sung sản phẩm", type: "RESTOCK", status: "OPEN", priority: "HIGH", product: secondProduct, shelf, lot, assignee: { id: "staff", name: "Nhân viên An" }, createdAt: "2026-11-16T01:00:00Z", updatedAt: "2026-11-16T01:00:00Z", dueAt: null, completedAt: null, note: "Giao ca" };
let host: HTMLDivElement, root: Root;
let writes: { url: string; method: string; body: unknown }[];
let write: () => Promise<Response>;
const baseData = { ...referenceOverview, tasks: [task, { ...task, id: "task-done", title: "Đã xong", status: "COMPLETED", completedAt: "2026-11-16T03:00:00Z" }], taskReferences: { products: [secondProduct], shelves: [{ id: shelf.id, name: shelf.label, productIds: [secondProduct.id] }], lots: [{ id: lot.id, name: lot.batchCode, productId: secondProduct.id }], assignees: [{ id: "staff", name: "Nhân viên An" }] } };
let data = structuredClone(baseData);
beforeEach(() => {
  data = structuredClone(baseData);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubEnv("TZ", "UTC");
  writes = []; write = async () => Response.json({ task }, { status: 201 });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (!init?.method) return Response.json(data);
    writes.push({ url, method: init.method, body: JSON.parse(String(init.body)) }); return write();
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => { toast.dismiss(); root.unmount(); }); host.remove(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function dialog() { const el = document.querySelector<HTMLElement>('[role="dialog"]'); expect(el).not.toBeNull(); return el!; }
function field(label: string, parent: ParentNode = dialog()) { const el = [...parent.querySelectorAll<HTMLLabelElement>("label")].find(el => el.textContent === label); expect(el, label).toBeDefined(); return document.getElementById(el!.htmlFor) as HTMLInputElement; }
async function click(name: string, parent: ParentNode = document) { const button = [...parent.querySelectorAll<HTMLButtonElement>("button")].find(el => (el.getAttribute("aria-label") || el.textContent) === name); expect(button, name).toBeDefined(); await act(async () => button!.click()); }
async function select(name: string, option: string, parent?: ParentNode) { await act(async () => field(name, parent).click()); const el = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.textContent === option); expect(el, option).toBeDefined(); await act(async () => el!.click()); }
async function fill(name: string, value: string) { const el = field(name); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function mount(role: "ADMIN" | "MANAGER" = "ADMIN") { await act(async () => root.render(<AdminApp user={{ ...user, role }} />)); await act(async () => { await new Promise(done => setTimeout(done, 20)); }); await click("Nhiệm vụ"); }
async function submit() { await act(async () => { dialog().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }
it("resolves immutable references by name and masks unavailable references", async () => {
  await act(async () => root.render(<><ReferenceReadOnly label="Cửa hàng" value="raw-store" options={[{ id: "raw-store", name: "Cửa hàng chính" }]} /><ReferenceReadOnly label="Sản phẩm" value="raw-product" options={[]} /></>));
  expect([...host.querySelectorAll<HTMLInputElement>("input")].map(el => el.value)).toEqual(["Cửa hàng chính", "Không còn khả dụng"]);
  expect(host.innerHTML).not.toContain("raw-store"); expect(host.innerHTML).not.toContain("raw-product");
});
it("creates by names via only the task POST and retains values across server errors", async () => {
  await mount(); await click("Giao nhiệm vụ"); expect(field("Cửa hàng").value).toBe(referenceStore.name);
  await submit(); expect(writes).toHaveLength(0);
  await select("Loại nhiệm vụ", "FEFO"); await select("Sản phẩm", secondProduct.name); await select("Kệ", shelf.label); await select("Lô hàng", lot.batchCode); await select("Người nhận", "Nhân viên An"); await select("Độ ưu tiên", "Cao");
  expect(field("Hạn hoàn thành").type).toBe("datetime-local"); await fill("Hạn hoàn thành", "2030-01-02T10:00"); await fill("Ghi chú", "Kiểm tra ca");
  write = async () => Response.json({ error: { message: "Không thể giao việc" } }, { status: 500 }); await submit();
  await act(async () => { await new Promise(done => setTimeout(done, 20)); }); expect(document.body.textContent).toContain("Không thể giao việc"); expect(field("Ghi chú").value).toBe("Kiểm tra ca");
  expect(writes).toEqual([{ url: "/api/admin/tasks", method: "POST", body: { storeId: "store", type: "FEFO", productId: secondProduct.id, shelfId: shelf.id, lotId: lot.id, assigneeId: "staff", priority: "HIGH", dueAt: "2030-01-02T10:00:00.000Z", note: "Kiểm tra ca" } }]);
  write = async () => Response.json({ task }, { status: 201 }); await submit(); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(writes).toHaveLength(2);
});
it("Manager monitors badges, names and completion time with filters and no execution controls", async () => {
  await mount("MANAGER"); expect(document.body.textContent).toContain("Nhân viên An"); expect(document.body.textContent).toContain(shelf.label); expect(document.body.textContent).toContain(lot.batchCode);
  expect([...host.querySelectorAll('[data-slot="badge"]')].map(el => el.textContent)).toEqual(expect.arrayContaining(["Mới", "Hoàn thành"]));
  expect(host.querySelector('time[datetime="2026-11-16T03:00:00Z"]')).not.toBeNull();
  expect(document.body.textContent).not.toContain("Bắt đầu"); expect(document.body.textContent).not.toContain("Hoàn thành nhiệm vụ");
  await select("Trạng thái", "Hoàn thành", host); expect(host.querySelectorAll("tbody tr")).toHaveLength(1); expect(host.textContent).toContain("Đã xong");
  await select("Trạng thái", "Tất cả trạng thái", host); await select("Lọc người nhận", "Chưa phân công", host); expect(host.querySelectorAll("tbody tr")).toHaveLength(0);
  expect(writes).toHaveLength(0);
});

it.each(["ADMIN", "MANAGER"] as const)("%s task destination selects the store task tab and opens only that task's details", async role => {
  await act(async () => root.render(<AdminApp user={{ ...user, role }} initialStoreId="store" initialTaskId="task-done" />));
  await act(async () => { await new Promise(done => setTimeout(done, 30)); });
  expect(host.querySelector(".admin-task-panel")).not.toBeNull();
  expect([...host.querySelectorAll("details")].filter(el => el.open).map(el => el.textContent)).toEqual([expect.stringContaining("Đã xong")]);
  expect(writes).toEqual([]); expect(host.textContent).not.toContain("Bắt đầu");
});
it("renders a focused task outside the normal Admin list cap without a write", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...data, tasks: [], focusedTask: data.tasks[1] })));
  await act(async () => root.render(<AdminApp user={user} initialStoreId="store" initialTaskId="task-done" />));
  await act(async () => { await new Promise(done => setTimeout(done, 30)); });
  expect(host.querySelector('tr[aria-current="true"] details[open]')?.textContent).toContain("Đã xong");
  expect(writes).toEqual([]);
});

it("submits an unassigned task with optional fields omitted", async () => {
  await mount(); await click("Giao nhiệm vụ"); await select("Loại nhiệm vụ", "Bổ sung hàng"); await select("Sản phẩm", secondProduct.name); await select("Kệ", shelf.label); await select("Độ ưu tiên", "Bình thường"); await submit();
  expect(writes).toEqual([{ url: "/api/admin/tasks", method: "POST", body: { storeId: "store", type: "RESTOCK", productId: secondProduct.id, shelfId: shelf.id, priority: "NORMAL" } }]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("clears shelf and lot when the product changes so stale references are never sent", async () => {
  data.taskReferences.products.push({ ...secondProduct, id: "other-product", name: "Sản phẩm khác" });
  data.taskReferences.shelves.push({ id: "other-shelf", name: "Kệ khác", productIds: ["other-product"] });
  await mount(); await click("Giao nhiệm vụ"); await select("Loại nhiệm vụ", "FEFO"); await select("Sản phẩm", secondProduct.name); await select("Kệ", shelf.label); await select("Lô hàng", lot.batchCode); await select("Độ ưu tiên", "Cao");
  await select("Sản phẩm", "Sản phẩm khác"); expect(field("Kệ").textContent).not.toContain(shelf.label); expect(field("Lô hàng").textContent).not.toContain(lot.batchCode);
  await submit(); expect(writes).toHaveLength(0);
  await select("Kệ", "Kệ khác"); await submit();
  expect(writes[0].body).toEqual({ storeId: "store", type: "FEFO", productId: "other-product", shelfId: "other-shelf", priority: "HIGH" });
});
