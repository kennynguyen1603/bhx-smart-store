import { Prisma, Role } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api-auth";

export function taskVisibilityWhere(
  user: { id: string; role: Role },
  storeId: string,
): Prisma.TaskWhereInput {
  if (user.role === Role.STAFF) {
    return {
      storeId,
      OR: [{ assigneeId: null }, { assigneeId: user.id }],
    };
  }
  return { storeId };
}

export function assertTaskClaimable(
  task: { assigneeId: string | null },
  user: { id: string; role: Role },
): void {
  if (user.role === Role.STAFF && task.assigneeId && task.assigneeId !== user.id) {
    throw new ApiError(409, "Nhiệm vụ đã được nhân viên khác nhận", "TASK_ALREADY_ASSIGNED");
  }
}
