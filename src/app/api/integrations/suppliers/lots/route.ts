import { apiErrorResponse, requireIntegrationKey } from "@/lib/api-auth";
import { processSupplierLot } from "@/lib/business";
import { supplierLotSchema } from "@/lib/contracts";

export async function POST(request: Request) {
  try {
    requireIntegrationKey(request);
    const input = supplierLotSchema.parse(await request.json());
    return Response.json(await processSupplierLot(input));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
