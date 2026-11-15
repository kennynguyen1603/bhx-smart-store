import { expect, test, type Page } from "@playwright/test";
import nextEnv from "@next/env";

async function authenticateStaffApp(page: Page, email: string) {
  const request = page.context().request;
  const csrfResponse = await request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBe(true);
  const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
  const loginResponse = await request.post("/api/auth/callback/credentials", {
    form: { csrfToken, email, password: "Demo@123", callbackUrl: "/staff", json: "true" },
    headers: { "X-Auth-Return-Redirect": "1" },
  });
  expect(loginResponse.ok()).toBe(true);
  const cookies = await page.context().cookies();
  expect(cookies.some((cookie) => cookie.name.endsWith("session-token"))).toBe(true);
  await page.goto("/staff");
  await expect(page).toHaveURL((url) => url.pathname === "/staff");
}

test("customer kiosk can search and open a product route", async ({ page }) => {
  await page.goto("/kiosk");
  await expect(page.getByRole("heading", { name: /Bạn đang tìm/i })).toBeVisible();
  await page.getByPlaceholder(/Tìm sữa/i).fill("sua tuoi");
  await page.getByRole("button", { name: "Tìm kiếm" }).click();
  await expect(page.getByText("Sữa tươi Vinamilk 100% 1L")).toBeVisible();
  await page.getByText("Sữa tươi Vinamilk 100% 1L").click();
  await expect(page.getByText("ĐƯỜNG ĐI ĐẾN SẢN PHẨM")).toBeVisible();
  await expect(page.getByText("SƠ ĐỒ TẦNG TRỆT")).toBeVisible();
  await expect(page.getByText("Kiosk lối vào", { exact: true })).toBeVisible();
  await expect(page.getByText("Đường chỉ dẫn")).toBeVisible();
  await expect(page.getByText("TRUY XUẤT NGUỒN GỐC")).toBeVisible();
});

test("product detail cache opens immediately, reuses requests, and isolates stores", async ({ page }) => {
  let detailRequests = 0;
  let mapRequests = 0;
  await page.route("**/api/kiosk/**", async (route) => {
    const url = new URL(route.request().url());
    const isDetail = url.pathname !== "/api/kiosk/products/search" && /\/api\/kiosk\/products\/[^/]+$/.test(url.pathname);
    const isMap = /\/api\/kiosk\/stores\/[^/]+\/map$/.test(url.pathname);
    if (isDetail) detailRequests += 1;
    if (isMap) mapRequests += 1;
    if ((isDetail || isMap) && detailRequests + mapRequests <= 2) await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });

  await page.goto("/kiosk");
  await page.getByPlaceholder(/Tìm sữa/i).fill("sua tuoi");
  await page.getByRole("button", { name: "Tìm kiếm" }).click();
  const card = page.locator(".product-card").filter({ hasText: "Sữa tươi Vinamilk 100% 1L" });
  await card.click();

  await expect(page.locator(".product-detail-info").getByRole("heading", { name: "Sữa tươi Vinamilk 100% 1L" })).toBeVisible();
  await expect(page.getByLabel("Đang tải chỉ đường và truy xuất nguồn gốc")).toBeVisible();
  await expect(page.getByText("Đang đồng bộ dữ liệu cửa hàng…")).toHaveCount(0);
  await expect(page.getByText("SƠ ĐỒ TẦNG TRỆT")).toBeVisible();
  expect({ detailRequests, mapRequests }).toEqual({ detailRequests: 1, mapRequests: 1 });

  await page.getByRole("button", { name: "Đóng chi tiết" }).click();
  await card.click();
  await expect(page.getByText("SƠ ĐỒ TẦNG TRỆT")).toBeVisible();
  expect({ detailRequests, mapRequests }).toEqual({ detailRequests: 1, mapRequests: 1 });

  await page.getByRole("button", { name: "Đóng chi tiết" }).click();
  const storeSelector = page.getByRole("combobox");
  const currentStore = await storeSelector.inputValue();
  const otherStore = await storeSelector.locator("option").evaluateAll((options, current) => options.map((option) => (option as HTMLOptionElement).value).find((value) => value !== current), currentStore);
  expect(otherStore).toBeTruthy();
  await storeSelector.selectOption(otherStore!);
  await page.getByPlaceholder(/Tìm sữa/i).fill("sua tuoi");
  await page.getByRole("button", { name: "Tìm kiếm" }).click();
  await page.locator(".product-card").filter({ hasText: "Sữa tươi Vinamilk 100% 1L" }).click();
  await expect(page.getByText("SƠ ĐỒ TẦNG TRỆT")).toBeVisible();
  expect({ detailRequests, mapRequests }).toEqual({ detailRequests: 2, mapRequests: 2 });
});

test("product detail retry recovers after the first request fails", async ({ page }) => {
  let detailRequests = 0;
  await page.route("**/api/kiosk/products/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/kiosk/products/search" || !/\/api\/kiosk\/products\/[^/]+$/.test(url.pathname)) return route.continue();
    detailRequests += 1;
    if (detailRequests === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary" }) });
    return route.continue();
  });

  await page.goto("/kiosk");
  await page.getByPlaceholder(/Tìm sữa/i).fill("sua tuoi");
  await page.getByRole("button", { name: "Tìm kiếm" }).click();
  await page.locator(".product-card").filter({ hasText: "Sữa tươi Vinamilk 100% 1L" }).click();
  await expect(page.locator(".detail-error")).toContainText("Chưa tải được chỉ đường");
  await page.getByRole("button", { name: "Thử lại" }).click();
  await expect(page.getByText("SƠ ĐỒ TẦNG TRỆT")).toBeVisible();
  expect(detailRequests).toBe(2);
});

test("product detail cache ignores a stale search after switching stores", async ({ page }) => {
  let releaseSearch!: () => void;
  const searchGate = new Promise<void>((resolve) => { releaseSearch = resolve; });
  let delayedSearches = 0;
  await page.route("**/api/kiosk/products/search**", async (route) => {
    delayedSearches += 1;
    if (delayedSearches === 1) await searchGate;
    await route.continue();
  });

  await page.goto("/kiosk");
  const storeSelector = page.getByRole("combobox");
  await expect(storeSelector).not.toHaveValue("");
  const currentStore = await storeSelector.inputValue();
  const otherStore = await storeSelector.locator("option").evaluateAll((options, current) => options.map((option) => (option as HTMLOptionElement).value).find((value) => value !== current), currentStore);
  expect(otherStore).toBeTruthy();

  await page.getByPlaceholder(/Tìm sữa/i).fill("sua tuoi");
  await page.getByRole("button", { name: "Tìm kiếm" }).click();
  await expect.poll(() => delayedSearches).toBe(1);
  await storeSelector.selectOption(otherStore!);
  await expect(page.locator(".kiosk-search .button.primary")).toBeEnabled();
  const staleResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/kiosk/products/search");
  releaseSearch();
  await staleResponse;

  await expect(page.getByRole("heading", { name: /Bạn đang tìm/i })).toBeVisible();
  await expect(page.locator(".product-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tìm kiếm" })).toBeEnabled();
});

test("product detail cache ignores stale openExact search after automatic reset", async ({ page }) => {
  await page.clock.install();
  let releaseSearch!: () => void;
  const searchGate = new Promise<void>((resolve) => { releaseSearch = resolve; });
  let searchRequests = 0;
  let detailRequests = 0;
  await page.route("**/api/kiosk/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/kiosk/products/search") {
      searchRequests += 1;
      await searchGate;
    } else if (/\/api\/kiosk\/products\/[^/]+$/.test(url.pathname) || /\/api\/kiosk\/stores\/[^/]+\/map$/.test(url.pathname)) {
      detailRequests += 1;
    }
    await route.continue();
  });

  await page.goto("/kiosk");
  await expect(page.getByRole("combobox")).not.toHaveValue("");
  await page.getByPlaceholder(/Tìm sữa/i).evaluate((input: HTMLInputElement) => input.blur());
  await page.keyboard.type("8934588012345");
  await page.keyboard.press("Enter");
  await expect.poll(() => searchRequests).toBe(1);
  await page.clock.runFor(120_000);
  const staleResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/kiosk/products/search");
  releaseSearch();
  await staleResponse;
  await page.clock.fastForward(1);

  await expect(page.getByRole("heading", { name: /Bạn đang tìm/i })).toBeVisible();
  await expect(page.locator(".product-card")).toHaveCount(0);
  await expect(page.locator(".map-modal")).toHaveCount(0);
  expect(detailRequests).toBe(0);
});

test("discounted FEFO price is consistent in kiosk list and detail", async ({ page, request }) => {
  nextEnv.loadEnvConfig(process.cwd());
  const { prisma } = await import("../../src/lib/db");
  const bootstrapResponse = await request.get("/api/kiosk/bootstrap");
  const bootstrap = await bootstrapResponse.json() as { stores: { code: string }[] };
  const product = await prisma.product.findUniqueOrThrow({ where: { sku: "MILK-1L" } });
  const store = await prisma.store.findUniqueOrThrow({ where: { code: bootstrap.stores[0].code } });
  const lots = await prisma.lot.findMany({
    where: { productId: product.id, storeId: store.id },
    orderBy: { expiryDate: "asc" },
  });
  const originalLots = lots.map(({ id, status, quantity, markdownPercent, markdownPriceVnd }) => ({ id, status, quantity, markdownPercent, markdownPriceVnd }));

  try {
    await prisma.lot.updateMany({
      where: { productId: product.id, storeId: store.id },
      data: { status: "AVAILABLE", markdownPercent: null, markdownPriceVnd: null },
    });
    await prisma.lot.update({
      where: { id: lots[0].id },
      data: { status: "MARKED_DOWN", quantity: Math.max(1, lots[0].quantity), markdownPercent: 20, markdownPriceVnd: 26_080 },
    });

    await page.goto("/kiosk");
    const storeSelector = page.getByRole("combobox");
    await expect(storeSelector).toHaveValue(store.code);
    await page.getByPlaceholder(/Tìm sữa/i).fill("sua tuoi");
    await page.getByRole("button", { name: "Tìm kiếm" }).click();

    const card = page.locator(".product-card").filter({ hasText: "Sữa tươi Vinamilk 100% 1L" });
    await expect(card.getByText("26.080 ₫", { exact: true })).toBeVisible();
    await expect(card.getByText("32.600 ₫", { exact: true })).toBeVisible();
    await expect(card.getByText("Giảm 20%", { exact: true })).toBeVisible();
    await card.click();

    const detail = page.locator(".product-detail-info");
    await expect(detail.getByText("26.080 ₫", { exact: true })).toBeVisible();
    await expect(detail.getByText("32.600 ₫", { exact: true })).toBeVisible();
    await expect(detail.getByText("Giảm 20%", { exact: true })).toBeVisible();
  } finally {
    await Promise.all(originalLots.map(({ id, ...data }) => prisma.lot.update({ where: { id }, data })));
  }
});

test("camera scanner attaches the media stream to a persistent video preview", async ({ page }) => {
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d")!;
    let frame = 0;
    const draw = () => {
      context.fillStyle = "#dff3e7";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#08783f";
      context.fillRect((frame++ * 8) % canvas.width, 0, 40, canvas.height);
      requestAnimationFrame(draw);
    };
    draw();

    const stream = canvas.captureStream(15);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => stream,
        enumerateDevices: async () => [],
      },
    });
  });

  await page.goto("/kiosk");
  await page.getByRole("button", { name: "Quét", exact: true }).click();
  await page.getByRole("button", { name: /Mở camera/i }).click();

  await expect(page.getByText("Đang quét", { exact: true })).toBeVisible();
  const preview = await page.locator(".scanner-viewport video").evaluate((video: HTMLVideoElement) => ({
    hasStream: video.srcObject instanceof MediaStream,
    hasCurrentData: video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
    width: video.videoWidth,
    height: video.videoHeight,
  }));
  expect(preview.hasStream).toBe(true);
  expect(preview.hasCurrentData).toBe(true);
  expect(preview.width).toBeGreaterThan(0);
  expect(preview.height).toBeGreaterThan(0);

  await page.getByRole("button", { name: /Tắt camera/i }).click();
  await expect(page.getByRole("button", { name: /Mở camera/i })).toBeVisible();
});

test("mobile kiosk maps yogurt to its own shelf without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/kiosk");
  await page.getByPlaceholder(/Tìm sữa/i).fill("sữa chua");
  await page.getByRole("button", { name: "Tìm kiếm" }).click();
  await page.locator(".product-card").filter({ hasText: "Sữa chua Vinamilk có đường lốc 4 hộp" }).click();

  await expect(page.getByRole("heading", { name: "Sữa & đồ lạnh · L-04" })).toBeVisible();
  await expect(page.getByText("Kệ sữa chua", { exact: true }).first()).toBeVisible();
  const layout = await page.evaluate(() => {
    const modal = document.querySelector<HTMLElement>(".map-modal")!;
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      modalOverflow: modal.scrollWidth - modal.clientWidth,
    };
  });
  expect(layout).toEqual({ pageOverflow: 0, modalOverflow: 0 });
});

test("kiosk exposes the expanded catalog and finds Vietnamese text without accents", async ({ page }) => {
  await page.goto("/kiosk");
  await expect(page.locator(".category-grid button")).toHaveCount(7);
  await page.getByPlaceholder(/Tìm sữa/i).fill("pho mai");
  await page.getByRole("button", { name: "Tìm kiếm" }).click();
  await expect(page.getByText("Phô mai Con Bò Cười hộp 8 miếng", { exact: true })).toBeVisible();
  await expect(page.getByText("Kệ phô mai", { exact: false })).toBeVisible();
});

test("store section labels do not overlap shelf cards", async ({ page }) => {
  await page.goto("/kiosk");
  await page.getByPlaceholder(/Tìm sữa/i).fill("banh mi");
  await page.getByRole("button", { name: "Tìm kiếm" }).click();
  await page.locator(".product-card").filter({ hasText: "Bánh mì sandwich lúa mạch 300g" }).click();

  const overlaps = await page.evaluate(() => {
    const shelves = Array.from(document.querySelectorAll(".map-shelf")).map((element) => element.getBoundingClientRect());
    return Array.from(document.querySelectorAll(".map-zone-label")).flatMap((element) => {
      const label = element.getBoundingClientRect();
      const name = element.querySelector("strong")?.textContent || "";
      return shelves.some((shelf) => label.left < shelf.right && label.right > shelf.left && label.top < shelf.bottom && label.bottom > shelf.top) ? [name] : [];
    });
  });
  expect(overlaps).toEqual([]);
});

test("staff can sign in and see assigned tasks", async ({ page }) => {
  await page.goto("/login?callbackUrl=/staff");
  await page.getByLabel("Email").fill("staff@demo.bhx");
  await page.locator('input[type="password"]').fill("Demo@123");
  await page.getByRole("button", { name: /Đăng nhập/i }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByText("Nhiệm vụ ưu tiên")).toBeVisible();
});

test("Staff history is private while Manager completed tasks show oversight details", async ({ page }) => {
  test.setTimeout(120_000);
  nextEnv.loadEnvConfig(process.cwd());
  const { prisma } = await import("../../src/lib/db");
  const staff = await prisma.user.findUniqueOrThrow({ where: { email: "staff@demo.bhx" }, include: { userStores: true } });
  const inventory = await prisma.inventory.findFirstOrThrow({ where: { storeId: staff.userStores[0].storeId } });
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const otherStaff = await prisma.user.create({
    data: {
      email: `visibility-${runId}@demo.bhx`,
      name: "Nhân viên Khác",
      passwordHash: "not-used",
      role: "STAFF",
      userStores: { create: { storeId: inventory.storeId, isDefault: true } },
    },
  });
  const completedAt = new Date("2026-11-15T03:45:00.000Z");
  const task = await prisma.task.create({
    data: {
      storeId: inventory.storeId,
      productId: inventory.productId,
      shelfId: inventory.shelfId,
      assigneeId: otherStaff.id,
      type: "RESTOCK",
      status: "COMPLETED",
      title: `Nhiệm vụ riêng của nhân viên khác ${runId}`,
      completedAt,
      events: { create: { actorId: otherStaff.id, type: "COMPLETED", note: "Sự kiện riêng Task 2" } },
    },
  });

  try {
    await authenticateStaffApp(page, "staff@demo.bhx");
    await page.getByRole("button", { name: "Lịch sử" }).click();
    await expect(page.getByText("Sự kiện riêng Task 2")).toHaveCount(0);

    await page.context().clearCookies();
    await authenticateStaffApp(page, "manager@demo.bhx");
    await page.getByRole("button", { name: "Nhiệm vụ" }).click();
    await page.getByRole("button", { name: "Hoàn thành" }).click();

    const row = page.locator(".task-row").filter({ hasText: task.title });
    await expect(row).toContainText("Nhân viên Khác");
    await expect(row).toContainText(new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(completedAt));
    await expect(row).toBeDisabled();
  } finally {
    await prisma.task.delete({ where: { id: task.id } });
    await prisma.user.delete({ where: { id: otherStaff.id } });
  }
});

test("ESL scanner handles zero, one, many, and inaccessible store results", async ({ page }) => {
  test.setTimeout(120_000);
  nextEnv.loadEnvConfig(process.cwd());
  const { prisma } = await import("../../src/lib/db");
  const staff = await prisma.user.findUniqueOrThrow({ where: { email: "staff@demo.bhx" } });
  const esls = await Promise.all([
    prisma.eSL.findUniqueOrThrow({ where: { code: "ESL-NT-Q5-T-01" } }),
    prisma.eSL.findUniqueOrThrow({ where: { code: "ESL-NT-Q5-T-03" } }),
    prisma.eSL.findUniqueOrThrow({ where: { code: "ESL-NT-Q5-T-05" } }),
  ]);
  const affectedTasks = await prisma.task.findMany({
    where: { OR: esls.map((esl) => ({ storeId: esl.storeId, shelfId: esl.shelfId, productId: esl.productId })) },
    select: { id: true, status: true, assigneeId: true, completedAt: true },
  });
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const createdTaskIds: string[] = [];

  try {
    await prisma.task.updateMany({
      where: { id: { in: affectedTasks.map((task) => task.id) } },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    const oneTask = await prisma.task.create({
      data: {
        storeId: esls[1].storeId,
        shelfId: esls[1].shelfId,
        productId: esls[1].productId,
        assigneeId: staff.id,
        type: "RESTOCK",
        status: "OPEN",
        title: `ESL single task ${runId}`,
      },
    });
    const manyTasks = await Promise.all(["RESTOCK", "FEFO"].map((type, index) => prisma.task.create({
      data: {
        storeId: esls[2].storeId,
        shelfId: esls[2].shelfId,
        productId: esls[2].productId,
        type: type as "RESTOCK" | "FEFO",
        status: index === 0 ? "OPEN" : "BLOCKED",
        title: `ESL choice ${index + 1} ${runId}`,
      },
    })));
    createdTaskIds.push(oneTask.id, ...manyTasks.map((task) => task.id));

    await authenticateStaffApp(page, "staff@demo.bhx");
    await expect(page.getByRole("combobox")).not.toHaveValue("", { timeout: 20_000 });
    await page.getByRole("button", { name: "Quét ESL" }).click();
    await expect(page.getByRole("heading", { name: "Tra cứu ESL" })).toBeVisible();

    const input = page.getByRole("textbox", { name: "Mã ESL tra cứu" });
    await input.fill(esls[0].code);
    await page.getByRole("button", { name: "Tra cứu", exact: true }).click();
    await expect(page.getByText("Không có nhiệm vụ đang mở")).toBeVisible();
    const qrImage = page.getByRole("img", { name: `QR cho ${esls[0].code}` });
    await expect(qrImage).toBeVisible();
    await page.addScriptTag({ path: "node_modules/@zxing/browser/umd/zxing-browser.min.js" });
    const decodedEslCode = await qrImage.evaluate(async (image) => {
      const zxing = (window as typeof window & {
        ZXingBrowser: {
          BrowserQRCodeReader: new () => {
            decodeFromImageElement(element: HTMLImageElement): Promise<{ getText(): string }>;
          };
        };
      }).ZXingBrowser;
      const result = await new zxing.BrowserQRCodeReader().decodeFromImageElement(image as HTMLImageElement);
      return result.getText();
    });
    expect(decodedEslCode).toBe(esls[0].code);
    await expect(
      page.getByRole("region", { name: "Nhãn QR ESL" }).getByText(esls[0].code, { exact: true }),
    ).toBeVisible();

    await input.fill(esls[1].code);
    await page.getByRole("button", { name: "Tra cứu", exact: true }).click();
    await expect(page.getByRole("heading", { name: oneTask.title })).toBeVisible();
    await page.getByRole("button", { name: "Để sau" }).click();

    await page.getByRole("button", { name: "Quét ESL" }).click();
    await page.getByRole("textbox", { name: "Mã ESL tra cứu" }).fill(esls[2].code);
    await page.getByRole("button", { name: "Tra cứu", exact: true }).click();
    await expect(page.getByText("Chọn nhiệm vụ cần mở")).toBeVisible();
    const taskChoices = page.locator(".esl-task-choices");
    await expect(taskChoices.getByRole("button", { name: new RegExp(manyTasks[0].title) })).toBeVisible();
    await expect(taskChoices.getByRole("button", { name: new RegExp(manyTasks[1].title) })).toBeVisible();
    await taskChoices.getByRole("button", { name: new RegExp(manyTasks[0].title) }).click();
    await expect(page.getByRole("heading", { name: manyTasks[0].title })).toBeVisible();
    await page.getByRole("button", { name: "Để sau" }).click();

    await page.getByRole("button", { name: "Quét ESL" }).click();
    await page.getByRole("textbox", { name: "Mã ESL tra cứu" }).fill("ESL-LVV-TD-T-01");
    await page.getByRole("button", { name: "Tra cứu", exact: true }).click();
    await expect(page.getByText("Mã ESL không tồn tại hoặc thuộc cửa hàng khác.")).toBeVisible();
    await expect(page.locator(".esl-qr-demo")).toHaveCount(0);
  } finally {
    await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
    for (const { id, ...data } of affectedTasks) {
      await prisma.task.update({ where: { id }, data });
    }
  }
});

test("ESL lookup uses the newest response and opens a task missing from stale polling", async ({ page }) => {
  test.setTimeout(120_000);
  nextEnv.loadEnvConfig(process.cwd());
  const { prisma } = await import("../../src/lib/db");
  const staff = await prisma.user.findUniqueOrThrow({ where: { email: "staff@demo.bhx" } });
  const [emptyEsl, taskEsl, multiTaskEsl] = await Promise.all([
    prisma.eSL.findUniqueOrThrow({ where: { code: "ESL-NT-Q5-T-01" } }),
    prisma.eSL.findUniqueOrThrow({ where: { code: "ESL-NT-Q5-T-03" } }),
    prisma.eSL.findUniqueOrThrow({ where: { code: "ESL-NT-Q5-T-05" } }),
  ]);
  const affectedTasks = await prisma.task.findMany({
    where: { OR: [emptyEsl, taskEsl, multiTaskEsl].map((esl) => ({ storeId: esl.storeId, shelfId: esl.shelfId, productId: esl.productId })) },
    select: { id: true, status: true, assigneeId: true, completedAt: true },
  });
  const freshTaskIds: string[] = [];

  try {
    await prisma.task.updateMany({
      where: { id: { in: affectedTasks.map((task) => task.id) } },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await authenticateStaffApp(page, "staff@demo.bhx");
    await expect(page.getByRole("combobox")).not.toHaveValue("", { timeout: 20_000 });

    const freshTask = await prisma.task.create({
      data: {
        storeId: taskEsl.storeId,
        shelfId: taskEsl.shelfId,
        productId: taskEsl.productId,
        assigneeId: staff.id,
        type: "RESTOCK",
        status: "OPEN",
        title: `Fresh ESL task ${Date.now()}`,
      },
    });
    freshTaskIds.push(freshTask.id);

    await page.getByRole("button", { name: "Quét ESL" }).click();
    await page.getByRole("textbox", { name: "Mã ESL tra cứu" }).fill(taskEsl.code);
    const refreshAfterStart = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/staff/tasks");
    await page.getByRole("button", { name: "Tra cứu", exact: true }).click();
    await expect(page.getByRole("heading", { name: freshTask.title })).toBeVisible();
    await refreshAfterStart;
    await page.getByRole("button", { name: "Để sau" }).click();

    const multiTasks = await Promise.all(["RESTOCK", "FEFO"].map((type, index) => prisma.task.create({
      data: {
        storeId: multiTaskEsl.storeId,
        shelfId: multiTaskEsl.shelfId,
        productId: multiTaskEsl.productId,
        type: type as "RESTOCK" | "FEFO",
        status: index === 0 ? "OPEN" : "BLOCKED",
        title: `Fresh multi ESL task ${index + 1} ${Date.now()}`,
      },
    })));
    freshTaskIds.push(...multiTasks.map((task) => task.id));
    await page.getByRole("button", { name: "Quét ESL" }).click();
    await page.getByRole("textbox", { name: "Mã ESL tra cứu" }).fill(multiTaskEsl.code);
    await page.getByRole("button", { name: "Tra cứu", exact: true }).click();
    const freshChoices = page.locator(".esl-task-choices");
    await expect(freshChoices.getByRole("button", { name: new RegExp(multiTasks[0].title) })).toBeVisible();
    await freshChoices.getByRole("button", { name: new RegExp(multiTasks[0].title) }).click();
    await expect(page.getByRole("heading", { name: multiTasks[0].title })).toBeVisible();
    await page.getByRole("button", { name: "Để sau" }).click();

    let releaseOlderLookup!: () => void;
    const olderLookupGate = new Promise<void>((resolve) => { releaseOlderLookup = resolve; });
    let olderLookupRequests = 0;
    await page.route(`**/api/esl/${taskEsl.code}`, async (route) => {
      olderLookupRequests += 1;
      await olderLookupGate;
      await route.continue();
    });

    await page.getByRole("button", { name: "Quét ESL" }).click();
    const input = page.getByRole("textbox", { name: "Mã ESL tra cứu" });
    await input.fill(taskEsl.code);
    await page.getByRole("button", { name: "Tra cứu", exact: true }).click();
    await expect.poll(() => olderLookupRequests).toBe(1);
    await input.fill(emptyEsl.code);
    await input.press("Enter");
    await expect(page.getByText("Không có nhiệm vụ đang mở")).toBeVisible();
    await expect(page.locator(".esl-lookup-result")).toContainText(emptyEsl.code);

    const olderResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/esl/${taskEsl.code}`);
    releaseOlderLookup();
    await olderResponse;
    await expect(page.getByRole("heading", { name: "Tra cứu ESL" })).toBeVisible();
    await expect(page.locator(".esl-lookup-result")).toContainText(emptyEsl.code);
    await expect(page.getByRole("heading", { name: freshTask.title })).toHaveCount(0);
  } finally {
    await prisma.task.deleteMany({ where: { id: { in: freshTaskIds } } });
    for (const { id, ...data } of affectedTasks) {
      await prisma.task.update({ where: { id }, data });
    }
  }
});

test("mobile staff navbar keeps labels aligned when the task badge is visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login?callbackUrl=/staff");
  await page.getByLabel("Email").fill("staff@demo.bhx");
  await page.locator('input[type="password"]').fill("Demo@123");
  await page.getByRole("button", { name: /Đăng nhập/i }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.locator(".side-nav .nav-label")).toHaveCount(4);
  await expect(page.locator(".side-nav .count")).toBeVisible();

  const layout = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll<HTMLElement>(".side-nav .nav-label"));
    const taskLabel = labels.find((label) => label.textContent?.trim() === "Nhiệm vụ")!.getBoundingClientRect();
    const badge = document.querySelector<HTMLElement>(".side-nav .count")!.getBoundingClientRect();
    const labelTops = labels.map((label) => label.getBoundingClientRect().top);
    return {
      labelOffset: Math.max(...labelTops) - Math.min(...labelTops),
      badgeOverlapsLabel: badge.left < taskLabel.right && badge.right > taskLabel.left && badge.top < taskLabel.bottom && badge.bottom > taskLabel.top,
    };
  });
  expect(layout.labelOffset).toBeLessThanOrEqual(1);
  expect(layout.badgeOverlapsLabel).toBe(false);
});

test("admin can sign in and open store operations", async ({ page }) => {
  await page.goto("/login?callbackUrl=/admin");
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.locator('input[type="password"]').fill("Demo@123");
  await page.getByRole("button", { name: /Đăng nhập/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();
  await expect(page.getByText("Luồng tích hợp")).toBeVisible();
});
