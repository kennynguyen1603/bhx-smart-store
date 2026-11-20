import type { TaskPriority, TaskStatus, TaskType } from "@/generated/prisma/client";
import type { BadgeVariant } from "@/components/ui/badge";

export const TASK_STATUS_PRESENTATION: Record<TaskStatus, { label: string; variant: BadgeVariant }> = {
  OPEN: { label: "Mới", variant: "default" },
  IN_PROGRESS: { label: "Đang làm", variant: "secondary" },
  BLOCKED: { label: "Bị chặn", variant: "destructive" },
  COMPLETED: { label: "Hoàn thành", variant: "success" },
  CANCELLED: { label: "Đã huỷ", variant: "outline" },
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = { RESTOCK: "Bổ sung hàng", FEFO: "FEFO", QUARANTINE: "Cách ly" };

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = { NORMAL: "Bình thường", MEDIUM: "Trung bình", HIGH: "Cao" };

/** TaskEvent.type is a free-form string column; unknown values fall back to the raw code. */
const TASK_EVENT_LABELS: Record<string, string> = { CREATED: "Tạo mới", UPDATED: "Cập nhật", STARTED: "Bắt đầu", COMPLETED: "Hoàn thành", CANCELLED: "Đã huỷ" };

export function taskEventLabel(type: string) {
  return TASK_EVENT_LABELS[type] ?? type;
}
