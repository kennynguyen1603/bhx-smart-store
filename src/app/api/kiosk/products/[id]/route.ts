import { prisma } from "@/lib/db";
import { availabilityLabel, availabilityOf, gridRoute } from "@/lib/kiosk";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const storeCode = url.searchParams.get("storeCode") || "NT-Q5";
  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    include: { zones: true, shelves: true, kiosks: { where: { active: true }, take: 1 } },
  });
  if (!store) return Response.json({ error: { code: "STORE_NOT_FOUND", message: "Không tìm thấy cửa hàng" } }, { status: 404 });
  const product = await prisma.product.findFirst({ where: { OR: [{ id }, { sku: id }, { barcode: id }] } });
  if (!product) return Response.json({ error: { code: "PRODUCT_NOT_FOUND", message: "Không tìm thấy sản phẩm" } }, { status: 404 });
  const inventory = await prisma.inventory.findFirst({ where: { storeId: store.id, productId: product.id }, include: { shelf: { include: { zone: true } } } });
  if (!inventory) return Response.json({ error: { code: "NOT_SOLD_HERE", message: "Sản phẩm không có tại chi nhánh này" } }, { status: 404 });
  const lots = await prisma.lot.findMany({
    where: { storeId: store.id, productId: product.id, quantity: { gt: 0 }, status: { not: "QUARANTINED" } },
    include: { supplier: true },
    orderBy: { expiryDate: "asc" },
    take: 3,
  });
  const kiosk = store.kiosks[0] || { x: 0, y: store.mapHeight - 1 };
  const route = gridRoute({ x: kiosk.x, y: kiosk.y }, { x: inventory.shelf.x, y: inventory.shelf.y });
  const availability = availabilityOf(inventory);
  return Response.json({
    store: { id: store.id, code: store.code, name: store.name, address: store.address, mapWidth: store.mapWidth, mapHeight: store.mapHeight },
    product: {
      id: product.id,
      sku: product.sku,
      barcode: product.barcode,
      name: product.name,
      category: product.category,
      unit: product.unit,
      emoji: product.emoji,
      priceVnd: lots[0]?.markdownPriceVnd || product.basePriceVnd,
      originalPriceVnd: product.basePriceVnd,
      availability,
      availabilityLabel: availabilityLabel(availability),
      shelf: inventory.shelf,
      traceability: lots.map((lot) => ({ batchCode: lot.batchCode, origin: lot.origin, expiryDate: lot.expiryDate, supplier: lot.supplier.name, certificate: lot.supplier.certificate, markdownPercent: lot.markdownPercent })),
    },
    map: { zones: store.zones, shelves: store.shelves, start: { x: kiosk.x, y: kiosk.y }, destination: { x: inventory.shelf.x, y: inventory.shelf.y }, route },
  });
}
