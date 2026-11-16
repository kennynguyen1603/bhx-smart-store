import { z } from "zod";
import { apiErrorResponse, ensureStoreAccess, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

const readAllSchema = z.object({ storeId: z.string().trim().min(1), ids: z.array(z.string().min(1)) });

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const { storeId, ids } = readAllSchema.parse(await request.json());
    ensureStoreAccess(user, storeId);
    const readAt = new Date();
    const { count } = await prisma.notification.updateMany({
      where: { id: { in: ids }, userId: user.id, storeId, readAt: null },
      data: { readAt },
    });
    return Response.json({ updated: count, readAt: readAt.toISOString() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
