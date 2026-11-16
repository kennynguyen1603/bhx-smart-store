import { expect } from "@playwright/test";
import { test } from "./shelf-restoration";
import type { AdminMapStore } from "../../src/components/admin/admin-map-editor";

test("intentional body timeout with an outstanding shelf write", async ({ page, withRestoredShelf }) => {
  const { csrfToken } = await (await page.request.get("/api/auth/csrf")).json();
  expect((await page.request.post("/api/auth/callback/credentials", {
    form: { csrfToken, email: "admin@demo.bhx", password: "Demo@123", callbackUrl: "/admin", json: "true" },
  })).ok()).toBe(true);
  await page.goto("/admin");
  const data = await (await page.request.get("/api/admin/overview")).json() as { selectedStoreId: string; stores: AdminMapStore[] };
  const store = data.stores.find((item) => item.id === data.selectedStoreId)!;
  await withRestoredShelf(store, async (shelf) => {
    let target: { x: number; y: number } | undefined;
    for (let y = 0; y + shelf.height <= store.mapHeight && !target; y++) {
      for (let x = 0; x + shelf.width <= store.mapWidth && !target; x++) {
        if (x === shelf.x && y === shelf.y) continue;
        if (store.shelves.every((other) => other.id === shelf.id || x + shelf.width <= other.x || x >= other.x + other.width || y + shelf.height <= other.y || y >= other.y + other.height)) target = { x, y };
      }
    }
    expect(target).toBeDefined();
    let issued!: () => void;
    const outstanding = new Promise<void>((resolve) => { issued = resolve; });
    await page.route(`**/api/admin/shelves/${shelf.id}`, async (route) => {
      issued();
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.fallback();
    });
    await page.evaluate(({ id, position }) => {
      void fetch(`/api/admin/shelves/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(position) });
    }, { id: shelf.id, position: target! });
    await outstanding;
    test.setTimeout(test.info().duration + 100);
    // Never rejects: only the fixture teardown can drain and restore this write.
    await new Promise<void>(() => {});
  });
});
