import { NotificationType, Prisma, Role, TaskType } from "@/generated/prisma/client";

type NotificationTask = { id: string; storeId: string; title: string; note: string | null; type: TaskType };

export async function createAssignmentNotifications(
  tx: Prisma.TransactionClient,
  task: NotificationTask,
  assigneeId?: string,
): Promise<string[]> {
  const recipients = await tx.userStore.findMany({
    where: { storeId: task.storeId, ...(assigneeId ? { userId: assigneeId } : {}), user: { active: true, role: Role.STAFF } },
    select: { userId: true },
  });
  const userIds = recipients.map(({ userId }) => userId);
  if (userIds.length) await tx.notification.createMany({ data: userIds.map((userId) => ({
    userId, storeId: task.storeId, taskId: task.id,
    type: task.type === TaskType.RESTOCK ? NotificationType.TASK_CREATED : NotificationType.FEFO_DUE,
    title: task.title, body: task.note || "Bạn có một nhiệm vụ mới cần xử lý",
  })) });
  return userIds;
}

export async function createOutcomeNotifications(
  tx: Prisma.TransactionClient,
  task: NotificationTask & { assigneeId: string | null },
  outcome: "COMPLETED" | "BLOCKED",
): Promise<string[]> {
  const recipients = await tx.userStore.findMany({
    where: { storeId: task.storeId, ...(task.assigneeId ? { userId: { not: task.assigneeId } } : {}), user: { active: true, role: { in: [Role.MANAGER, Role.ADMIN] } } },
    select: { userId: true },
  });
  const userIds = recipients.map(({ userId }) => userId);
  if (userIds.length) await tx.notification.createMany({ data: userIds.map((userId) => ({
    userId, storeId: task.storeId, taskId: task.id,
    type: outcome === "COMPLETED" ? NotificationType.TASK_COMPLETED : NotificationType.TASK_BLOCKED,
    title: outcome === "COMPLETED" ? "Nhiệm vụ hoàn thành" : "Nhiệm vụ bị chặn",
    body: `${task.title} · ${task.note || (outcome === "COMPLETED" ? "Đã hoàn thành" : "Cần quản lý hỗ trợ")}`,
  })) });
  return userIds;
}
