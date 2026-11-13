import { apiErrorResponse, requireUser } from "@/lib/api-auth";
import { completeRestock } from "@/lib/business";
import { restockSchema } from "@/lib/contracts";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const input = restockSchema.parse(await request.json());
    return Response.json(await completeRestock(id, user, input));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
