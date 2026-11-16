import { beforeEach, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";

const db = vi.hoisted(() => ({
  store: { findUnique: vi.fn() }, product: { findFirst: vi.fn() },
  inventory: { findFirst: vi.fn() }, lot: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
import { GET } from "@/app/api/kiosk/products/[id]/route";

const product = { id: "milk", sku: "MILK-1L", barcode: "8934673574211", name: "Milk", category: "Dairy", unit: "box", basePriceVnd: 32_600, emoji: "🥛" };
const inventories = [
  { storeId: "store-1", productId: "milk", shelfId: "shelf-1", onShelf: 10, backroom: 0, lowThreshold: 2, shelf: { id: "shelf-1", code: "L-02", label: "Milk shelf", zone: { name: "Dairy" } } },
  { storeId: "store-1", productId: "milk", shelfId: "shelf-2", onShelf: 0, backroom: 0, lowThreshold: 2, shelf: { id: "shelf-2", code: "L-03", label: "Second milk shelf", zone: { name: "Dairy" } } },
  { storeId: "store-2", productId: "milk", shelfId: "foreign-shelf", onShelf: 10, backroom: 0, lowThreshold: 2, shelf: { id: "foreign-shelf", code: "X-01", label: "Other store", zone: { name: "Dairy" } } },
  { storeId: "store-1", productId: "other", shelfId: "other-product-shelf", onShelf: 10, backroom: 0, lowThreshold: 2, shelf: { id: "other-product-shelf", code: "X-02", label: "Other product", zone: { name: "Dairy" } } },
];

beforeEach(() => {
  vi.resetAllMocks();
  db.store.findUnique.mockResolvedValue({ id: "store-1", timeZone: "Asia/Ho_Chi_Minh" });
  db.product.findFirst.mockResolvedValue(product);
  db.lot.findMany.mockResolvedValue([]);
  db.inventory.findFirst.mockImplementation(async ({ where }: Prisma.InventoryFindFirstArgs) => inventories.find((row) =>
    row.storeId === where?.storeId && row.productId === where?.productId && (!where.shelfId || row.shelfId === where.shelfId)) || null);
});

async function detail(shelfId?: string) {
  const params = new URLSearchParams({ storeCode: "NT-Q5", ...(shelfId ? { shelfId } : {}) });
  return GET(new Request(`http://localhost/api/kiosk/products/milk?${params}`), { params: Promise.resolve({ id: "milk" }) });
}

it("retains the scanned shelf and its availability when the product occupies multiple shelves", async () => {
  const response = await detail("shelf-2");
  expect(response.status).toBe(200);
  expect((await response.json()).product).toMatchObject({ id: "milk", availability: "OUT", shelf: { id: "shelf-2", code: "L-03" } });
});

it.each(["foreign-shelf", "other-product-shelf", "unknown-shelf"])("rejects shelf %s outside the selected store/product assignment", async (shelfId) => {
  const response = await detail(shelfId);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: { code: "NOT_SOLD_HERE", message: "Sản phẩm không có tại chi nhánh này" } });
});

it("preserves detail lookup without an optional shelf", async () => {
  const response = await detail();
  expect(response.status).toBe(200);
  expect((await response.json()).product.shelf.id).toBe("shelf-1");
});
