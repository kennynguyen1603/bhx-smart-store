import { prisma } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const store = await prisma.store.findUnique({
    where: { code },
    include: { zones: true, shelves: true, kiosks: { where: { active: true }, take: 1 } },
  });
  if (!store) return Response.json({ error: { code: "STORE_NOT_FOUND", message: "Không tìm thấy cửa hàng" } }, { status: 404 });

  const kiosk = store.kiosks[0] || { x: 0, y: store.mapHeight - 1 };
  return Response.json({
    store: { id: store.id, code: store.code, name: store.name, address: store.address, mapWidth: store.mapWidth, mapHeight: store.mapHeight },
    zones: store.zones,
    shelves: store.shelves,
    start: { x: kiosk.x, y: kiosk.y },
  });
}
