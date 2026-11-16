import { z } from "zod";
import { LotStatus, Role, TaskPriority, TaskStatus, TaskType } from "@/generated/prisma/client";
import { ApiError, apiErrorResponse, ensureStoreAccess, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { sendPushToUsers } from "@/lib/push";
import { createAssignmentNotifications } from "@/lib/task-notifications";

const taskSchema = z.object({
  storeId: z.string().trim().min(1),
  type: z.enum(TaskType),
  productId: z.string().trim().min(1),
  shelfId: z.string().trim().min(1),
  lotId: z.string().trim().min(1).optional(),
  assigneeId: z.string().trim().min(1).optional(),
  priority: z.enum(TaskPriority),
  dueAt: z.iso.datetime({ offset: true }).optional(),
  note: z.string().trim().max(2000).optional(),
});

export type AdminTaskInput = z.infer<typeof taskSchema>;

export async function POST(request: Request) {
  try {
    const user = await requireUser([Role.MANAGER, Role.ADMIN]);
    const raw: unknown = await request.json().catch(() => { throw new ApiError(400, "Dữ liệu không hợp lệ", "VALIDATION_ERROR"); });
    const input = taskSchema.parse(raw);
    ensureStoreAccess(user, input.storeId);
    const { task, recipients } = await prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.findUnique({
        where: { storeId_shelfId_productId: { storeId: input.storeId, shelfId: input.shelfId, productId: input.productId } },
        include: { product: true, shelf: true },
      });
      if (!inventory || inventory.shelf.storeId !== input.storeId) throw new ApiError(400, "Sản phẩm chưa được gắn với kệ tại cửa hàng", "CROSS_STORE_REFERENCE");
      if (input.assigneeId) {
        const assignee = await tx.userStore.findFirst({ where: { storeId: input.storeId, userId: input.assigneeId, user: { active: true, role: Role.STAFF } } });
        if (!assignee) throw new ApiError(400, "Người nhận phải là nhân viên đang hoạt động tại cửa hàng", "INVALID_ASSIGNEE");
      }
      let lotId: string | null = null;
      if (input.lotId) {
        const lot = await tx.lot.findFirst({ where: { id: input.lotId, storeId: input.storeId, productId: input.productId } });
        if (!lot) throw new ApiError(400, "Lô không thuộc sản phẩm và cửa hàng đã chọn", "CROSS_STORE_REFERENCE");
        lotId = lot.id;
      }
      if (input.type === TaskType.RESTOCK) lotId = null;
      else if (!lotId) {
        const lot = await tx.lot.findFirst({
          where: { storeId: input.storeId, productId: input.productId, quantity: { gt: 0 }, status: { in: [LotStatus.AVAILABLE, LotStatus.MARKED_DOWN] } },
          orderBy: [{ expiryDate: "asc" }, { id: "asc" }],
        });
        if (!lot) throw new ApiError(422, "Không có lô phù hợp cho nhiệm vụ", "LOT_REQUIRED");
        lotId = lot.id;
      }
      const prefix = { RESTOCK: "Bổ sung", FEFO: "Dán nhãn FEFO", QUARANTINE: "Cách ly" }[input.type];
      const task = await tx.task.create({
        data: { ...input, lotId, dueAt: input.dueAt ? new Date(input.dueAt) : null, status: TaskStatus.OPEN, title: `${prefix} ${inventory.product.name}` },
        include: { product: true, shelf: true, lot: true, assignee: { select: { id: true, name: true, email: true } } },
      });
      await tx.taskEvent.create({ data: { taskId: task.id, actorId: user.id, type: "CREATED", note: input.note } });
      const recipients = await createAssignmentNotifications(tx, task, input.assigneeId);
      return { task, recipients };
    });
    await sendPushToUsers(recipients, { title: task.title, body: task.note || "Bạn có một nhiệm vụ mới cần xử lý", url: `/staff?task=${task.id}`, tag: task.id }).catch((error) => console.error("Task push failed", error));
    return Response.json({ task }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
