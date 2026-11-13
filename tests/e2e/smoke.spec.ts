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
