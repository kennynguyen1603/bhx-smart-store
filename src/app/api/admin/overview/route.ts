import { Role, TaskStatus } from "@/generated/prisma/client";
import { apiErrorResponse, ensureStoreAccess, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const user = await requireUser([Role.MANAGER, Role.ADMIN]);
    const url = new URL(request.url);
    const requestedStore = url.searchParams.get("storeId");
    const storeIds = user.role === Role.ADMIN ? undefined : user.storeIds;
    if (requestedStore) ensureStoreAccess(user, requestedStore);
    const selectedStoreId = requestedStore || (user.defaultStoreId && (user.role === Role.ADMIN || user.storeIds.includes(user.defaultStoreId)) ? user.defaultStoreId : user.storeIds[0]) || null;
    // An account without a selected authorized store must never turn into an unscoped query.
    const scope = { storeId: selectedStoreId || { in: [] as string[] } };
    const activeStatuses = [TaskStatus.OPEN, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED];
    const taskInclude = { product: true, shelf: true, lot: true, assignee: { select: { id: true, name: true } } } as const;
    const [stores, users, products, suppliers, lots, inventories, integrations, audits, rules, activeTasks, terminalTasks, assignees, taskLots] = await Promise.all([
      prisma.store.findMany({ where: { id: { in: storeIds } }, include: { zones: true, shelves: { include: { zone: true, esls: { include: { product: true } } } }, kiosks: true }, orderBy: { name: "asc" } }),
      prisma.user.findMany({ where: user.role === Role.ADMIN ? {} : { userStores: { some: { storeId: { in: user.storeIds } } } }, select: { id: true, email: true, name: true, role: true, active: true, userStores: { include: { store: { select: { id: true, name: true } } } } }, orderBy: { name: "asc" } }),
      prisma.product.findMany({ orderBy: { name: "asc" } }),
      prisma.supplier.findMany({ orderBy: { name: "asc" } }),
      prisma.lot.findMany({ where: scope, include: { product: true, supplier: true, store: true }, orderBy: { expiryDate: "asc" }, take: 100 }),
      prisma.inventory.findMany({ where: scope, include: { product: true, shelf: true, store: true }, orderBy: { updatedAt: "desc" } }),
      prisma.integrationEvent.findMany({ where: selectedStoreId ? { OR: [{ storeId: selectedStoreId }, { storeId: null }] } : scope, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.auditLog.findMany({ where: scope, include: { actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.fefoRule.findMany({ where: scope, orderBy: { daysRemaining: "asc" } }),
      prisma.task.findMany({ where: { ...scope, status: { in: activeStatuses } }, include: taskInclude, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100 }),
      prisma.task.findMany({ where: { ...scope, status: { notIn: activeStatuses } }, include: taskInclude, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100 }),
      prisma.user.findMany({ where: { active: true, role: Role.STAFF, userStores: { some: scope } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.lot.findMany({ where: scope, select: { id: true, batchCode: true, productId: true, expiryDate: true }, orderBy: [{ expiryDate: "asc" }, { id: "asc" }] }),
    ]);
    const taskProducts = [...new Map(inventories.map(item => [item.productId, { id: item.productId, name: item.product.name }])).values()].sort((a, b) => a.name.localeCompare(b.name));
    const taskShelves = [...new Set(inventories.map(item => item.shelfId))].map(id => ({
      id, name: inventories.find(item => item.shelfId === id)!.shelf.label,
      productIds: inventories.filter(item => item.shelfId === id).map(item => item.productId),
    }));
    const taskReferences = { products: taskProducts, shelves: taskShelves, lots: taskLots.map(lot => ({ id: lot.id, name: lot.batchCode, productId: lot.productId })), assignees };
    const tasks = [...activeTasks, ...terminalTasks].slice(0, 100);
    return Response.json({ generatedAt: new Date().toISOString(), selectedStoreId, stores, users, products, suppliers, lots, inventories, integrations, audits, rules, tasks, taskReferences });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
