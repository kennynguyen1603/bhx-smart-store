import { Role } from "@/generated/prisma/client";
import { ApiError, apiErrorResponse, ensureStoreAccess, requireUser } from "@/lib/api-auth";
import { processSaleEvent, processSupplierLot, processWmsInventory, runFefoEngine } from "@/lib/business";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({ mode: z.enum(["POS", "WMS", "SUPPLIER", "FEFO"]), inventoryId: z.string().optional(), quantity: z.number().int().positive().optional(), operationId: z.string().uuid() });

type ReceiptPayload = { status: "PENDING" } | { status: "COMPLETED"; data: unknown };

async function reconcileReceipt(operationId: string, userId: string, action: string) {
  const receipt = await prisma.mutationReceipt.findUnique({ where: { clientMutationId: operationId } });
  if (!receipt) return null;
  if (receipt.userId !== userId || receipt.action !== action) throw new ApiError(409, "Mã thao tác đã được dùng cho yêu cầu khác.", "OPERATION_KEY_REUSED");
  const payload = receipt.response as ReceiptPayload;
  if (payload.status === "COMPLETED") return payload.data;
  throw new ApiError(409, "Thao tác này đang được xử lý. Hãy thử kiểm tra lại sau.", "OPERATION_IN_PROGRESS");
}

export async function POST(request: Request) {
  try {
    const user = await requireUser([Role.MANAGER, Role.ADMIN]);
    const input = schema.parse(await request.json());
    const action = `ADMIN_SIMULATE:${input.mode}:${input.inventoryId || "ALL"}:${input.quantity || "DEFAULT"}`;
    const reconciled = await reconcileReceipt(input.operationId, user.id, action);
    if (reconciled) return Response.json(reconciled);
    try {
      await prisma.mutationReceipt.create({ data: { clientMutationId: input.operationId, userId: user.id, action, response: { status: "PENDING" } } });
    } catch (error) {
      const raced = await reconcileReceipt(input.operationId, user.id, action);
      if (raced) return Response.json(raced);
      throw error;
    }

    try {
      let result: unknown;
      if (input.mode === "FEFO") result = await runFefoEngine();
      else {
        if (!input.inventoryId) throw new ApiError(400, "Cần chọn tồn kho để mô phỏng", "INVENTORY_REQUIRED");
        const inventory = await prisma.inventory.findUnique({ where: { id: input.inventoryId }, include: { store: true, shelf: true, product: true } });
        if (!inventory) throw new ApiError(404, "Không tìm thấy tồn kho", "INVENTORY_NOT_FOUND");
        ensureStoreAccess(user, inventory.storeId);
        const eventId = `admin-sim-${user.id}-${input.operationId}`;
        if (input.mode === "POS") result = await processSaleEvent({ externalEventId: eventId, storeCode: inventory.store.code, shelfCode: inventory.shelf.code, productSku: inventory.product.sku, quantity: input.quantity || 2, priceVnd: inventory.product.basePriceVnd, occurredAt: new Date() });
        else if (input.mode === "WMS") result = await processWmsInventory({ externalEventId: eventId, storeCode: inventory.store.code, shelfCode: inventory.shelf.code, productSku: inventory.product.sku, backroom: inventory.backroom + (input.quantity || 10), onShelf: inventory.onShelf });
        else {
          const supplier = await prisma.supplier.findFirstOrThrow({ where: { active: true } });
          const expiry = new Date(); expiry.setUTCDate(expiry.getUTCDate() + (input.quantity || 3));
          result = await processSupplierLot({ externalEventId: eventId, storeCode: inventory.store.code, productSku: inventory.product.sku, supplierCode: supplier.code, batchCode: `DEMO-${input.operationId}`, origin: supplier.country, quantity: 12, receivedAt: new Date(), expiryDate: expiry });
        }
      }
      const stored = JSON.parse(JSON.stringify(result));
      await prisma.mutationReceipt.update({ where: { clientMutationId: input.operationId }, data: { response: { status: "COMPLETED", data: stored } } });
      return Response.json(result);
    } catch (error) {
      await prisma.mutationReceipt.deleteMany({ where: { clientMutationId: input.operationId, userId: user.id, action } });
      throw error;
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
