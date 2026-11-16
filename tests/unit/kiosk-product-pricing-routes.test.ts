import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  store: { findUnique: vi.fn() },
  product: { findFirst: vi.fn() },
  inventory: { findFirst: vi.fn(), findMany: vi.fn() },
  lot: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { GET as searchProducts } from "@/app/api/kiosk/products/search/route";
import { GET as productDetail } from "@/app/api/kiosk/products/[id]/route";

const product = { id: "product-1", sku: "sku-1", barcode: "123", name: "Milk", category: "Dairy", unit: "box", emoji: "🥛", basePriceVnd: 32_600 };
const shelf = { id: "shelf-1", code: "A1", label: "Dairy", zone: { name: "Cold" } };
const inventory = { id: "inventory-1", storeId: "store-1", productId: product.id, shelfId: shelf.id, onShelf: 10, inBackroom: 0, lowThreshold: 2, shelf, product };
function lot(expiryDate: string, markdownPercent = 20, markdownPriceVnd = 26_080) {
  return { id: expiryDate, storeId: "store-1", productId: product.id, status: "MARKED_DOWN", quantity: 4, expiryDate: new Date(expiryDate), markdownPercent, markdownPriceVnd, batchCode: expiryDate, origin: "Vietnam", supplier: { name: "Supplier", certificate: "CERT" } };
}

function provideStore(timeZone: string, afterLookup?: () => void) {
  db.store.findUnique.mockImplementation(async ({ select }: { select?: Record<string, boolean> }) => {
    const store = { id: "store-1", code: "NT-Q5", name: "Store", address: "Address", timeZone };
    afterLookup?.();
    return select ? Object.fromEntries(Object.entries(store).filter(([key]) => select[key])) : store;
  });
}
function provideLots(lots: ReturnType<typeof lot>[]) {
  // Model the database's take behavior so pricing cannot silently ignore later lots.
  db.lot.findMany.mockImplementation(async ({ take }: { take?: number }) => lots.slice(0, take));
  db.inventory.findMany.mockResolvedValue([{ ...inventory, product: { ...product, lots } }]);
}
async function responseProduct(route: "search" | "detail") {
  const request = new Request(`http://localhost/api/kiosk/products/${route === "search" ? "search" : product.id}?storeCode=NT-Q5`);
  const response = route === "search" ? await searchProducts(request) : await productDetail(request, { params: Promise.resolve({ id: product.id }) });
  expect(response.status).toBe(200);
  const payload = await response.json();
  return route === "search" ? payload.products[0] : payload.product;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T17:30:00Z"));
  provideStore("Asia/Ho_Chi_Minh");
  db.product.findFirst.mockResolvedValue(product);
  db.inventory.findFirst.mockResolvedValue(inventory);
});
afterEach(() => vi.useRealTimers());

describe.each(["search", "detail"] as const)("%s product pricing", (route) => {
  it.each([
    ["Asia/Ho_Chi_Minh", 32_600],
    ["UTC", 26_080],
    ["", 32_600],
  ])("prices the response using persisted store timezone %j", async (timeZone, expectedPrice) => {
    provideStore(timeZone);
    provideLots([lot("2026-11-16")]);
    expect((await responseProduct(route)).priceVnd).toBe(expectedPrice);
  });

  it("propagates a non-empty invalid persisted timezone rather than silently pricing in the default zone", async () => {
    provideStore("invalid/timezone");
    provideLots([lot("2026-11-16")]);
    await expect(responseProduct(route)).rejects.toThrow(RangeError);
  });

  it("keeps the request's initial store day when a database lookup crosses midnight", async () => {
    vi.setSystemTime(new Date("2026-11-15T16:59:59Z"));
    provideStore("Asia/Ho_Chi_Minh", () => vi.setSystemTime(new Date("2026-11-15T17:00:01Z")));
    provideLots([lot("2026-11-16")]);
    expect((await responseProduct(route)).priceVnd).toBe(26_080);
  });
});

it("detail prices the first sellable lot beyond three expired lots while keeping three traceability rows", async () => {
  provideLots([lot("2026-11-14", 50, 16_300), lot("2026-11-15", 50, 16_300), lot("2026-11-16", 50, 16_300), lot("2026-11-17")]);
  const result = await responseProduct("detail");
  expect(result).toMatchObject({ priceVnd: 26_080, originalPriceVnd: 32_600, markdownPercent: 20 });
  expect(result.traceability).toHaveLength(3);
  expect(result.traceability.map((row: { batchCode: string }) => row.batchCode)).toEqual(["2026-11-14", "2026-11-15", "2026-11-16"]);
});
