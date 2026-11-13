import { TaskStatus } from "@/generated/prisma/client";
import { apiErrorResponse, ensureStoreAccess, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const storeId = url.searchParams.get("storeId") || user.defaultStoreId;
    if (!storeId) return Response.json({ stores: [], tasks: [], metrics: {} });
    ensureStoreAccess(user, storeId);
    const [stores, tasks, inventories, notifications, recentEvents] = await Promise.all([
      prisma.store.findMany({ where: { id: { in: user.role === "ADMIN" ? undefined : user.storeIds }, active: true }, select: { id: true, code: true, name: true, address: true }, orderBy: { name: "asc" } }),
      prisma.task.findMany({ where: { storeId }, include: { product: true, shelf: { include: { esls: true } }, lot: { include: { supplier: true } }, assignee: { select: { id: true, name: true } } }, orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }] }),
      prisma.inventory.findMany({ where: { storeId }, include: { product: true, shelf: true }, orderBy: { updatedAt: "desc" } }),
      prisma.notification.findMany({ where: { userId: user.id, storeId }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.taskEvent.findMany({ where: { task: { storeId } }, include: { task: { include: { product: true, shelf: true } }, actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    const inventoryByKey = new Map(inventories.map((item) => [`${item.shelfId}:${item.productId}`, item]));
    const serializedTasks = tasks.map((task) => ({
      ...task,
      inventory: inventoryByKey.get(`${task.shelfId}:${task.productId}`) || null,
    }));
    const activeStatuses: TaskStatus[] = [TaskStatus.OPEN, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED];
    const open = tasks.filter((task) => activeStatuses.includes(task.status));
    return Response.json({
      stores,
      selectedStoreId: storeId,
      tasks: serializedTasks,
      inventories,
      notifications,
      recentEvents,
      metrics: {
        openTasks: open.length,
        highPriority: open.filter((task) => task.priority === "HIGH").length,
        lowShelves: inventories.filter((item) => item.onShelf <= item.lowThreshold).length,
        fefoTasks: open.filter((task) => task.type !== "RESTOCK").length,
        completionRate: tasks.length ? Math.round((tasks.filter((task) => task.status === "COMPLETED").length / tasks.length) * 100) : 100,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
