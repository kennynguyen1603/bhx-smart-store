import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "../fixtures/shelf-restoration";
import nextEnv from "@next/env";
import type { AdminMapStore } from "../../src/components/admin/admin-map-editor";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test.setTimeout(60_000);

async function signIn(page: Page, role: "staff" | "manager" | "admin") {
  // Establish CSRF before the login page's concurrent initial session requests.
  expect((await page.request.get("/api/auth/csrf")).ok()).toBe(true);
  await page.goto(`/${role === "admin" ? "admin" : "staff"}/login`);
  await page.getByLabel("Email", { exact: true }).fill(`${role}@demo.bhx`);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Demo@123");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${role === "admin" ? "admin" : "staff"}$`), { timeout: 20_000 });
}

async function openMap(page: Page) {
  await signIn(page, "admin");
  await page.getByRole("button", { name: "Sơ đồ & ESL", exact: true }).click();
  await expect(page.locator(".admin-shelf-handle").first()).toBeVisible({ timeout: 20_000 });
  const response = await page.request.get("/api/admin/overview");
  expect(response.ok()).toBe(true);
  const data = await response.json() as { selectedStoreId: string; stores: AdminMapStore[] };
  return data.stores.find((store) => store.id === data.selectedStoreId)!;
}

test("confirmed notification reads survive offline fallback and reload without consuming arrivals", async ({ page }) => {
  await signIn(page, "staff");
  const feed = await page.request.get("/api/staff/tasks");
  expect(feed.ok()).toBe(true);
  const payload = await feed.json();
  const notification = { id: "displayed-unread", type: "TASK_CREATED", title: "Displayed notification", body: "Snapshot", readAt: null, createdAt: "2026-11-16T01:00:00Z", taskId: null };
  payload.notifications = [notification];
  let offline = false;
  let revision = 0;
  let requestIds: string[] = [];
  let finish!: () => void;
  const patchGate = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/staff/tasks?*", (route) => offline ? route.abort("internetdisconnected") : route.fulfill({ json: payload }));
  await page.route("**/api/store-changes?*", (route) => route.fulfill({ json: {
    token: `notification-fixture-${revision}`, taskUpdatedAt: null, notificationUpdatedAt: null,
    unreadCount: payload.notifications.filter((item: { readAt: string | null }) => !item.readAt).length,
  } }));
  await page.route("**/api/staff/notifications", async (route) => {
    requestIds = route.request().postDataJSON().ids;
    await patchGate;
    await route.fulfill({ json: { updated: 1, readAt: "2026-11-16T03:00:00.000Z" } });
  });
  try {
    // Discard login-time requests before the controlled feed/cache scenario starts.
    await page.reload();
    await page.getByRole("button", { name: "Thông báo, 1 chưa đọc", exact: true }).click();
    await expect(page.locator(".notification-row strong")).toHaveText("Displayed notification");
    await page.getByRole("button", { name: "Đánh dấu tất cả đã đọc", exact: true }).click();
    await expect.poll(() => requestIds).toEqual(["displayed-unread"]);
    payload.notifications.push({ ...notification, id: "new-unread", title: "New arrival" });
    revision++;
    // Visibility refresh works while the dialog is open, with the PATCH pending.
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator(".notification-row.unread")).toHaveText(/New arrival/);
    finish();
    await expect(page.locator(".notification-read-action")).toContainText("Đã đánh dấu tất cả đã đọc.");
    offline = true;
    // A changed snapshot is detected, but its full feed is unavailable: use the cache.
    revision++;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator(".connection-pill")).toContainText("Offline");
    await expect(page.locator(".notification-row.unread")).toHaveCount(1);
    await expect(page.locator(".notification-row.unread")).toHaveText(/New arrival/);
    await page.reload();
    await expect(page.locator(".connection-pill")).toContainText("Offline");
    await page.getByRole("button", { name: "Thông báo, 1 chưa đọc", exact: true }).click();
    await expect(page.locator(".notification-row")).toHaveCount(2);
    await expect(page.locator(".notification-row.unread")).toHaveText(/New arrival/);
  } finally {
    finish();
    await page.unrouteAll({ behavior: "wait" });
  }
});

async function center(locator: Locator) {
  await locator.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }));
  await locator.click({ trial: true });
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

async function tap(page: Page, locator: Locator) {
  const point = await center(locator);
  // Native coordinate input deliberately exercises hit-testing and shelf overlays.
  await page.touchscreen.tap(point.x, point.y);
}

function emptyTarget(store: AdminMapStore, shelf: AdminMapStore["shelves"][number]) {
  // Compute independently from production validation; prefer a nearby visible cell.
  for (let distance = 1; distance < store.mapHeight; distance++) {
    for (const y of [shelf.y + distance, shelf.y - distance]) {
      const candidate = { x: shelf.x, y };
      if (y < 0 || y + shelf.height > store.mapHeight) continue;
      if (store.shelves.every((other) => other.id === shelf.id || candidate.x + shelf.width <= other.x || candidate.x >= other.x + other.width || y + shelf.height <= other.y || y >= other.y + other.height)) return candidate;
    }
  }
  throw new Error("No nearby empty shelf target in demo data");
}

async function persisted(page: Page, store: AdminMapStore, shelfId: string, position: { x: number; y: number }) {
  await page.reload();
  await page.getByRole("button", { name: "Sơ đồ & ESL", exact: true }).click();
  const response = await page.request.get(`/api/admin/overview?storeId=${store.id}`);
  expect(response.ok()).toBe(true);
  const data = await response.json() as { stores: AdminMapStore[] };
  const shelf = data.stores.find((item) => item.id === store.id)!.shelves.find((item) => item.id === shelfId)!;
  expect({ x: shelf.x, y: shelf.y }).toEqual(position);
  await expect(page.getByRole("button", { name: `Kệ ${shelf.code}`, exact: true })).toHaveCSS("left", `${position.x * 44}px`);
  await expect(page.getByRole("button", { name: `Kệ ${shelf.code}`, exact: true })).toHaveCSS("top", `${position.y * 50}px`);
}

test("390px Admin touch drag persists after reload and restores exact coordinates", async ({ page, context, withRestoredShelf }) => {
  const store = await openMap(page);
  await withRestoredShelf(store, async (shelf) => {
    const destination = emptyTarget(store, shelf);
    const handle = page.getByRole("button", { name: `Kệ ${shelf.code}`, exact: true });
    const from = await center(handle);
    const grid = await page.locator(".admin-placement-grid").boundingBox();
    const to = { x: from.x + (destination.x - shelf.x) * grid!.width / store.mapWidth, y: from.y + (destination.y - shelf.y) * grid!.height / store.mapHeight };
    const cdp = await context.newCDPSession(page);
    try {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from, id: 1 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...to, id: 1 }] });
      const saved = page.waitForResponse((response) => response.url().endsWith(`/api/admin/shelves/${shelf.id}`) && response.request().method() === "PUT");
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      expect((await saved).ok()).toBe(true);
      await expect(page.locator(".admin-placement-grid")).toHaveAttribute("aria-busy", "false");
      await persisted(page, store, shelf.id, destination);
    } finally { await cdp.detach(); }
  });
});

test("390px Admin coordinate taps place a shelf and reject an occupied target inline", async ({ page, withRestoredShelf }) => {
  const store = await openMap(page);
  await withRestoredShelf(store, async (shelf) => {
    const destination = emptyTarget(store, shelf);
    const handle = page.getByRole("button", { name: `Kệ ${shelf.code}`, exact: true });
    await tap(page, handle);
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    const saved = page.waitForResponse((response) => response.url().endsWith(`/api/admin/shelves/${shelf.id}`) && response.request().method() === "PUT");
    await tap(page, page.getByRole("button", { name: `Ô ${destination.x + 1}, ${destination.y + 1}`, exact: true }));
    expect((await saved).ok()).toBe(true);
    await expect(page.locator(".admin-placement-grid")).toHaveAttribute("aria-busy", "false");
    await persisted(page, store, shelf.id, destination);
    const occupied = store.shelves.filter((item) => item.id !== shelf.id).sort((a, b) => a.x - b.x)[0];
    const writes: string[] = [];
    page.on("request", (request) => { if (request.method() === "PUT" && request.url().includes("/api/admin/shelves/")) writes.push(request.url()); });
    await tap(page, handle);
    await tap(page, page.getByRole("button", { name: `Kệ ${occupied.code}`, exact: true }));
    await expect(page.locator(".admin-map-editor").getByRole("alert")).toHaveText("Vị trí này đã có kệ khác.");
    await expect(page.locator(".admin-map-editor").getByRole("alert")).toBeVisible();
    expect(writes).toEqual([]);
  });
});

for (const key of ["Enter", "Space"]) {
  test(`lost capture suppresses the native residual click and preserves ${key} activation`, async ({ page, withRestoredShelf }) => {
    const store = await openMap(page);
    await withRestoredShelf(store, async (shelf) => {
      const handle = page.getByRole("button", { name: `Kệ ${shelf.code}`, exact: true });
      const writes: string[] = [];
      page.on("request", (request) => { if (request.method() === "PUT") writes.push(request.url()); });
      await handle.evaluate((button) => {
        button.addEventListener("pointerdown", (event) => { (button as HTMLElement).dataset.pointerId = String((event as PointerEvent).pointerId); }, { once: true });
        button.addEventListener("click", (event) => { (button as HTMLElement).dataset.residualClick = String((event as MouseEvent).detail); }, { once: true });
      });
      const from = await center(handle);
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      await page.mouse.move(from.x, from.y + 12);
      await expect(handle).toHaveAttribute("aria-pressed", "true");
      await handle.evaluate((button) => button.releasePointerCapture(Number((button as HTMLElement).dataset.pointerId)));
      await page.mouse.move(from.x, from.y + 13);
      await expect(handle).toHaveAttribute("aria-pressed", "false");
      await page.mouse.up();
      await expect(handle).toHaveAttribute("data-residual-click", "1");
      await expect(handle).toHaveAttribute("aria-pressed", "false");
      await handle.focus(); await page.keyboard.press(key);
      await expect(handle).toHaveAttribute("aria-pressed", "true");
      expect(writes).toEqual([]);
    });
  });
  test(`cancelled touch drag preserves next ${key} shelf activation`, async ({ page, context, withRestoredShelf }) => {
    const store = await openMap(page);
    await withRestoredShelf(store, async (shelf) => {
      const handle = page.getByRole("button", { name: `Kệ ${shelf.code}`, exact: true });
      const from = await center(handle);
      const cdp = await context.newCDPSession(page);
      const writes: string[] = [];
      page.on("request", (request) => { if (request.method() === "PUT") writes.push(request.url()); });
      try {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from, id: 1 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x, y: from.y + 12, id: 1 }] });
        await expect(handle).toHaveAttribute("aria-pressed", "true");
        await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
        await expect(handle).toHaveAttribute("aria-pressed", "false");
        await handle.focus();
        await page.keyboard.press(key);
        await expect(handle).toHaveAttribute("aria-pressed", "true");
        expect(writes).toEqual([]);
      } finally { await cdp.detach(); }
    });
  });
}

test("restoration waits for an outstanding delayed shelf PUT after the action rejects", async ({ page, withRestoredShelf }) => {
  const store = await openMap(page);
  nextEnv.loadEnvConfig(process.cwd());
  const { prisma } = await import("../../src/lib/db");
  const shelf = [...store.shelves].sort((a, b) => a.x - b.x || a.y - b.y)[0];
  const original = await prisma.shelf.findUniqueOrThrow({ where: { id: shelf.id }, select: { x: true, y: true } });
  let settled = false;
  let issued = false;
  await page.route(`**/api/admin/shelves/${shelf.id}`, async (route) => {
    issued = true;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.fallback();
  });
  page.on("response", (response) => {
    if (response.url().endsWith(`/api/admin/shelves/${shelf.id}`) && response.request().method() === "PUT") settled = true;
  });
  try {
    await expect(withRestoredShelf(store, async () => {
      const target = emptyTarget(store, shelf);
      await tap(page, page.getByRole("button", { name: `Kệ ${shelf.code}`, exact: true }));
      await tap(page, page.getByRole("button", { name: `Ô ${target.x + 1}, ${target.y + 1}`, exact: true }));
      await expect.poll(() => issued).toBe(true);
      throw new Error("Deliberate action failure while PUT is outstanding");
    })).rejects.toThrow("Deliberate action failure");
    expect(settled, "the write must settle before restoration completes").toBe(true);
    expect(await prisma.shelf.findUniqueOrThrow({ where: { id: shelf.id }, select: { x: true, y: true } })).toEqual(original);
  } finally { await prisma.$disconnect(); }
});

test("independent fixture teardown restores an outstanding write after a real test timeout", async ({}, testInfo) => {
  test.setTimeout(180_000);
  // The child must fail only for its deliberate body timeout, then finish cleanup.
  let output = "";
  let exitCode: unknown;
  try {
    await promisify(execFile)(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config=tests/fixtures/shelf-timeout.config.ts"], { timeout: 150_000 });
  } catch (error) {
    const failure = error as Error & { code: unknown; stdout: string };
    exitCode = failure.code;
    output = failure.stdout;
  }
  expect(exitCode).toBe(1);
  const report = JSON.parse(output);
  const result = report.suites[0].specs[0].tests[0].results[0];
  expect(report.errors).toEqual([]);
  expect(result.status).toBe("timedOut");
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].message).toContain("Test timeout of");
  const attachment = result.attachments.find((item: { name: string }) => item.name === "shelf-restoration");
  expect(attachment).toBeDefined();
  const evidence = JSON.parse(Buffer.from(attachment.body, "base64").toString());
  expect(evidence.outcomes).toEqual([{ id: evidence.original[0].id, outcome: "acknowledged", status: 200 }]);
  expect(evidence.beforeRestore).not.toEqual(evidence.original);
  expect(evidence.restored).toEqual(evidence.original);
  expect(evidence.fixtureBudgetMs).toBe(120_000);
  nextEnv.loadEnvConfig(process.cwd());
  const { prisma } = await import("../../src/lib/db");
  try {
    expect(await prisma.shelf.findMany({ where: { id: { in: evidence.original.map((shelf: { id: string }) => shelf.id) } }, select: { id: true, x: true, y: true }, orderBy: { id: "asc" } })).toEqual(evidence.original);
  } finally { await prisma.$disconnect(); }
  console.log(`Verified real-timeout restoration: ${JSON.stringify(evidence)}`);
  await testInfo.attach("timeout-probe-result", { body: output, contentType: "application/json" });
});

for (const role of ["staff", "manager"] as const) {
  test(`390px ${role} scanner stays active; bell is permission-free; logout works`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.assign(window, { permissionRequests: 0 });
      Notification.requestPermission = async () => { (window as unknown as { permissionRequests: number }).permissionRequests++; return "denied"; };
    });
    await signIn(page, role);
    const scanner = page.getByRole("button", { name: "Quét ESL", exact: true });
    await tap(page, scanner);
    await expect(page.getByRole("heading", { name: "Tra cứu ESL" })).toBeVisible();
    await page.getByLabel("Mã ESL tra cứu").fill("ESL-MOBILE-CHECK");
    await expect(scanner).toHaveClass("active");
    await expect(page.getByRole("heading", { name: "Tất cả nhiệm vụ" })).toHaveCount(0);
    await tap(page, page.getByLabel("Đóng tra cứu ESL"));
    const bell = page.getByRole("button", { name: /^Thông báo/ });
    const pushRequests: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/api/push/")) pushRequests.push(request.url()); });
    await tap(page, bell);
    await expect(page.getByRole("dialog", { name: "Thông báo", exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { permissionRequests: number }).permissionRequests)).toBe(0);
    expect(pushRequests).toEqual([]);
    await expect(page.locator('.toast.error, [data-sonner-toast][data-type="error"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await tap(page, page.locator(".mobile-logout"));
    await expect(page).toHaveURL(/\/$/);
    const session = await page.request.get("/api/auth/session");
    expect(await session.json()).toEqual({});
  });
}

test("localhost worker controls the page without populating BHX caches", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await Promise.all((await caches.keys()).filter((key) => key.startsWith("bhx-")).map((key) => caches.delete(key)));
    await Promise.all((await navigator.serviceWorker.getRegistrations()).map((registration) => registration.unregister()));
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(/\/sw\.js$/);
  const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.active?.scriptURL));
  expect(registrations).toEqual([new URL("/sw.js", page.url()).href]);
  for (const path of ["/login", "/kiosk", "/demo/esl-labels"]) await page.goto(path);
  expect(await page.evaluate(async () => (await caches.keys()).filter((key) => key.startsWith("bhx-")))).toEqual([]);
});

test("live ESL labels contain QR, assignment, task meaning and unsplit A4 cards", async ({ page }) => {
  nextEnv.loadEnvConfig(process.cwd());
  const { prisma } = await import("../../src/lib/db");
  try {
    await page.goto("/demo/esl-labels");
    const storeId = await page.getByLabel("Cửa hàng", { exact: true }).inputValue();
    const esls = await prisma.eSL.findMany({ where: { storeId }, include: { product: true, shelf: true } });
    const tasks = await prisma.task.findMany({ where: { storeId, status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } } });
    expect(esls.length).toBeGreaterThan(0);
    await expect(page.locator(".esl-label-card")).toHaveCount(esls.length);
    await page.addScriptTag({ path: "node_modules/@zxing/browser/umd/zxing-browser.min.js" });
    for (const esl of esls) {
      const card = page.locator(".esl-label-card").filter({ has: page.getByRole("heading", { name: esl.code, exact: true }) });
      await expect(card).toContainText(esl.product.name);
      await expect(card).toContainText(`${esl.shelf.code} · ${esl.shelf.label}`);
      await expect(card.getByRole("img", { name: `QR cho ${esl.code}`, exact: true })).toHaveJSProperty("naturalWidth", 320);
      const decoded = await card.locator("img").evaluate(async (image) => {
        const zxing = (window as typeof window & { ZXingBrowser: { BrowserQRCodeReader: new () => { decodeFromImageElement(element: HTMLImageElement): Promise<{ getText(): string }> } } }).ZXingBrowser;
        return (await new zxing.BrowserQRCodeReader().decodeFromImageElement(image as HTMLImageElement)).getText();
      });
      expect(decoded).toBe(esl.code);
      const badges = ["RESTOCK", "FEFO", "QUARANTINE"].filter((type) => tasks.some((task) => task.shelfId === esl.shelfId && task.productId === esl.productId && task.type === type));
      if (badges.length) await expect(card.locator(".esl-label-badge")).toHaveText(badges);
      else await expect(card).toContainText("Không có nhiệm vụ");
    }
    await expect(page.locator(".esl-label-badge").first()).toBeVisible();
    await expect(page.locator(".esl-label-no-task").first()).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await page.setViewportSize({ width: 794, height: 1123 });
    await expect(page.getByRole("button", { name: "In A4" })).toBeHidden();
    await expect(page.locator(".esl-label-toolbar")).toBeHidden();
    const layout = await page.locator(".esl-label-sheet").evaluateAll((sheets) => sheets.map((sheet) => ({
      columns: getComputedStyle(sheet).gridTemplateColumns.split(" ").length,
      breakBefore: getComputedStyle(sheet).breakBefore,
      height: sheet.getBoundingClientRect().height,
      cards: [...sheet.children].map((card) => ({ breakInside: getComputedStyle(card).breakInside, qrWidth: card.querySelector("img")!.getBoundingClientRect().width })),
    })));
    for (const [index, sheet] of layout.entries()) {
      expect(sheet.columns).toBe(2);
      expect(sheet.cards.length).toBeLessThanOrEqual(4);
      expect(sheet.height).toBeLessThanOrEqual(277 * 96 / 25.4);
      if (index) expect(sheet.breakBefore).toBe("page");
      for (const card of sheet.cards) { expect(card.breakInside).toBe("avoid"); expect(card.qrWidth).toBeCloseTo(58 * 96 / 25.4, 1); }
    }
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const pages = [...pdf.toString("latin1").matchAll(/\/Type \/Page\b/g)].length;
    expect(pages).toBe(Math.ceil(esls.length / 4));
    const mediaBox = pdf.toString("latin1").match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
    expect(mediaBox).not.toBeNull();
    expect(Number(mediaBox![1])).toBeCloseTo(210 * 72 / 25.4, 0);
    expect(Number(mediaBox![2])).toBeCloseTo(297 * 72 / 25.4, 0);
  } finally { await prisma.$disconnect(); }
});

async function readable(page: Page, selectors: string[], minimum = 14) {
  for (const selector of selectors) {
    const nodes = page.locator(selector);
    await expect(nodes.first(), selector).toBeVisible({ timeout: 20_000 });
    for (const node of await nodes.all()) {
      if (await node.isVisible()) expect(await node.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)), selector).toBeGreaterThanOrEqual(minimum);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

for (const width of [320, 390, 768]) {
  test(`${width}px key screens preserve readable typography, hit boxes and page width`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto("/");
    await expect(page.locator(".experience-card")).toHaveCount(2);
    await readable(page, [".landing-hero p", ".card-copy > span", ".demo-links a"]);
    await page.goto("/staff/login");
    await readable(page, [".login-card p", ".login-card input", ".login-card form button"]);
    await page.goto("/demo/esl-labels");
    await readable(page, [".esl-label-toolbar p", ".esl-label-product", ".esl-label-location", ".esl-label-toolbar button"]);
    await page.goto("/kiosk");
    await readable(page, [".kiosk-search input", ".kiosk-search button"]);
    await signIn(page, "staff");
    await expect(page.locator(".task-copy").first()).toBeVisible();
    await readable(page, [".task-copy strong"]);
    await readable(page, [".nav-label"], width < 768 ? 13 : 14);
    await readable(page, [".workspace-header p", ".task-copy > span"], 12);
    for (const control of [page.getByRole("button", { name: /^Thông báo/ }), page.locator('button[aria-label="Đăng xuất"]:visible'), page.getByRole("button", { name: "Quét ESL", exact: true })]) {
      const box = await control.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
      await control.click({ trial: true });
    }
    await page.getByRole("button", { name: "Quét ESL", exact: true }).click();
    await readable(page, [".esl-scanner-modal .modal-head p", ".esl-scanner-modal input"]);
    await page.getByLabel("Đóng tra cứu ESL").click();
    await page.getByRole("button", { name: /^Thông báo/ }).click();
    await readable(page, [".notification-status", ".notification-list p, .notification-empty p"]);
    await page.keyboard.press("Escape");
    await signIn(page, "admin");
    await page.getByRole("button", { name: "Sơ đồ & ESL", exact: true }).click();
    await readable(page, [".admin-map-instructions", ".admin-actions .button"]);
    expect(await page.locator(".admin-map-scroll").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  });
}
