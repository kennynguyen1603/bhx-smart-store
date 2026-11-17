import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "vite";
import { fileURLToPath } from "node:url";

let script: string;
let styles: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
    esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("../fixtures/admin-foundation.tsx", import.meta.url)), name: "AdminFoundation", formats: ["iife"] } },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const output = outputs.flatMap((item) => {
    if (!("output" in item)) throw new Error("Expected an in-memory fixture build");
    return item.output;
  });
  script = output.filter((item) => item.type === "chunk").map((item) => item.code).join("\n");
  styles = output.filter((item) => item.type === "asset").filter((item) => item.fileName.endsWith(".css")).map((item) => String(item.source)).join("\n");
});
async function mount(page: Page, kind = "entity", opener = "button") {
  await page.setContent(`<div id="root" data-kind="${kind}" data-opener="${opener}"></div>`);
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: script });
}
async function expectMobileTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  // Sonner transforms can introduce subpixel floating-point noise (43.999998px).
  expect(Math.round(box!.width * 100) / 100).toBeGreaterThanOrEqual(44);
  expect(Math.round(box!.height * 100) / 100).toBeGreaterThanOrEqual(44);
  await expect(locator).toHaveCSS("flex-shrink", "0");
}
for (const width of [320, 390, 760]) {
  test(`Select scroll targets are at least 44px at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    await mount(page);
    await page.getByRole("combobox", { name: "Chọn sản phẩm" }).click();
    await expectMobileTarget(page.locator(".ui-select-scroll").last());
    await page.locator(".ui-select-viewport").evaluate((element) => { element.scrollTop = 150; });
    await expect(page.locator(".ui-select-scroll")).toHaveCount(2);
    await expectMobileTarget(page.locator(".ui-select-scroll").first());
    await expectMobileTarget(page.locator(".ui-select-scroll").last());
  });
  test(`Sonner close target is at least 44px at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    await mount(page);
    await page.getByRole("button", { name: "Hiện thông báo" }).click();
    const close = page.locator(".ui-toaster [data-close-button]");
    await expectMobileTarget(close);
    await close.click();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  });
}
for (const kind of ["entity", "confirm"]) {
  for (const opener of ["hidden", "div", "body"]) {
    test(`${kind} restores fallback when ${opener} opener rejects focus`, async ({ page }) => {
      await mount(page, kind, opener);
      await page.getByRole("button", { name: "Mở biểu mẫu" }).click();
      if (opener === "hidden") await page.locator("#opener").evaluate((element) => { element.setAttribute("hidden", ""); });
      await page.getByRole("button", { name: "Hủy", exact: true }).click();
      await expect(page.locator("#fallback")).toBeFocused();
    });
  }
}

async function login(page: Page, email: string, destination = "/admin") {
  const request = page.context().request;
  const { csrfToken } = await (await request.get("/api/auth/csrf")).json();
  const response = await request.post("/api/auth/callback/credentials", { form: { csrfToken, email, password: "Demo@123", callbackUrl: destination, json: "true" }, headers: { "X-Auth-Return-Redirect": "1" } });
  expect(response.ok()).toBe(true); await page.goto(destination);
}

test("human-readable references hide raw IDs in all immutable reference forms", async ({ page }) => {
  const { referenceOverview, referenceStore, lot } = await import("../fixtures/admin-reference");
  await page.route("**/api/admin/overview**", route => route.fulfill({ json: referenceOverview }));
  await login(page, "admin@demo.bhx"); await page.getByRole("button", { name: "Danh mục", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "LOT-TWO" }).getByRole("button", { name: "Sửa", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Cửa hàng", { exact: true })).toHaveValue(referenceStore.name);
  await expect(dialog.getByLabel("Sản phẩm", { exact: true })).toHaveValue(lot.product.name);
  await expect(dialog.getByLabel("Nhà cung cấp", { exact: true })).toHaveValue(lot.supplier.name);
  await expect(dialog.getByLabel("ID", { exact: true })).toHaveCount(0);
  for (const input of await dialog.locator("input[readonly]").all()) expect(["store", lot.id, lot.productId, lot.supplierId]).not.toContain(await input.inputValue());
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: "/tmp/task-3-reference-mobile.png" });
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("Admin task assignment reaches Staff and authorized Manager without cross-store options", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const nextEnv = await import("@next/env"); nextEnv.default.loadEnvConfig(process.cwd());
  const { prisma } = await import("../../src/lib/db");
  const store = await prisma.store.findUniqueOrThrow({ where: { code: "NT-Q5" } });
  const foreign = await prisma.store.create({ data: { code: `T3-${Date.now()}`, name: "Cửa hàng ngoài quyền Task3", address: "Test" } });
  const foreignStaff = await prisma.user.create({ data: { email: `t3-${Date.now()}@test.local`, name: "Nhân viên ngoài quyền Task3", passwordHash: "unused", role: "STAFF", userStores: { create: { storeId: foreign.id } } } });
  const inventory = await prisma.inventory.findFirstOrThrow({ where: { storeId: store.id, product: { sku: "MILK-1L" } }, include: { product: true, shelf: true } });
  let taskId: string | undefined;
  const staffContext = await browser.newContext(), managerContext = await browser.newContext();
  try {
    await login(page, "admin@demo.bhx"); await page.locator(".store-selector select").selectOption(store.id);
    await expect(page.getByRole("button", { name: "Nhiệm vụ", exact: true })).toBeVisible(); await page.getByRole("button", { name: "Nhiệm vụ", exact: true }).click(); await page.getByRole("button", { name: "Giao nhiệm vụ", exact: true }).click();
    const dialog = page.getByRole("dialog");
    for (const [label, option] of [["Loại nhiệm vụ", "Bổ sung hàng"], ["Sản phẩm", inventory.product.name], ["Kệ", inventory.shelf.label], ["Người nhận", "Nguyễn Hoàng An"], ["Độ ưu tiên", "Cao"]]) {
      await dialog.getByRole("combobox", { name: label, exact: true }).click(); await page.getByRole("option", { name: option, exact: true }).click();
    }
    await dialog.getByLabel("Ghi chú", { exact: true }).fill("Task3 browser assignment");
    const created = page.waitForResponse(response => response.url().endsWith("/api/admin/tasks") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Lưu", exact: true }).click(); const response = await created;
    expect(response.status()).toBe(201); const createdTask = (await response.json()).task; taskId = createdTask.id;
    await expect(dialog).toHaveCount(0);
    const row = page.locator(".admin-task-table tbody tr").filter({ hasText: "Task3 browser assignment" });
    await expect(row).toContainText("Mới"); await expect(row).toContainText("Nguyễn Hoàng An"); await expect(row).toContainText(inventory.shelf.label);
    await page.screenshot({ path: "/tmp/task-3-admin-desktop.png" });
    const staff = await staffContext.newPage(); await login(staff, "staff@demo.bhx", "/staff");
    await staff.getByRole("button", { name: /^Nhiệm vụ/ }).click();
    const assignedRow = staff.locator(".task-row").filter({ hasText: createdTask.title }).first();
    await expect(assignedRow).toBeVisible(); await assignedRow.click();
    await expect(staff.locator(".staff-task-modal")).toContainText("Task3 browser assignment");
    const manager = await managerContext.newPage(); await login(manager, "manager@demo.bhx");
    await expect(manager.locator(".store-selector select option").filter({ hasText: foreign.name })).toHaveCount(0);
    await manager.locator(".store-selector select").selectOption(store.id); await manager.getByRole("button", { name: "Nhiệm vụ", exact: true }).click();
    await expect(manager.locator(".admin-task-table tbody tr").filter({ hasText: "Task3 browser assignment" })).toContainText("Nguyễn Hoàng An");
    await expect(manager.getByRole("button", { name: "Bắt đầu", exact: true })).toHaveCount(0);
    await manager.getByRole("button", { name: "Giao nhiệm vụ", exact: true }).click(); await manager.getByRole("dialog").getByRole("combobox", { name: "Người nhận", exact: true }).click();
    await expect(manager.getByRole("option", { name: foreignStaff.name, exact: true })).toHaveCount(0);
    expect((await manager.request.get(`/api/admin/overview?storeId=${foreign.id}`)).status()).toBe(403);
    await page.setViewportSize({ width: 390, height: 844 }); await expect(row).toBeVisible();
    await page.screenshot({ path: "/tmp/task-3-admin-mobile.png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await Promise.allSettled([staffContext.close(), managerContext.close()]);
    if (taskId) { await prisma.notification.deleteMany({ where: { taskId } }); await prisma.task.delete({ where: { id: taskId } }); }
    await prisma.store.delete({ where: { id: foreign.id } }); await prisma.user.delete({ where: { id: foreignStaff.id } });
  }
});

for (const width of [320, 390, 760, 1280]) {
  for (const role of ["admin", "manager"]) {
    test(`Admin session controls keep reachable targets and clear the ${role} session at ${width}px`, async ({ page }, testInfo) => {
      const { referenceOverview } = await import("../fixtures/admin-reference");
      await page.setViewportSize({ width, height: 844 });
      await page.route("**/api/admin/overview**", route => route.fulfill({ json: referenceOverview }));
      await login(page, `${role}@demo.bhx`);
      await expect(page.locator(".workspace-header h1")).toHaveText("Tổng quan");
      const logout = page.getByRole("button", { name: "Đăng xuất", exact: true }).filter({ visible: true });
      await expect(logout).toHaveCount(1); await expect(logout).toBeVisible();
      if (width > 760) await expect(logout).toHaveText("Đăng xuất");
      await expectMobileTarget(logout);
      const targets = [logout, page.locator(".notification-button"), page.getByRole("button", { name: "Tải lại dữ liệu", exact: true })];
      const boxes = [];
      for (const target of targets) {
        await expect(target).toBeEnabled();
        const box = await target.boundingBox(); expect(box).not.toBeNull(); boxes.push(box!);
        expect(await target.evaluate(el => {
          const b = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
        })).toBe(true);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        expect(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y).toBe(false);
      }
      const viewport = await page.evaluate(() => ({ body: document.body.scrollWidth, document: document.documentElement.scrollWidth, viewport: innerWidth }));
      expect(viewport.body).toBeLessThanOrEqual(width); expect(viewport.document).toBeLessThanOrEqual(width);
      await testInfo.attach("header measurements", { body: JSON.stringify({ width, role, boxes, viewport }), contentType: "application/json" });
      await page.screenshot({ path: `/tmp/auth-task2-${role}-${width}.png`, fullPage: true });
      let signouts = 0; page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/auth/signout") signouts++; });
      await logout.click(); await expect(page).toHaveURL(url => url.pathname === "/admin/login");
      expect(signouts).toBe(1); expect((await (await page.request.get("/api/auth/session")).json()).user).toBeUndefined();
      await page.goto("/admin"); await expect(page).toHaveURL(url => url.pathname === "/admin/login");
    });
  }
}
for (const width of [320, 390, 760]) {
  test(`LED explanation remains visible and associated at ${width}px`, async ({ page }) => {
    const { referenceOverview } = await import("../fixtures/admin-reference");
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/api/admin/overview**", route => route.fulfill({ json: referenceOverview }));
    await login(page, "admin@demo.bhx");
    await page.getByRole("button", { name: "Sơ đồ & ESL", exact: true }).click();
    await page.getByRole("button", { name: "Sửa ESL ESL-TWO", exact: true }).click();
    const toggle = page.getByRole("checkbox", { name: "Bật đèn LED", exact: true });
    const copy = "Đèn LED trên nhãn kệ sáng khi tồn kho chạm ngưỡng cảnh báo, tắt sau khi bổ sung.";
    await expect(toggle).toHaveAccessibleDescription(copy);
    await expect(page.getByText(copy, { exact: true })).toBeVisible();
    expect(await page.getByRole("dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/auth-task2-led-${width}.png`, fullPage: true });
  });
}
