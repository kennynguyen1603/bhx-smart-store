import { prisma } from "@/lib/db";
import { availabilityLabel, availabilityOf } from "@/lib/kiosk";
import { selectPublicPrice } from "@/lib/kiosk-pricing";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const storeCode = url.searchParams.get("storeCode") || "NT-Q5";
  const store = await prisma.store.findUnique({
    where: { code: storeCode },
  });
  if (!store) return Response.json({ error: { code: "STORE_NOT_FOUND", message: "Không tìm thấy cửa hàng" } }, { status: 404 });
  const product = await prisma.product.findFirst({ where: { OR: [{ id }, { sku: id }, { barcode: id }] } });
  if (!product) return Response.json({ error: { code: "PRODUCT_NOT_FOUND", message: "Không tìm thấy sản phẩm" } }, { status: 404 });
  const inventory = await prisma.inventory.findFirst({ where: { storeId: store.id, productId: product.id }, include: { shelf: { include: { zone: true } } } });
  if (!inventory) return Response.json({ error: { code: "NOT_SOLD_HERE", message: "Sản phẩm không có tại chi nhánh này" } }, { status: 404 });
  const lots = await prisma.lot.findMany({
    where: { storeId: store.id, productId: product.id, quantity: { gt: 0 }, status: { in: ["AVAILABLE", "MARKED_DOWN"] } },
    include: { supplier: true },
    orderBy: { expiryDate: "asc" },
    take: 3,
  });
  const availability = availabilityOf(inventory);
  const price = selectPublicPrice(product.basePriceVnd, lots);
  return Response.json({
    product: {
      id: product.id,
      sku: product.sku,
      barcode: product.barcode,
      name: product.name,
      category: product.category,
      unit: product.unit,
      emoji: product.emoji,
      ...price,
      availability,
      availabilityLabel: availabilityLabel(availability),
      shelf: inventory.shelf,
      traceability: lots.map((lot) => ({ batchCode: lot.batchCode, origin: lot.origin, expiryDate: lot.expiryDate, supplier: lot.supplier.name, certificate: lot.supplier.certificate, markdownPercent: lot.markdownPercent })),
    },
  });
}
