import { prisma } from "@/lib/db";
import { availabilityLabel, availabilityOf } from "@/lib/kiosk";
import { selectPublicPrice } from "@/lib/kiosk-pricing";
import { normalizeSearch } from "@/lib/normalize";

export async function GET(request: Request) {
  const now = new Date();
  const url = new URL(request.url);
  const storeCode = url.searchParams.get("storeCode") || "NT-Q5";
  const rawQuery = (url.searchParams.get("q") || "").trim();
  const query = normalizeSearch(rawQuery);
  const exact = url.searchParams.get("exact") === "1";
  const category = url.searchParams.get("category");
  // Optional cap for lightweight callers such as type-ahead suggestions.
  const limit = Number.parseInt(url.searchParams.get("limit") || "", 10);
  const take = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : undefined;
  const store = await prisma.store.findUnique({ where: { code: storeCode }, select: { id: true, code: true, name: true, address: true, timeZone: true } });
  if (!store) return Response.json({ error: { code: "STORE_NOT_FOUND", message: "Không tìm thấy cửa hàng" } }, { status: 404 });
  if (exact && !rawQuery) return Response.json({ store, products: [] });
  const esl = rawQuery ? await prisma.eSL.findFirst({
    where: { storeId: store.id, code: { equals: rawQuery, mode: "insensitive" } },
    select: { shelfId: true, productId: true },
  }) : null;
  const inventories = await prisma.inventory.findMany({
    where: {
      storeId: store.id,
      ...(esl ? { shelfId: esl.shelfId, productId: esl.productId } : {}),
      product: {
        active: true,
        ...(!esl && exact ? { barcode: { equals: rawQuery, mode: "insensitive" } } : {}),
        ...(!esl && !exact && query ? { searchText: { contains: query } } : {}),
        ...(category ? { category } : {}),
      },
    },
    include: {
      product: {
        include: {
          lots: {
            where: { storeId: store.id, quantity: { gt: 0 }, status: { in: ["AVAILABLE", "MARKED_DOWN"] } },
            select: { status: true, quantity: true, expiryDate: true, markdownPercent: true, markdownPriceVnd: true },
            orderBy: { expiryDate: "asc" },
          },
        },
      },
      shelf: { include: { zone: true } },
    },
    orderBy: { product: { name: "asc" } },
    ...(take ? { take } : {}),
  });
  return Response.json({
    store,
    products: inventories.map((inventory) => {
      const availability = availabilityOf(inventory);
      const price = selectPublicPrice(inventory.product.basePriceVnd, inventory.product.lots, { now, timeZone: store.timeZone });
      return {
        id: inventory.product.id,
        sku: inventory.product.sku,
        barcode: inventory.product.barcode,
        name: inventory.product.name,
        category: inventory.product.category,
        ...price,
        emoji: inventory.product.emoji,
        availability,
        availabilityLabel: availabilityLabel(availability),
        shelf: { id: inventory.shelf.id, code: inventory.shelf.code, label: inventory.shelf.label, zone: inventory.shelf.zone?.name },
      };
    }),
  });
}
