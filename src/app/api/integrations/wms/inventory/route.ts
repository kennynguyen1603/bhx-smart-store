import { apiErrorResponse, requireIntegrationKey } from "@/lib/api-auth";
import { processWmsInventory } from "@/lib/business";
import { wmsInventorySchema } from "@/lib/contracts";

export async function POST(request: Request) {
  try {
    requireIntegrationKey(request);
    const input = wmsInventorySchema.parse(await request.json());
    return Response.json(await processWmsInventory(input));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
