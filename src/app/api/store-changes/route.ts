import { z } from "zod";
import { apiErrorResponse, ensureStoreAccess, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const storeId = z.string().trim().min(1).parse(new URL(request.url).searchParams.get("storeId"));
    ensureStoreAccess(user, storeId);
    const where = { userId: user.id, storeId };
    const [tasks, notifications, unreadCount] = await Promise.all([
      prisma.task.aggregate({ where: { storeId }, _max: { updatedAt: true } }),
      prisma.notification.aggregate({ where, _max: { createdAt: true, readAt: true } }),
      prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);
    const taskUpdatedAt = tasks._max.updatedAt?.toISOString() || null;
    const createdAt = notifications._max.createdAt?.toISOString() || null;
    const readAt = notifications._max.readAt?.toISOString() || null;
    const notificationUpdatedAt = [createdAt, readAt].filter((date): date is string => date !== null).sort().at(-1) || null;
    return Response.json({
      token: JSON.stringify([taskUpdatedAt, createdAt, readAt, unreadCount]),
      taskUpdatedAt, notificationUpdatedAt, unreadCount,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
