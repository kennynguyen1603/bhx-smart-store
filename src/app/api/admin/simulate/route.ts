import { Role } from "@/generated/prisma/client";
import { ApiError, apiErrorResponse, ensureStoreAccess, requireUser } from "@/lib/api-auth";
import { processSaleEvent, processSupplierLot, processWmsInventory, runFefoEngine } from "@/lib/business";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({ mode: z.enum(["POS", "WMS", "SUPPLIER", "FEFO"]), inventoryId: z.string().optional(), quantity: z.number().int().positive().optional() });

export async function POST(request: Request) {
  try {
    const user = await requireUser([Role.MANAGER, Role.ADMIN]);
    const input = schema.parse(await request.json());
    if (input.mode === "FEFO") return Response.json(await runFefoEngine());
    if (!input.inventoryId) throw new ApiError(400, "Cần chọn tồn kho để mô phỏng", "INVENTORY_REQUIRED");
    const inventory = await prisma.inventory.findUnique({ where: { id: input.inventoryId }, include: { store: true, shelf: true, product: true } });
    if (!inventory) throw new ApiError(404, "Không tìm thấy tồn kho", "INVENTORY_NOT_FOUND");
    ensureStoreAccess(user, inventory.storeId);
    const eventId = `demo-${input.mode.toLowerCase()}-${Date.now()}`;
    if (input.mode === "POS") return Response.json(await processSaleEvent({ externalEventId: eventId, storeCode: inventory.store.code, shelfCode: inventory.shelf.code, productSku: inventory.product.sku, quantity: input.quantity || 2, priceVnd: inventory.product.basePriceVnd, occurredAt: new Date() }));
    if (input.mode === "WMS") return Response.json(await processWmsInventory({ externalEventId: eventId, storeCode: inventory.store.code, shelfCode: inventory.shelf.code, productSku: inventory.product.sku, backroom: inventory.backroom + (input.quantity || 10), onShelf: inventory.onShelf }));
    const supplier = await prisma.supplier.findFirstOrThrow({ where: { active: true } });
    const expiry = new Date(); expiry.setUTCDate(expiry.getUTCDate() + (input.quantity || 3));
    return Response.json(await processSupplierLot({ externalEventId: eventId, storeCode: inventory.store.code, productSku: inventory.product.sku, supplierCode: supplier.code, batchCode: `DEMO-${Date.now()}`, origin: supplier.country, quantity: 12, receivedAt: new Date(), expiryDate: expiry }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
