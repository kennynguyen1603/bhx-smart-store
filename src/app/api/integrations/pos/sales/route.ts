import { apiErrorResponse, requireIntegrationKey } from "@/lib/api-auth";
import { processSaleEvent } from "@/lib/business";
import { saleEventSchema } from "@/lib/contracts";

export async function POST(request: Request) {
  try {
    requireIntegrationKey(request);
    const input = saleEventSchema.parse(await request.json());
    return Response.json(await processSaleEvent(input));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
