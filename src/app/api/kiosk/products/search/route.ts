import { prisma } from "@/lib/db";
import { availabilityLabel, availabilityOf } from "@/lib/kiosk";
import { normalizeSearch } from "@/lib/normalize";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const storeCode = url.searchParams.get("storeCode") || "NT-Q5";
  const query = normalizeSearch(url.searchParams.get("q") || "");
  const category = url.searchParams.get("category");
  const store = await prisma.store.findUnique({ where: { code: storeCode }, select: { id: true, code: true, name: true, address: true } });
  if (!store) return Response.json({ error: { code: "STORE_NOT_FOUND", message: "Không tìm thấy cửa hàng" } }, { status: 404 });
  const inventories = await prisma.inventory.findMany({
    where: {
      storeId: store.id,
      product: {
        active: true,
        ...(query ? { searchText: { contains: query } } : {}),
        ...(category ? { category } : {}),
      },
    },
    include: { product: true, shelf: { include: { zone: true } } },
    orderBy: { product: { name: "asc" } },
  });
  return Response.json({
    store,
    products: inventories.map((inventory) => {
      const availability = availabilityOf(inventory);
      return {
        id: inventory.product.id,
        sku: inventory.product.sku,
        barcode: inventory.product.barcode,
        name: inventory.product.name,
        category: inventory.product.category,
        priceVnd: inventory.product.basePriceVnd,
        emoji: inventory.product.emoji,
        availability,
        availabilityLabel: availabilityLabel(availability),
        shelf: { id: inventory.shelf.id, code: inventory.shelf.code, label: inventory.shelf.label, zone: inventory.shelf.zone?.name },
      };
    }),
  });
}
