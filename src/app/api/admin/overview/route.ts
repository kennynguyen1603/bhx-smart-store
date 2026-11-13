import { Role } from "@/generated/prisma/client";
import { apiErrorResponse, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const user = await requireUser([Role.MANAGER, Role.ADMIN]);
    const url = new URL(request.url);
    const requestedStore = url.searchParams.get("storeId");
    const storeIds = user.role === Role.ADMIN ? undefined : user.storeIds;
    const selectedStoreId = requestedStore && (user.role === Role.ADMIN || user.storeIds.includes(requestedStore)) ? requestedStore : user.defaultStoreId;
    const [stores, users, products, suppliers, lots, inventories, integrations, audits, rules] = await Promise.all([
      prisma.store.findMany({ where: { id: { in: storeIds } }, include: { zones: true, shelves: { include: { zone: true, esls: { include: { product: true } } } }, kiosks: true }, orderBy: { name: "asc" } }),
      prisma.user.findMany({ where: user.role === Role.ADMIN ? {} : { userStores: { some: { storeId: { in: user.storeIds } } } }, select: { id: true, email: true, name: true, role: true, active: true, userStores: { include: { store: { select: { id: true, name: true } } } } }, orderBy: { name: "asc" } }),
      prisma.product.findMany({ orderBy: { name: "asc" } }),
      prisma.supplier.findMany({ orderBy: { name: "asc" } }),
      prisma.lot.findMany({ where: selectedStoreId ? { storeId: selectedStoreId } : {}, include: { product: true, supplier: true, store: true }, orderBy: { expiryDate: "asc" }, take: 100 }),
      prisma.inventory.findMany({ where: selectedStoreId ? { storeId: selectedStoreId } : {}, include: { product: true, shelf: true, store: true }, orderBy: { updatedAt: "desc" } }),
      prisma.integrationEvent.findMany({ where: selectedStoreId ? { OR: [{ storeId: selectedStoreId }, { storeId: null }] } : {}, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.auditLog.findMany({ where: selectedStoreId ? { storeId: selectedStoreId } : {}, include: { actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.fefoRule.findMany({ where: selectedStoreId ? { storeId: selectedStoreId } : {}, orderBy: { daysRemaining: "asc" } }),
    ]);
    return Response.json({ generatedAt: new Date().toISOString(), selectedStoreId, stores, users, products, suppliers, lots, inventories, integrations, audits, rules });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
