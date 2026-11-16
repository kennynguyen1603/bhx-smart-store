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

test("Manager opens single and multi-task ESL results read-only without mutation requests", async ({ page }) => {
  test.setTimeout(120_000);
  nextEnv.loadEnvConfig(process.cwd());
  const { prisma } = await import("../../src/lib/db");
  const [singleEsl, multiEsl] = await Promise.all([
    prisma.eSL.findUniqueOrThrow({ where: { code: "ESL-NT-Q5-T-03" } }),
    prisma.eSL.findUniqueOrThrow({ where: { code: "ESL-NT-Q5-T-05" } }),
  ]);
  const affectedTasks = await prisma.task.findMany({
    where: { OR: [singleEsl, multiEsl].map((esl) => ({ storeId: esl.storeId, shelfId: esl.shelfId, productId: esl.productId })) },
    select: { id: true, status: true, assigneeId: true, completedAt: true },
  });
  const createdIds: string[] = [];
  const mutationRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && /\/api\/staff\/tasks\/.+\/(start|restock|fefo)$/.test(new URL(request.url()).pathname)) mutationRequests.push(request.url());
  });

  try {
    await prisma.task.updateMany({ where: { id: { in: affectedTasks.map((task) => task.id) } }, data: { status: "COMPLETED", completedAt: new Date() } });
    const single = await prisma.task.create({ data: { storeId: singleEsl.storeId, shelfId: singleEsl.shelfId, productId: singleEsl.productId, type: "RESTOCK", status: "OPEN", title: `Manager single ESL ${Date.now()}` } });
    const multiple = await Promise.all(["RESTOCK", "FEFO"].map((type, index) => prisma.task.create({ data: { storeId: multiEsl.storeId, shelfId: multiEsl.shelfId, productId: multiEsl.productId, type: type as "RESTOCK" | "FEFO", status: index ? "BLOCKED" : "OPEN", title: `Manager multi ESL ${index + 1} ${Date.now()}` } })));
    createdIds.push(single.id, ...multiple.map((task) => task.id));

    await authenticateStaffApp(page, "manager@demo.bhx");
    await page.getByRole("button", { name: "Quét ESL" }).click();
    await page.getByRole("textbox", { name: "Mã ESL tra cứu" }).fill(singleEsl.code);
    await page.getByRole("button", { name: "Tra cứu", exact: true }).click();
    await expect(page.getByRole("heading", { name: single.title })).toBeVisible();
    await expect(page.getByText("Chế độ chỉ xem")).toBeVisible();
    await expect(page.getByRole("button", { name: "Xác nhận bổ sung" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Xác minh" })).toHaveCount(0);
    await page.getByRole("button", { name: "Đóng nhiệm vụ" }).click();

    await page.getByRole("button", { name: "Quét ESL" }).click();
    await page.getByRole("textbox", { name: "Mã ESL tra cứu" }).fill(multiEsl.code);
    await page.getByRole("button", { name: "Tra cứu", exact: true }).click();
    const choices = page.locator(".esl-task-choices");
    await choices.getByRole("button", { name: new RegExp(multiple[1].title) }).click();
    await expect(page.getByRole("heading", { name: multiple[1].title })).toBeVisible();
    await expect(page.getByText("Chế độ chỉ xem")).toBeVisible();
    await expect(page.getByRole("button", { name: /Xác nhận/ })).toHaveCount(0);
    expect(mutationRequests).toEqual([]);
  } finally {
    await prisma.task.deleteMany({ where: { id: { in: createdIds } } });
    for (const { id, ...data } of affectedTasks) await prisma.task.update({ where: { id }, data });
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
    const olderRequestAborted = page.waitForEvent("requestfailed", (request) => new URL(request.url()).pathname === `/api/esl/${taskEsl.code}`);
    await input.fill(emptyEsl.code);
    await input.press("Enter");
    await expect(page.getByText("Không có nhiệm vụ đang mở")).toBeVisible();
    await expect(page.locator(".esl-lookup-result")).toContainText(emptyEsl.code);

    releaseOlderLookup();
    expect((await olderRequestAborted).failure()?.errorText).toBe("net::ERR_ABORTED");
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

for (const [role, account] of [["Staff", "staff@demo.bhx"], ["Manager", "manager@demo.bhx"]] as const) {
  test(`mobile staff navbar keeps four-state ESL navigation deterministic for ${role}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await authenticateStaffApp(page, account);
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

    const overviewTab = page.getByRole("button", { name: "Tổng quan" });
    const tasksTab = page.getByRole("button", { name: "Nhiệm vụ" });
    const scannerTab = page.getByRole("button", { name: "Quét ESL" });
    await tasksTab.click();
    await expect(tasksTab).toHaveClass(/active/);
    await expect(page.getByRole("heading", { name: "Tất cả nhiệm vụ" })).toBeVisible();

    await scannerTab.click();
    await expect(scannerTab).toHaveClass(/active/);
    await expect(tasksTab).not.toHaveClass(/active/);
    await expect(page.getByRole("heading", { name: "Tất cả nhiệm vụ" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Tra cứu ESL" })).toBeVisible();

    await page.getByRole("button", { name: "Đóng tra cứu ESL" }).click();
    await expect(page.getByRole("heading", { name: "Tra cứu ESL" })).toHaveCount(0);
    await expect(overviewTab).toHaveClass(/active/);
    await expect(tasksTab).not.toHaveClass(/active/);

    const logout = page.getByRole("button", { name: "Đăng xuất" });
    await expect(logout).toBeVisible();
    await expect(logout).toBeEnabled();
    await logout.click();
    await expect(page).toHaveURL((url) => url.pathname === "/");
  });
}

test("mobile notification remains topmost and enables push only through explicit two-phase setup", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const permissionState = { calls: 0, hadGesture: false };
    Object.assign(window, { pushPermissionState: permissionState });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "default", requestPermission: async () => {
        permissionState.calls += 1;
        permissionState.hadGesture = navigator.userActivation.isActive;
        return "granted";
      } },
    });
    Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} });
    const registration = {
      active: { state: "activated", scriptURL: new URL("/sw.js", location.href).href },
      pushManager: {
        getSubscription: async () => null,
        subscribe: async () => ({
          toJSON: () => ({ endpoint: "https://push.example/mobile", keys: { auth: "auth", p256dh: "key" } }),
        }),
      },
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: async () => registration,
      },
    });
  });

  let pushPosts = 0;
  let readinessGets = 0;
  let releaseFirstPost!: () => void;
  const firstPostGate = new Promise<void>((resolve) => { releaseFirstPost = resolve; });
  await page.route("**/api/push/subscriptions", async (route) => {
    if (route.request().method() === "GET") {
      readinessGets += 1;
      await route.fulfill({ json: { configured: true, publicKey: "AQID" } });
      return;
    }
    expect(route.request().method()).toBe("POST");
    pushPosts += 1;
    if (pushPosts === 1) await firstPostGate;
    await route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticateStaffApp(page, "staff@demo.bhx");

  for (const [index, width] of [320, 390, 760].entries()) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    const notification = page.locator(".notification-button");
    await expect(notification).toBeVisible();
    await expect(notification).toBeEnabled();
    const layout = await notification.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const siblings = Array.from(button.parentElement!.children).filter((element) => element !== button);
      const overlaps = siblings.some((element) => {
        const sibling = element.getBoundingClientRect();
        return rect.left < sibling.right && rect.right > sibling.left && rect.top < sibling.bottom && rect.bottom > sibling.top;
      });
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const topmost = document.elementFromPoint(center.x, center.y);
      return {
        width: rect.width,
        height: rect.height,
        flexShrink: getComputedStyle(button).flexShrink,
        overlaps,
        topmost: topmost === button || button.contains(topmost),
        center,
      };
    });
    expect(layout.width).toBeGreaterThanOrEqual(44);
    expect(layout.height).toBeGreaterThanOrEqual(44);
    expect(layout.flexShrink).toBe("0");
    expect(layout.overlaps).toBe(false);
    expect(layout.topmost).toBe(true);

    await page.mouse.click(layout.center.x, layout.center.y);
    const dialog = page.getByRole("dialog", { name: "Thông báo", exact: true });
    await expect(dialog).toBeVisible();
    expect(pushPosts).toBe(index);
    expect(readinessGets).toBe(index);
    const permissionState = () => page.evaluate(() => (window as typeof window & { pushPermissionState: { calls: number; hadGesture: boolean } }).pushPermissionState);
    expect(await permissionState()).toEqual({ calls: 0, hadGesture: false });
    await dialog.getByRole("button", { name: "Bật thông báo trên thiết bị", exact: true }).click();
    const allow = dialog.getByRole("button", { name: "Cho phép thông báo trên thiết bị", exact: true });
    await expect(allow).toBeVisible();
    expect(readinessGets).toBe(index + 1);
    expect(pushPosts).toBe(index);
    expect(await permissionState()).toEqual({ calls: 0, hadGesture: false });
    await allow.click();
    await expect.poll(() => pushPosts).toBe(index + 1);
    expect(await permissionState()).toEqual({ calls: 1, hadGesture: true });
    if (index === 0) {
      await expect(page.getByRole("button", { name: "Đang bật thông báo" })).toBeDisabled();
      await expect(dialog.locator(".spin")).toBeVisible();
      expect(await page.getByText("Đã bật Web Push cho thiết bị này.").count()).toBe(0);
      releaseFirstPost();
    }
    await expect(page.getByText("Đã bật Web Push cho thiết bị này.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Bật thông báo trên thiết bị", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(notification).toBeEnabled();
  }
});

test("admin can sign in and open store operations", async ({ page }) => {
  await page.goto("/login?callbackUrl=/admin");
  await page.getByRole("button", { name: "Quản trị — cấu hình hệ thống", exact: true }).click();
  await page.locator('input[type="password"]').fill("Demo@123");
  await page.getByRole("button", { name: /Đăng nhập/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();
  await expect(page.getByText("Luồng tích hợp")).toBeVisible();
});


test.describe("Admin core forms", () => {
  test("edits all core resources without native dialogs and preserves a failed write", async ({ page }) => {
    const { overview } = await import("../fixtures/admin-core");
    const nativeDialogs: string[] = [];
    page.on("dialog", async (dialog) => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
    await page.route("**/api/admin/overview**", (route) => route.fulfill({ json: overview }));
    const writes: { url: string; body: unknown }[] = [];
    let failWrite = true;
    let releaseWrite!: () => void;
    let gate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    await page.route(/\/api\/admin\/(stores|inventories|products|suppliers)\//, async (route) => {
      writes.push({ url: route.request().url(), body: route.request().postDataJSON() });
      await gate;
      await route.fulfill(failWrite ? { status: 500, json: { error: { message: "Máy chủ từ chối cập nhật" } } } : { json: { id: "saved" } });
    });
    await page.goto("/login?callbackUrl=/admin");
    await page.getByRole("button", { name: "Quản trị — cấu hình hệ thống", exact: true }).click();
    await page.locator('input[type="password"]').fill("Demo@123");
    await page.getByRole("button", { name: /Đăng nhập/i }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.locator(".workspace-header")).toContainText("123 đường số hai");
    await page.getByRole("button", { name: "Sửa cửa hàng", exact: true }).click();
    expect(nativeDialogs).toEqual([]);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Mã cửa hàng")).toHaveValue("BHX-02");
    await expect(dialog.getByLabel("Mã cửa hàng")).toHaveAttribute("readonly", "");
    await expect(dialog.getByLabel("Tên cửa hàng")).toHaveValue("BHX cửa hàng hai");
    await dialog.getByLabel("Tên cửa hàng").fill("");
    await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(dialog.getByText("Tên cửa hàng phải có ít nhất 2 ký tự")).toBeVisible();
    expect(writes).toHaveLength(0);
    await dialog.getByLabel("Tên cửa hàng").fill("Cửa hàng vừa sửa");
    await dialog.locator("form").evaluate((form) => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await expect.poll(() => writes.length).toBe(1);
    await expect(dialog.getByRole("button", { name: "Đang xử lý…" })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
    releaseWrite();
    await expect(page.getByText("Máy chủ từ chối cập nhật", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Tên cửa hàng")).toHaveValue("Cửa hàng vừa sửa");
    failWrite = false; gate = Promise.resolve();
    await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(dialog).toHaveCount(0); expect(writes).toHaveLength(2);
    await expect(page.getByRole("button", { name: "Sửa cửa hàng", exact: true })).toBeFocused();

    await page.locator(".data-table tbody tr").first().getByRole("button", { name: "Sửa", exact: true }).click();
    await expect(dialog.getByLabel("Số lượng trên kệ")).toHaveValue("7");
    await expect(dialog.getByLabel("Số lượng kho sau")).toHaveValue("19");
    await dialog.getByLabel("Số lượng trên kệ").fill("1.5");
    await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(dialog.getByText("Số lượng phải là số nguyên không âm", { exact: true })).toBeVisible();
    await dialog.getByLabel("Số lượng trên kệ").fill("25");
    await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(dialog.getByText("Số lượng trên kệ không được vượt sức chứa")).toBeVisible();
    await dialog.getByLabel("Số lượng trên kệ").fill("9");
    await dialog.getByRole("button", { name: "Lưu", exact: true }).click(); await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "Danh mục", exact: true }).click();
    await page.locator(".data-table tbody tr").first().getByRole("button", { name: "Sửa", exact: true }).click();
    await expect(dialog.getByLabel("SKU", { exact: true })).toHaveValue("SKU-02");
    await expect(dialog.getByLabel("Mã vạch")).toHaveAttribute("readonly", "");
    await expect(dialog.getByLabel("Danh mục", { exact: true })).toHaveValue("Sữa tươi");
    await dialog.getByRole("button", { name: "Lưu", exact: true }).click(); await expect(dialog).toHaveCount(0);
    await page.locator(".log-row").filter({ hasText: "SUP-02" }).getByRole("button", { name: "Sửa", exact: true }).click();
    await expect(dialog.getByLabel("Mã nhà cung cấp")).toHaveValue("SUP-02");
    await expect(dialog.getByLabel("Quốc gia")).toHaveValue("Việt Nam");
    await expect(dialog.getByLabel("Chứng nhận")).toHaveValue("VietGAP");
    await dialog.getByRole("button", { name: "Lưu", exact: true }).click(); await expect(dialog).toHaveCount(0);
    expect(writes).toHaveLength(5); expect(nativeDialogs).toEqual([]);
  });

  test("creates products, closes on write success with refresh failure, and retries only overview", async ({ page }) => {
    const { overview } = await import("../fixtures/admin-core");
    const nativeDialogs: string[] = [];
    page.on("dialog", async (dialog) => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
    let readCount = 0; let writeCount = 0; let failRefresh = false;
    await page.route("**/api/admin/overview**", async (route) => {
      readCount++;
      await route.fulfill(failRefresh ? { status: 503, json: {} } : { json: overview });
    });
    await page.route("**/api/admin/products", async (route) => { writeCount++; failRefresh = true; await route.fulfill({ json: { id: "new-product" }, status: 201 }); });
    await page.goto("/login?callbackUrl=/admin");
    await page.getByRole("button", { name: "Quản trị — cấu hình hệ thống", exact: true }).click();
    await page.locator('input[type="password"]').fill("Demo@123");
    await page.getByRole("button", { name: /Đăng nhập/i }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole("button", { name: "Danh mục", exact: true }).click();
    await page.getByRole("button", { name: "Thêm sản phẩm", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("SKU", { exact: true }).fill("NEW-01");
    await dialog.getByLabel("Mã vạch").fill("893000000003");
    await dialog.getByLabel("Tên sản phẩm").fill("Sản phẩm mới");
    await dialog.getByLabel("Danh mục", { exact: true }).fill("Sữa");
    await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(/Đã lưu thay đổi nhưng không thể tải lại dữ liệu/)).toBeVisible();
    expect(writeCount).toBe(1); expect(readCount).toBe(2);
    failRefresh = false;
    await page.getByRole("button", { name: "Tải lại dữ liệu", exact: true }).click();
    await expect.poll(() => readCount).toBe(3);
    expect(writeCount).toBe(1); expect(nativeDialogs).toEqual([]);
  });
});

async function signInAdmin(page: Page) {
  await page.goto("/login?callbackUrl=/admin");
  await page.getByRole("button", { name: "Quản trị — cấu hình hệ thống", exact: true }).click();
  await page.locator('input[type="password"]').fill("Demo@123");
  await page.getByRole("button", { name: /Đăng nhập/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("Admin reference forms preserve IDs, every ESL, and multiple memberships/default", async ({ page }) => {
  const { referenceOverview, otherStore } = await import("../fixtures/admin-reference");
  const native: string[] = [];
  page.on("dialog", async dialog => { native.push(dialog.type()); await dialog.dismiss(); });
  await page.route("**/api/admin/overview**", route => route.fulfill({ json: referenceOverview }));
  const writes: { url: string; body: Record<string, unknown> }[] = [];
  await page.route(/\/api\/admin\/(shelves|esls|users)\//, async route => { writes.push({ url: route.request().url(), body: route.request().postDataJSON() }); await route.fulfill({ json: { id: "saved" } }); });
  await signInAdmin(page);
  await page.getByRole("button", { name: "Sơ đồ & ESL", exact: true }).click();
  await expect(page.getByText("ESL-ONE", { exact: true })).toBeVisible(); await expect(page.getByText("ESL-TWO", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sửa kệ K-02", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Mã kệ", { exact: true })).toHaveAttribute("readonly", "");
  await expect(dialog.getByLabel("Khu vực", { exact: true })).toContainText("Khu thứ hai");
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(writes[0].body).toEqual({ label: "Kệ thứ hai", zoneId: "zone-second", x: 3, y: 2, width: 2, height: 3 });
  await page.getByRole("button", { name: "Sửa ESL ESL-TWO", exact: true }).click();
  await expect(dialog.getByLabel("Sản phẩm", { exact: true })).toContainText("Sản phẩm thứ hai");
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(writes[1].body).toEqual({ shelfId: "shelf-second", productId: "product-second", ledOn: true });
  await page.getByRole("button", { name: "Người dùng", exact: true }).click();
  await page.locator("tr").filter({ hasText: "hai@example.com" }).getByRole("button", { name: "Sửa", exact: true }).click();
  await expect(dialog.getByLabel("Email", { exact: true })).toHaveAttribute("readonly", "");
  await expect(dialog.getByLabel("Cửa hàng mặc định", { exact: true })).toContainText(otherStore.name);
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(writes[2].body).toEqual({ name: "Người dùng hai", role: "MANAGER", active: false, storeIds: [otherStore.id, "store"] });
  expect(native).toEqual([]);
});

test("Admin destructive actions cancel without requests and confirm once with pending protection", async ({ page }) => {
  const { referenceOverview } = await import("../fixtures/admin-reference");
  const native: string[] = [];
  page.on("dialog", async dialog => { native.push(dialog.type()); await dialog.dismiss(); });
  await page.route("**/api/admin/overview**", route => route.fulfill({ json: referenceOverview }));
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; }); let writes = 0;
  await page.route("**/api/admin/stores/store", async route => { expect(route.request().method()).toBe("DELETE"); writes++; await gate; await route.fulfill({ status: 204 }); });
  await signInAdmin(page);
  const trigger = page.getByRole("button", { name: "Vô hiệu hoá", exact: true }); await trigger.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading")).toHaveText("Vô hiệu hoá cửa hàng");
  await expect(dialog).toContainText("BHX cửa hàng hai"); await expect(dialog).toContainText("Cửa hàng sẽ ngừng hoạt động");
  await dialog.getByRole("button", { name: "Hủy", exact: true }).click(); await expect(dialog).toHaveCount(0); expect(writes).toBe(0);
  await trigger.click();
  await dialog.getByRole("button", { name: "Vô hiệu hoá", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => writes).toBe(1); await expect(dialog.getByRole("button", { name: "Hủy", exact: true })).toBeDisabled(); await expect(dialog.getByRole("button", { name: "Đang xử lý…" })).toBeDisabled();
  await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5); await expect(dialog).toBeVisible();
  release(); await expect(dialog).toHaveCount(0); expect(writes).toBe(1); expect(native).toEqual([]); await expect(trigger).toBeFocused();
});

test("integration loading blocks duplicate writes until the overview refresh attempt finishes", async ({ page }) => {
  const { overview } = await import("../fixtures/admin-core");
  let readCount = 0;
  let writeCount = 0;
  let releaseWrite!: () => void;
  let releaseRefresh!: () => void;
  const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  await page.route("**/api/admin/overview**", async (route) => {
    readCount += 1;
    if (readCount > 1) {
      await refreshGate;
      await route.fulfill({ status: 503, json: {} });
      return;
    }
    await route.fulfill({ json: overview });
  });
  await page.route("**/api/admin/simulate", async (route) => {
    writeCount += 1;
    await writeGate;
    await route.fulfill({ json: { ok: true } });
  });

  await signInAdmin(page);
  await page.getByRole("button", { name: "Tích hợp", exact: true }).click();
  const simulator = page.locator("section.panel").filter({ hasText: "Mô phỏng dữ liệu đầu vào" });
  const action = simulator.getByRole("button", { name: "POS bán 2 sản phẩm", exact: true });
  await action.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });

  await expect.poll(() => writeCount).toBe(1);
  const pending = simulator.getByRole("button", { name: "Đang xử lý…", exact: true });
  await expect(pending).toBeDisabled();
  await expect(pending.locator(".ui-spinner")).toBeVisible();
  await expect(simulator.getByRole("button")).toHaveCount(4);
  expect(await simulator.getByRole("button").evaluateAll((buttons) => buttons.every((button) => (button as HTMLButtonElement).disabled))).toBe(true);

  releaseWrite();
  await expect(page.getByText("Đã cập nhật dữ liệu.", { exact: true })).toBeVisible();
  await expect.poll(() => readCount).toBe(2);
  await expect(pending).toBeDisabled();
  expect(writeCount).toBe(1);

  releaseRefresh();
  await expect(page.getByText(/Đã lưu thay đổi nhưng không thể tải lại dữ liệu/)).toBeVisible();
  await expect(action).toBeEnabled();
  expect(await simulator.getByRole("button").evaluateAll((buttons) => buttons.every((button) => !(button as HTMLButtonElement).disabled))).toBe(true);
  expect(writeCount).toBe(1);
});
