import { apiErrorResponse, requireCronSecret } from "@/lib/api-auth";
import { runFefoEngine } from "@/lib/business";

export async function POST(request: Request) {
  try {
    requireCronSecret(request);
    return Response.json(await runFefoEngine());
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function GET(request: Request) {
  return POST(request);
}
