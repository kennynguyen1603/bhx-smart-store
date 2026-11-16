// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "next-auth";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminApp } from "@/components/admin-app";
import { toast } from "@/components/ui/sonner";
import { referenceOverview, referenceStore, secondProduct, secondSupplier, shelf, lot, rule, account, otherStore } from "../fixtures/admin-reference";
const user: Session["user"] = { id: "admin", name: "Quản trị", role: "ADMIN", storeIds: ["store"], defaultStoreId: "store" };
let root: Root, host: HTMLDivElement;
let data: typeof referenceOverview;
let writes: { url: string; method: string; body?: Record<string, unknown> }[];
let write: () => Promise<Response>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("prompt", vi.fn(() => null)); vi.stubGlobal("confirm", vi.fn(() => false)); vi.stubGlobal("alert", vi.fn());
  data = structuredClone(referenceOverview); writes = []; write = async () => Response.json({ id: "saved" });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (!init?.method) return Response.json(data);
    writes.push({ url, method: init.method, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
    return write();
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  try { expect(prompt).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled(); expect(alert).not.toHaveBeenCalled(); }
  finally { await act(async () => { toast.dismiss(); root.unmount(); }); host.remove(); vi.unstubAllGlobals(); }
});
function button(text: string, parent: ParentNode = document) {
  const found = [...parent.querySelectorAll<HTMLButtonElement>("button")].find(el => (el.getAttribute("aria-label") || el.textContent) === text);
  expect(found, `button ${text}`).toBeDefined(); return found!;
}
function dialog() { const el = document.querySelector<HTMLElement>('[role="dialog"]'); expect(el, "uses shared dialog").not.toBeNull(); return el!; }
function field(label: string) {
  const el = [...dialog().querySelectorAll("label")].find(el => el.textContent === label);
  expect(el, label).toBeDefined(); return document.getElementById(el!.htmlFor) as HTMLInputElement;
}
async function fill(label: string, value: string) {
  const el = field(label);
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function click(text: string, parent: ParentNode = document) { await act(async () => button(text, parent).click()); }
async function mount(tab: string) {
  await act(async () => root.render(<AdminApp user={user} />));
  await act(async () => { await new Promise(done => setTimeout(done, 20)); });
  await click(tab);
}
async function submit() {
  const form = dialog().querySelector("form")!;
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}
async function select(label: string, option: string) {
  await act(async () => field(label).click());
  const el = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.textContent?.includes(option));
  expect(el, option).toBeDefined(); await act(async () => el!.click());
}
const edits = [
  { kind: "lot", tab: "Danh mục", trigger: "Sửa", row: "LOT-TWO", resource: "lots", id: lot.id, readonly: { "Mã lô": lot.batchCode, "Cửa hàng": referenceStore.name, "Sản phẩm": lot.product.name, "Nhà cung cấp": lot.supplier.name, "Ngày nhận": lot.receivedAt }, inputs: { "Xuất xứ": lot.origin, "Hạn sử dụng": "2026-12-25", "Số lượng": "17" }, body: { origin: lot.origin, expiryDate: "2026-12-25", quantity: 17 } },
  { kind: "zone", tab: "Sơ đồ & ESL", trigger: zoneTrigger(), row: "", resource: "zones", id: "zone-second", readonly: { "Cửa hàng": referenceStore.name }, inputs: { "Tên khu vực": "Khu thứ hai", "Màu": "#abcdef", "Vị trí X": "2", "Vị trí Y": "3", "Chiều rộng": "4", "Chiều cao": "2" }, body: { name: "Khu thứ hai", color: "#abcdef", x: 2, y: 3, width: 4, height: 2 } },
  { kind: "shelf", tab: "Sơ đồ & ESL", trigger: "Sửa kệ K-02", row: "", resource: "shelves", id: shelf.id, readonly: { "Mã kệ": shelf.code, "Cửa hàng": referenceStore.name }, inputs: { "Tên kệ": shelf.label, "Vị trí X": "3", "Vị trí Y": "2", "Chiều rộng": "2", "Chiều cao": "3" }, body: { label: shelf.label, zoneId: shelf.zoneId, x: 3, y: 2, width: 2, height: 3 } },
  { kind: "esl", tab: "Sơ đồ & ESL", trigger: "Sửa ESL ESL-TWO", row: "", resource: "esls", id: "esl-second", readonly: { "Mã ESL": "ESL-TWO", "Cửa hàng": referenceStore.name }, inputs: {}, body: { shelfId: shelf.id, productId: "product-second", ledOn: true } },
  { kind: "fefo", tab: "FEFO", trigger: "Sửa", row: "35%", resource: "fefo-rules", id: rule.id, readonly: { "Cửa hàng": referenceStore.name }, inputs: { "Số ngày còn lại": "5", "Phần trăm giảm": "35" }, body: { daysRemaining: 5, discountPercent: 35, quarantine: true, active: false } },
  { kind: "user", tab: "Người dùng", trigger: "Sửa", row: account.email, resource: "users", id: account.id, readonly: { "Email": account.email }, inputs: { "Họ tên": account.name, "Mật khẩu mới": "" }, body: { name: account.name, role: "MANAGER", active: false, storeIds: [otherStore.id, "store"] } },
  { kind: "store", tab: "Tổng quan", trigger: "Sửa cửa hàng", row: "", resource: "stores", id: referenceStore.id, readonly: { "Mã cửa hàng": referenceStore.code }, inputs: { "Tên cửa hàng": referenceStore.name }, body: { name: referenceStore.name, address: referenceStore.address, mapWidth: referenceStore.mapWidth, mapHeight: referenceStore.mapHeight, active: true } },
  { kind: "product", tab: "Danh mục", trigger: "Sửa", row: secondProduct.sku, resource: "products", id: secondProduct.id, readonly: { "SKU": secondProduct.sku, "Mã vạch": secondProduct.barcode }, inputs: { "Tên sản phẩm": secondProduct.name }, body: { name: secondProduct.name, category: secondProduct.category, unit: secondProduct.unit, basePriceVnd: secondProduct.basePriceVnd, emoji: secondProduct.emoji } },
  { kind: "supplier", tab: "Danh mục", trigger: "Sửa", row: secondSupplier.code, resource: "suppliers", id: secondSupplier.id, readonly: { "Mã nhà cung cấp": secondSupplier.code }, inputs: { "Tên nhà cung cấp": secondSupplier.name }, body: { name: secondSupplier.name, country: secondSupplier.country, certificate: secondSupplier.certificate, active: true } },
  { kind: "inventory", tab: "Tồn kho", trigger: "Sửa", row: "Sữa tươi hai", resource: "inventories", id: "inventory", readonly: {}, inputs: { "Số lượng trên kệ": "7", "Số lượng kho sau": "19" }, body: { onShelf: 7, backroom: 19, capacity: 24, lowThreshold: 4 } },
];
function zoneTrigger() { return "Khu thứ hai"; }
async function openEdit(sample: typeof edits[number]) {
  await mount(sample.tab);
  const row = sample.row ? [...document.querySelectorAll("tr,.log-row")].find(el => el.textContent?.includes(sample.row)) : document;
  // Quarantined rules display their action instead of the percentage.
  await click(sample.trigger, row || document); return dialog();
}
it.each(edits)("$kind edit initializes persisted values and submits only API-supported fields", async sample => {
  await openEdit(sample);
  expect([...dialog().querySelectorAll("label")].map(el => el.textContent)).not.toContain("ID");
  for (const input of dialog().querySelectorAll<HTMLInputElement>("input[readonly]")) expect([sample.id, "store", "product-second", "supplier-second"]).not.toContain(input.value);
  for (const [label, value] of Object.entries(sample.readonly)) { expect(field(label).value).toBe(value); expect(field(label).readOnly).toBe(true); }
  for (const [label, value] of Object.entries(sample.inputs)) expect(field(label).value).toBe(value);
  if (sample.kind === "shelf") expect(field("Khu vực").textContent).toContain("Khu thứ hai");
  if (sample.kind === "esl") { expect(field("Kệ").textContent).toContain("K-02"); expect(field("Sản phẩm").textContent).toContain("Sản phẩm thứ hai"); }
  if (sample.kind === "user") { expect(field("Cửa hàng mặc định").textContent).toContain(otherStore.name); expect(dialog().querySelectorAll('[role="checkbox"][aria-checked="true"]')).toHaveLength(2); }
  await submit(); expect(writes).toEqual([{ url: `/api/admin/${sample.resource}/${sample.id}`, method: "PUT", body: sample.body }]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("shows every ESL and provides shelf/ESL edit entry points", async () => {
  await mount("Sơ đồ & ESL");
  for (const code of ["ESL-ONE", "ESL-TWO"]) { expect(document.body.textContent).toContain(code); expect(button(`Sửa ESL ${code}`)).toBeDefined(); }
  expect(button("Sửa kệ K-02")).toBeDefined();
});
it("creates shelves with exact geometry and an optional zone", async () => {
  await mount("Sơ đồ & ESL"); await click("Thêm kệ"); await fill("Mã kệ", "NEW-K"); await fill("Tên kệ", "Kệ mới"); await submit();
  expect(writes).toEqual([{ url: "/api/admin/shelves", method: "POST", body: { storeId: "store", code: "NEW-K", label: "Kệ mới", zoneId: null, x: 0, y: 1, width: 1, height: 2 } }]);
});
it("creates ESL with selected reference IDs", async () => {
  await mount("Sơ đồ & ESL"); await click("Gắn ESL"); await fill("Mã ESL", "NEW-ESL"); await select("Kệ", "K-02"); await select("Sản phẩm", "Sản phẩm thứ hai"); await submit();
  expect(writes[0]).toEqual({ url: "/api/admin/esls", method: "POST", body: { storeId: "store", code: "NEW-ESL", shelfId: shelf.id, productId: "product-second" } });
});
it("creates lots with selected references and validated dates", async () => {
  await mount("Danh mục"); await click("Thêm lô"); await fill("Mã lô", "NEW-LOT"); await select("Sản phẩm", "Sản phẩm thứ hai"); await select("Nhà cung cấp", "Nhà cung cấp thứ hai"); await fill("Xuất xứ", "Đà Lạt"); await fill("Ngày nhận", "2026-11-16"); await fill("Hạn sử dụng", "2026-02-30"); await fill("Số lượng", "20"); await submit();
  expect(writes).toHaveLength(0); expect(dialog().textContent).toContain("Hạn sử dụng không hợp lệ"); await fill("Hạn sử dụng", "2026-12-25"); await submit();
  expect(writes[0].body).toEqual({ storeId: "store", productId: "product-second", supplierId: "supplier-second", batchCode: "NEW-LOT", origin: "Đà Lạt", receivedAt: "2026-11-16", expiryDate: "2026-12-25", quantity: 20 });
});
it("creates zones with validated color and geometry", async () => {
  await mount("Sơ đồ & ESL"); await click("Thêm zone"); await fill("Tên khu vực", "Khu mới"); await fill("Màu", "bad"); await submit(); expect(writes).toHaveLength(0); expect(dialog().textContent).toContain("Màu phải có định dạng #RRGGBB"); await fill("Màu", "#dff3e7"); await submit();
  expect(writes[0].body).toEqual({ storeId: "store", name: "Khu mới", color: "#dff3e7", x: 0, y: 0, width: 3, height: 1 });
});
it("creates FEFO active by default without exposing unsupported active input", async () => {
  await mount("FEFO"); await click("Thêm quy tắc"); expect(dialog().textContent).not.toContain("Đang hoạt động"); await submit();
  expect(writes[0]).toEqual({ url: "/api/admin/fefo-rules", method: "POST", body: { storeId: "store", daysRemaining: 3, discountPercent: 20, quarantine: false } });
});
it("allows multiple user stores and explicit default without sending an empty reset password", async () => {
  await openEdit(edits[5]); await select("Cửa hàng mặc định", referenceStore.name); await submit();
  expect(writes[0].body?.storeIds).toEqual(["store", otherStore.id]); expect(writes[0].body).not.toHaveProperty("password");
});
it("creates users with validated email/password and multiple memberships", async () => {
  await mount("Người dùng"); await click("Tạo tài khoản"); await submit(); expect(writes).toHaveLength(0);
  await fill("Họ tên", "Người mới"); await fill("Email", "new@example.com"); await fill("Mật khẩu", "Password123");
  await act(async () => field(otherStore.name).click()); await select("Cửa hàng mặc định", otherStore.name); await submit();
  expect(writes[0].body).toEqual({ name: "Người mới", email: "new@example.com", password: "Password123", role: "STAFF", storeIds: [otherStore.id, "store"] });
});
it("shows mode-specific password guidance", async () => {
  await mount("Người dùng"); await click("Tạo tài khoản");
  expect(dialog().textContent).toContain("Mật khẩu bắt buộc và phải có ít nhất 8 ký tự.");
  expect(dialog().textContent).not.toContain("Để trống mật khẩu mới để giữ mật khẩu hiện tại.");
  await click("Hủy", dialog());
  await openEdit(edits[5]);
  expect(dialog().textContent).toContain("Để trống mật khẩu mới để giữ mật khẩu hiện tại.");
});
it("preserves unavailable persisted memberships and references on edit", async () => {
  data.stores = [referenceStore]; data.products = [data.products[0]];
  await openEdit(edits[5]); expect(dialog().textContent).not.toContain(otherStore.id); expect(field("Cửa hàng mặc định").textContent).toContain("Không còn khả dụng"); await submit(); expect(writes[0].body?.storeIds).toEqual([otherStore.id, "store"]);
});
it("disables create actions and explains missing prerequisites", async () => {
  data.products = []; data.suppliers = []; data.stores[0].shelves = [];
  await mount("Danh mục"); expect(button("Thêm lô").disabled).toBe(true); expect(document.body.textContent).toContain("Cần cửa hàng, sản phẩm và nhà cung cấp để thêm lô.");
  await click("Sơ đồ & ESL"); expect(button("Gắn ESL").disabled).toBe(true); expect(document.body.textContent).toContain("Cần cửa hàng, kệ và sản phẩm để gắn ESL.");
});
it.each(edits)("$kind preserves values on failure and blocks repeated submits while pending", async sample => {
  let release!: (response: Response) => void; write = () => new Promise(done => { release = done; });
  await openEdit(sample); await submit(); expect(writes).toHaveLength(1); expect(button("Hủy", dialog()).disabled).toBe(true);
  await act(async () => release(Response.json({ error: { message: "Không thể cập nhật" } }, { status: 500 })));
  await act(async () => { await new Promise(done => setTimeout(done, 20)); });
  expect(dialog()).toBeDefined(); expect(document.body.textContent).toContain("Không thể cập nhật");
  write = async () => Response.json({ id: "saved" }); await submit(); expect(writes).toHaveLength(2); expect(writes[1].body).toEqual(sample.body);
});
const destructive = [
  ["Tổng quan", "Vô hiệu hoá", "", "stores", "store", "Vô hiệu hoá cửa hàng", referenceStore.name],
  ["Danh mục", "Ẩn", "SKU-02", "products", "product", "Ẩn sản phẩm", "Sữa tươi hai"],
  ["Danh mục", "Ẩn", "SUP-02", "suppliers", "supplier", "Vô hiệu hoá nhà cung cấp", "Nhà cung cấp hai"],
  ["Danh mục", "Đóng", "LOT-TWO", "lots", lot.id, "Đóng lô hàng", "LOT-TWO"],
  ["Sơ đồ & ESL", "Xoá khu vực Khu thứ hai", "", "zones", "zone-second", "Xoá khu vực", "Khu thứ hai"],
  ["Sơ đồ & ESL", "Xoá kệ K-02", "", "shelves", shelf.id, "Xoá kệ", "K-02"],
  ["Sơ đồ & ESL", "Gỡ ESL ESL-TWO", "", "esls", "esl-second", "Gỡ ESL khỏi kệ", "ESL-TWO"],
  ["FEFO", "Xoá", "", "fefo-rules", rule.id, "Xoá quy tắc FEFO", "5 ngày"],
  ["Người dùng", "Khoá", account.email, "users", account.id, "Khoá tài khoản", account.email],
];
it.each(destructive)("confirms %s %s with resource copy, cancel, one pending write", async (tab, trigger, rowText, resource, id, title, name) => {
  await mount(tab); const row = rowText ? [...document.querySelectorAll("tr,.log-row")].find(el => el.textContent?.includes(rowText))! : document;
  await click(trigger, row); let confirmDialog = document.querySelector<HTMLElement>('[role="alertdialog"]'); expect(confirmDialog).not.toBeNull(); expect(confirmDialog!.textContent).toContain(title); expect(confirmDialog!.textContent).toContain(name); await click("Hủy", confirmDialog!); expect(writes).toHaveLength(0);
  await click(trigger, row); confirmDialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
  let release!: (response: Response) => void; write = () => new Promise(done => { release = done; });
  const action = [...confirmDialog.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent !== "Hủy")!;
  await act(async () => { action.click(); action.click(); }); expect(writes).toEqual([{ url: `/api/admin/${resource}/${id}`, method: "DELETE" }]); expect(button("Hủy", confirmDialog).disabled).toBe(true); expect(action.disabled).toBe(true);
  await act(async () => release(new Response(null, { status: 204 }))); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it("warns that only an empty shelf can be deleted", async () => {
  await mount("Sơ đồ & ESL"); await click("Xoá kệ K-02");
  const confirmDialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
  expect(confirmDialog.textContent).toContain("Chỉ có thể xoá kệ trống");
  expect(confirmDialog.textContent).toContain("di chuyển hoặc xoá các dữ liệu phụ thuộc trước");
});

it("explains and disables all store-dependent creates when no store exists", async () => {
  data.stores = [];
  await mount("FEFO"); expect(button("Thêm quy tắc").disabled).toBe(true); expect(document.body.textContent).toContain("Cần cửa hàng để thêm quy tắc FEFO.");
  await click("Người dùng"); expect(button("Tạo tài khoản").disabled).toBe(true); expect(document.body.textContent).toContain("Cần ít nhất một cửa hàng để tạo tài khoản.");
  await click("Sơ đồ & ESL");
  for (const text of ["Thêm zone", "Thêm kệ", "Gắn ESL"]) expect(button(text).disabled).toBe(true);
  expect(document.body.textContent).toContain("Cần cửa hàng để quản lý sơ đồ và ESL."); expect(writes).toHaveLength(0);
});
it("preserves ESL and shelf references absent from available options", async () => {
  data.products = [data.products[0]]; data.stores[0].zones = [];
  await openEdit(edits[3]); expect(field("Sản phẩm").textContent).toContain("Không còn khả dụng"); await submit(); expect(writes[0].body).toEqual(edits[3].body);
  await click("Sửa kệ K-02"); expect(field("Khu vực").textContent).toContain("Không còn khả dụng"); await submit(); expect(writes[1].body).toEqual(edits[2].body);
});
it("keeps destructive confirmation after failure and closes on write success despite refresh failure", async () => {
  await mount("Tổng quan"); await click("Vô hiệu hoá");
  write = async () => Response.json({ error: { message: "Không thể vô hiệu hoá" } }, { status: 409 });
  let confirmDialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
  await click("Vô hiệu hoá", confirmDialog); await act(async () => { await new Promise(done => setTimeout(done, 20)); });
  expect(document.body.textContent).toContain("Không thể vô hiệu hoá"); expect(confirmDialog.getAttribute("aria-busy")).toBe("false"); expect(writes).toHaveLength(1);
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => { if (!init?.method) return new Response(null, { status: 503 }); writes.push({ url: _url, method: init.method }); return new Response(null, { status: 204 }); }));
  confirmDialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!; await click("Vô hiệu hoá", confirmDialog);
  await act(async () => { await new Promise(done => setTimeout(done, 20)); });
  expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(writes).toHaveLength(2); expect(document.body.textContent).toContain("Đã lưu thay đổi nhưng không thể tải lại dữ liệu");
});
it("supports explicit user membership removal and password reset without changing email", async () => {
  await openEdit(edits[5]); expect(field("Mật khẩu mới").type).toBe("password");
  await act(async () => field(referenceStore.name).click()); await fill("Mật khẩu mới", "ResetPassword123"); await submit();
  expect(writes[0].body).toEqual({ ...edits[5].body, storeIds: [otherStore.id], password: "ResetPassword123" });
});
it("edits FEFO day/discount/quarantine/active values", async () => {
  await openEdit(edits[4]); await fill("Số ngày còn lại", "7"); await fill("Phần trăm giảm", "45");
  await act(async () => { field("Cách ly").click(); field("Đang hoạt động").click(); }); await submit();
  expect(writes[0].body).toEqual({ daysRemaining: 7, discountPercent: 45, quarantine: false, active: true });
});
