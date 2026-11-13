import { apiErrorResponse, ensureStoreAccess, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const user = await requireUser();
    const { code } = await context.params;
    const esl = await prisma.eSL.findUnique({ where: { code }, include: { store: true, shelf: true, product: true } });
    if (!esl) return Response.json({ error: { code: "ESL_NOT_FOUND", message: "Không tìm thấy mã ESL" } }, { status: 404 });
    ensureStoreAccess(user, esl.storeId);
    const inventory = await prisma.inventory.findUnique({ where: { storeId_shelfId_productId: { storeId: esl.storeId, shelfId: esl.shelfId, productId: esl.productId } } });
    return Response.json({ esl, inventory });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
