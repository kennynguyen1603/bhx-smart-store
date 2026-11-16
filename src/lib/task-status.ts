import type { TaskStatus } from "@/generated/prisma/client";
import type { BadgeVariant } from "@/components/ui/badge";

export const TASK_STATUS_PRESENTATION: Record<TaskStatus, { label: string; variant: BadgeVariant }> = {
  OPEN: { label: "Mới", variant: "default" },
  IN_PROGRESS: { label: "Đang làm", variant: "secondary" },
  BLOCKED: { label: "Bị chặn", variant: "destructive" },
  COMPLETED: { label: "Hoàn thành", variant: "success" },
  CANCELLED: { label: "Đã huỷ", variant: "outline" },
};
