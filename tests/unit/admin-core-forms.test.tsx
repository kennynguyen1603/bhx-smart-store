// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApp } from "@/components/admin-app";
import { toast } from "@/components/ui/sonner";

const user: Session["user"] = { id: "admin", name: "Quản trị", role: "ADMIN", storeIds: ["store"], defaultStoreId: "store" };
import { store, product, supplier, overview } from "../fixtures/admin-core";
let root: Root;
let host: HTMLDivElement;
let writes: { url: string; method: string; body: Record<string, unknown> }[];
let readCount: number;
let failRefresh: boolean;
let write: () => Promise<Response>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("prompt", vi.fn(() => null));
  vi.stubGlobal("confirm", vi.fn(() => false));
  writes = []; readCount = 0; failRefresh = false;
  write = async () => Response.json({ id: "saved" });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/store-changes")) return Response.json({ token: "baseline", taskUpdatedAt: null, notificationUpdatedAt: null, unreadCount: 0 });
    if (!init?.method) {
      readCount++;
      if (failRefresh) throw new TypeError("Failed to fetch");
      return Response.json(overview);
    }
    writes.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
    return write();
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { toast.dismiss(); root.unmount(); });
  host.remove(); vi.unstubAllGlobals();
});
async function settle() { await act(async () => { await new Promise((done) => setTimeout(done, 20)); }); }
function button(text: string, parent: ParentNode = document) {
  const found = [...parent.querySelectorAll<HTMLButtonElement>("button")].find((el) => (el.getAttribute("aria-label") || el.textContent) === text);
  expect(found, `button ${text}`).toBeDefined(); return found!;
}
function dialog() { const el = document.querySelector<HTMLElement>('[role="dialog"]'); expect(el, "core editor uses an application dialog").not.toBeNull(); return el!; }
function input(label: string) {
  const node = [...dialog().querySelectorAll("label")].find((el) => el.textContent === label);
  expect(node, `label ${label}`).toBeDefined();
  const el = document.getElementById(node!.htmlFor) as HTMLInputElement;
  expect(el).not.toBeNull(); return el;
}
async function setInput(label: string, value: string) {
  const el = input(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function open(kind: string, mode = "edit") {
  await act(async () => root.render(<AdminApp user={user} />)); await settle();
  if (kind === "product" || kind === "supplier") await act(async () => button("Danh mục").click());
  if (kind === "supplier") await act(async () => button("Nhà cung cấp").click());
  if (mode === "create") await act(async () => button(kind === "store" ? "Thêm cửa hàng" : kind === "product" ? "Thêm sản phẩm" : "Thêm nhà cung cấp").click());
  else await act(async () => {
    if (kind === "store") button("Sửa cửa hàng").click();
    else if (kind === "supplier") button("Sửa", [...document.querySelectorAll(".log-row")].find((el) => el.textContent?.includes("SUP-02"))).click();
    else button("Sửa", document.querySelector(".data-table tbody tr")!).click();
  });
  return dialog();
}
async function submitTwice() {
  const form = dialog().querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
const cases = [
  { kind: "store", field: "Tên cửa hàng", value: "BHX cửa hàng hai", immutable: { "Mã cửa hàng": "BHX-02" }, fields: { "Địa chỉ": "123 đường số hai", "Chiều rộng bản đồ": "14", "Chiều cao bản đồ": "9" }, invalid: "", error: "Tên cửa hàng phải có ít nhất 2 ký tự", resource: "stores", body: { name: store.name, address: store.address, mapWidth: 14, mapHeight: 9, active: true } },
  { kind: "inventory", field: "Số lượng trên kệ", value: "7", immutable: {}, fields: { "Số lượng kho sau": "19", "Sức chứa kệ": "24", "Ngưỡng cảnh báo": "4" }, invalid: "-1", error: "Số lượng phải là số nguyên không âm", resource: "inventories", body: { onShelf: 7, backroom: 19, capacity: 24, lowThreshold: 4 } },
  { kind: "product", field: "Tên sản phẩm", value: "Sữa tươi hai", immutable: { "SKU": "SKU-02", "Mã vạch": "893000000002" }, fields: { "Danh mục": "Sữa tươi", "Đơn vị": "Hộp", "Giá bán": "17000", "Biểu tượng": "🥛" }, invalid: "", error: "Tên sản phẩm phải có ít nhất 2 ký tự", resource: "products", body: { name: product.name, category: product.category, unit: product.unit, basePriceVnd: 17000, emoji: "🥛" } },
  { kind: "supplier", field: "Tên nhà cung cấp", value: "Nhà cung cấp hai", immutable: { "Mã nhà cung cấp": "SUP-02" }, fields: { "Quốc gia": "Việt Nam", "Chứng nhận": "VietGAP" }, invalid: "", error: "Tên nhà cung cấp phải có ít nhất 2 ký tự", resource: "suppliers", body: { name: supplier.name, country: supplier.country, certificate: "VietGAP", active: true } },
] as const;

describe.each(cases)("Admin $kind form through its real entry point", (sample) => {
  it("populates all persisted values and makes immutable identifiers read-only", async () => {
    await open(sample.kind);
    expect(input(sample.field).value).toBe(sample.value);
    for (const [label, value] of Object.entries(sample.fields)) expect(input(label).value).toBe(value);
    for (const [label, value] of Object.entries(sample.immutable)) {
      expect(input(label).value).toBe(value); expect(input(label).readOnly).toBe(true);
    }
    expect(prompt).not.toHaveBeenCalled();
  });
  it("shows Vietnamese field errors and sends no invalid request", async () => {
    await open(sample.kind); await setInput(sample.field, sample.invalid); await submitTwice();
    expect(dialog().textContent).toContain(sample.error);
    expect(input(sample.field).getAttribute("aria-invalid")).toBe("true");
    expect(writes).toHaveLength(0);
  });
  it("preserves edited values on server failure, prevents duplicate writes, then retries explicitly", async () => {
    let release!: (value: Response) => void;
    write = () => new Promise((done) => { release = done; });
    await open(sample.kind);
    const edited = sample.kind === "inventory" ? "9" : "Thông tin vừa sửa";
    await setInput(sample.field, edited); await submitTwice();
    expect(writes).toHaveLength(1);
    expect(dialog().querySelector("fieldset")!.disabled).toBe(true);
    expect(button("Hủy", dialog()).disabled).toBe(true);
    await act(async () => release(Response.json({ error: { message: "Máy chủ từ chối cập nhật" } }, { status: 500 })));
    await settle();
    expect(input(sample.field).value).toBe(edited);
    expect(document.body.textContent).toContain("Máy chủ từ chối cập nhật");
    expect(button("Hủy", dialog()).disabled).toBe(false);
    write = async () => Response.json({ id: "saved" });
    await submitTwice();
    expect(writes).toHaveLength(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const key = sample.kind === "inventory" ? "onShelf" : "name";
    expect(writes[1]).toEqual({ url: `/api/admin/${sample.resource}/${sample.kind}`, method: "PUT", body: { ...sample.body, [key]: sample.kind === "inventory" ? 9 : edited } });
  });
});
it("rejects on-shelf quantities above capacity before PUT", async () => {
  await open("inventory"); await setInput("Số lượng trên kệ", "25"); await submitTwice();
  expect(dialog().textContent).toContain("Số lượng trên kệ không được vượt sức chứa"); expect(writes).toHaveLength(0);
});
it("disables store editing until a persisted store is available", async () => {
  let release!: (response: Response) => void;
  vi.stubGlobal("fetch", (url: string) => url.startsWith("/api/store-changes") ? Promise.resolve(Response.json({ token: "baseline", taskUpdatedAt: null, notificationUpdatedAt: null, unreadCount: 0 })) : new Promise<Response>((done) => { release = done; }));
  await act(async () => root.render(<AdminApp user={user} />)); await settle();
  expect(button("Sửa cửa hàng").disabled).toBe(true);
  await act(async () => release(Response.json(overview)));
  expect(button("Sửa cửa hàng").disabled).toBe(false);
});
it("closes after a confirmed write despite refresh failure and retries only the read", async () => {
  await open("store"); failRefresh = true;
  await submitTwice(); await settle();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(writes).toHaveLength(1);
  expect(document.body.textContent).toContain("Đã lưu thay đổi nhưng không thể tải lại dữ liệu");
  failRefresh = false;
  await act(async () => button("Tải lại dữ liệu").click());
  // Initial GET, authoritative baseline, post-write refresh, and manual retry.
  expect(readCount).toBe(4); expect(writes).toHaveLength(1);
});
it("closes immediately after write success even while the overview refresh is unresolved", async () => {
  await open("product");
  let releaseRefresh!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/store-changes")) return Response.json({ token: "baseline", taskUpdatedAt: null, notificationUpdatedAt: null, unreadCount: 0 });
    if (!init?.method) return new Promise<Response>((done) => { releaseRefresh = done; });
    writes.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
    return Response.json({ id: "saved" });
  }));
  const form = dialog().querySelector("form")!;
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(writes).toHaveLength(1);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(button("Tải lại dữ liệu").disabled).toBe(true);
  await act(async () => releaseRefresh(Response.json(overview)));
  expect(button("Tải lại dữ liệu").disabled).toBe(false);
  expect(writes).toHaveLength(1);
});
it("keeps the product form on a rejected network write and allows retry", async () => {
  await open("product"); await setInput("Tên sản phẩm", "Sữa vừa sửa");
  write = async () => { throw new TypeError("Failed to fetch"); };
  await submitTwice(); await settle();
  expect(input("Tên sản phẩm").value).toBe("Sữa vừa sửa");
  expect(document.body.textContent).toContain("Không thể kết nối đến máy chủ");
  write = async () => Response.json({ id: "saved" }); await submitTwice();
  expect(writes).toHaveLength(2); expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it.each(["store", "product", "supplier"])("creates %s with validated fields and no native prompts", async (kind) => {
  await open(kind, "create"); await submitTwice(); expect(writes).toHaveLength(0);
  if (kind === "store") {
    await setInput("Mã cửa hàng", "NEW-STORE"); await setInput("Tên cửa hàng", "Cửa hàng mới"); await setInput("Địa chỉ", "123 đường mới");
  } else if (kind === "product") {
    await setInput("SKU", "NEW-SKU"); await setInput("Mã vạch", "893000000003"); await setInput("Tên sản phẩm", "Sản phẩm mới"); await setInput("Danh mục", "Sữa");
  } else {
    await setInput("Mã nhà cung cấp", "NEW-SUP"); await setInput("Tên nhà cung cấp", "Nhà cung cấp mới");
  }
  await submitTwice();
  expect(writes).toHaveLength(1); expect(writes[0].method).toBe("POST");
  expect(writes[0].body).toEqual(kind === "store"
    ? { code: "NEW-STORE", name: "Cửa hàng mới", address: "123 đường mới", mapWidth: 12, mapHeight: 8 }
    : kind === "product" ? { sku: "NEW-SKU", barcode: "893000000003", name: "Sản phẩm mới", category: "Sữa", unit: "Sản phẩm", basePriceVnd: 10000, emoji: "📦" }
    : { code: "NEW-SUP", name: "Nhà cung cấp mới", country: "Việt Nam", certificate: null });
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(prompt).not.toHaveBeenCalled();
});
