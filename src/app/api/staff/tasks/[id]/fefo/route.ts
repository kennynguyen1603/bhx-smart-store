import { apiErrorResponse, requireUser } from "@/lib/api-auth";
import { completeFefoTask } from "@/lib/business";
import { taskMutationSchema } from "@/lib/contracts";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const input = taskMutationSchema.parse(await request.json());
    return Response.json(await completeFefoTask(id, user, input.clientMutationId));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
