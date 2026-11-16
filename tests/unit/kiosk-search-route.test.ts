import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";

const db = vi.hoisted(() => ({
  store: { findUnique: vi.fn() },
  eSL: { findFirst: vi.fn() },
  inventory: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { GET } from "@/app/api/kiosk/products/search/route";

const store = { id: "store-1", code: "NT-Q5", name: "Store", address: "Address", timeZone: "Asia/Ho_Chi_Minh" };
const product = {
  id: "milk", sku: "MILK-1L", barcode: "8934673574211", name: "Sữa tươi Vinamilk 100% 1L", category: "Sữa & đồ lạnh",
  active: true, searchText: "sua tuoi 8934673574211 esl-nt-q5-z-99 esl-lvv-td-l-02 esl-nt",
  basePriceVnd: 32_600, emoji: "🥛",
  lots: [{ status: "MARKED_DOWN", quantity: 4, expiryDate: new Date("2026-11-16"), markdownPercent: 20, markdownPriceVnd: 26_080 }],
};
const shelf = { id: "shelf-1", code: "L-02", label: "Kệ sữa", zone: { name: "Sữa & đồ lạnh" } };
const inventory = { storeId: store.id, shelfId: shelf.id, productId: product.id, onShelf: 10, backroom: 0, lowThreshold: 2, product, shelf };
const inventories = [
  inventory,
  { ...inventory, shelfId: "shelf-2", shelf: { ...shelf, id: "shelf-2", code: "L-03" } },
  { ...inventory, productId: "other", product: { ...product, id: "other", searchText: "esl-nt" } },
  { ...inventory, storeId: "store-2" },
  { ...inventory, productId: "inactive", product: { ...product, id: "inactive", active: false } },
];
const esl = { storeId: store.id, code: "ESL-NT-Q5-L-02", shelfId: shelf.id, productId: product.id };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T16:59:59Z"));
  db.store.findUnique.mockResolvedValue(store);
  db.eSL.findFirst.mockImplementation(async ({ where }: Prisma.ESLFindFirstArgs) => {
    const code = where?.code as Prisma.StringFilter;
    return where?.storeId === esl.storeId && code?.equals?.toLowerCase() === esl.code.toLowerCase() && code.mode === "insensitive" ? esl : null;
  });
  // The database boundary enforces emitted filters against adversarial inventory rows.
  db.inventory.findMany.mockImplementation(async ({ where }: Prisma.InventoryFindManyArgs) => {
    const filter = where?.product as Prisma.ProductWhereInput;
    const text = (filter?.searchText as Prisma.StringFilter)?.contains;
    return inventories.filter((row) => row.storeId === where?.storeId
      && (!where?.shelfId || row.shelfId === where.shelfId)
      && (!where?.productId || row.productId === where.productId)
      && row.product.active === filter?.active
      && (!filter?.category || row.product.category === filter.category)
      && (!text || row.product.searchText.includes(text)));
  });
});
afterEach(() => vi.useRealTimers());

async function search(q: string, category?: string) {
  const params = new URLSearchParams({ storeCode: store.code, q, ...(category ? { category } : {}) });
  const response = await GET(new Request(`http://localhost/api/kiosk/products/search?${params}`));
  expect(response.status).toBe(200);
  return response.json();
}

it("resolves a trimmed, mixed-case ESL to the same DTO as the printed product EAN", async () => {
  const barcode = await search("8934673574211");
  const label = await search("  eSl-nT-q5-l-02  ");
  expect(label).toEqual({ store, products: [barcode.products[0]] });
  expect(label.products[0]).toMatchObject({ id: "milk", barcode: "8934673574211", shelf: { id: "shelf-1" }, priceVnd: 26_080, originalPriceVnd: 32_600, markdownPercent: 20 });
});

it("does not resolve a partial ESL as an exact label and keeps text search store/category constraints", async () => {
  expect((await search("ESL-NT", "Sữa & đồ lạnh")).products.map((row: { id: string }) => row.id)).toEqual(["milk", "milk", "other"]);
  expect((await search("ESL-NT", "Rau củ & trái cây")).products).toEqual([]);
});

it.each(["ESL-LVV-TD-L-02", "ESL-NT-Q5-Z-99"])("returns no product for cross-store or unknown label %s even when product text contains it", async (code) => {
  expect((await search(code)).products).toEqual([]);
});

it("keeps category filtering for an exact ESL", async () => {
  expect((await search(esl.code, "Rau củ & trái cây")).products).toEqual([]);
});

it("keeps one request timestamp across ESL lookup at store midnight", async () => {
  db.eSL.findFirst.mockImplementation(async () => {
    vi.setSystemTime(new Date("2026-11-15T17:00:01Z"));
    return esl;
  });
  const result = await search(esl.code);
  expect(result.products).toHaveLength(1);
  expect(result.products[0]).toMatchObject({ priceVnd: 26_080, markdownPercent: 20 });
});

it("uses the selected store timezone for ESL price selection", async () => {
  vi.setSystemTime(new Date("2026-11-15T17:30:00Z"));
  expect((await search(esl.code)).products[0]).toMatchObject({ priceVnd: 32_600, markdownPercent: null });
  db.store.findUnique.mockResolvedValue({ ...store, timeZone: "UTC" });
  expect((await search(esl.code)).products[0]).toMatchObject({ priceVnd: 26_080, markdownPercent: 20 });
});

it("preserves the missing-store error contract", async () => {
  db.store.findUnique.mockResolvedValue(null);
  const response = await GET(new Request("http://localhost/api/kiosk/products/search?storeCode=missing&q=ESL-NT-Q5-L-02"));
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: { code: "STORE_NOT_FOUND", message: "Không tìm thấy cửa hàng" } });
});
