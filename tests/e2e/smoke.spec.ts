import { expect, test } from "@playwright/test";

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

test("admin can sign in and open store operations", async ({ page }) => {
  await page.goto("/login?callbackUrl=/admin");
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.locator('input[type="password"]').fill("Demo@123");
  await page.getByRole("button", { name: /Đăng nhập/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();
  await expect(page.getByText("Luồng tích hợp")).toBeVisible();
});
