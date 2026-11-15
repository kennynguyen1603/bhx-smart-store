import { TaskStatus } from "@/generated/prisma/client";
import { apiErrorResponse, ensureStoreAccess, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { taskVisibilityWhere } from "@/lib/task-access";

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const user = await requireUser();
    const { code } = await context.params;
    const esl = await prisma.eSL.findUnique({ where: { code }, include: { store: true, shelf: true, product: true } });
    if (!esl) return Response.json({ error: { code: "ESL_NOT_FOUND", message: "Không tìm thấy mã ESL" } }, { status: 404 });
    ensureStoreAccess(user, esl.storeId);
    const activeStatuses: TaskStatus[] = [TaskStatus.OPEN, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED];
    const [inventory, tasks] = await Promise.all([
      prisma.inventory.findUnique({ where: { storeId_shelfId_productId: { storeId: esl.storeId, shelfId: esl.shelfId, productId: esl.productId } } }),
      prisma.task.findMany({
        where: {
          ...taskVisibilityWhere(user, esl.storeId),
          shelfId: esl.shelfId,
          productId: esl.productId,
          status: { in: activeStatuses },
        },
        include: {
          product: true,
          shelf: { include: { esls: true } },
          lot: { include: { supplier: true } },
          assignee: { select: { id: true, name: true } },
        },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      }),
    ]);
    const taskSummaries = tasks.map((task) => ({
      ...task,
      assignee: task.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
      completedAt: task.completedAt?.toISOString() || null,
      inventory,
    }));
    return Response.json({ esl, inventory, tasks: taskSummaries });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
