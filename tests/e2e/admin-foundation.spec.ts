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
