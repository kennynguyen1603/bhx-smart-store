import { getServerSession } from "next-auth";
import type { Role } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "API_ERROR",
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function requireUser(roles?: Role[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new ApiError(401, "Bạn cần đăng nhập", "UNAUTHORIZED");
  if (roles && !roles.includes(session.user.role)) throw new ApiError(403, "Bạn không có quyền thực hiện thao tác này", "FORBIDDEN");
  return session.user;
}

export function ensureStoreAccess(user: { role: Role; storeIds: string[] }, storeId: string) {
  if (user.role !== "ADMIN" && !user.storeIds.includes(storeId)) {
    throw new ApiError(403, "Bạn không được phân quyền tại cửa hàng này", "STORE_FORBIDDEN");
  }
}

export function requireIntegrationKey(request: Request) {
  const configured = process.env.INTEGRATION_API_KEY;
  if (!configured || request.headers.get("x-integration-key") !== configured) {
    throw new ApiError(401, "Integration API key không hợp lệ", "INVALID_INTEGRATION_KEY");
  }
}

export function requireCronSecret(request: Request) {
  const configured = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configured || (bearer !== configured && request.headers.get("x-cron-secret") !== configured)) {
    throw new ApiError(401, "Cron secret không hợp lệ", "INVALID_CRON_SECRET");
  }
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ error: { code: error.code, message: error.message, details: error.details } }, { status: error.status });
  }
  if (error instanceof Error && error.name === "ZodError") {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Dữ liệu không hợp lệ" } }, { status: 400 });
  }
  console.error(error);
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "Hệ thống đang bận, vui lòng thử lại" } }, { status: 500 });
}
