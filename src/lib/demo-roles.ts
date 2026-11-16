import type { Role } from "@/generated/prisma/client";

export type LoginAudience = "staff" | "admin";

export const ROLE_LABELS: Record<Role, string> = {
  STAFF: "Nhân viên", MANAGER: "Quản lý", ADMIN: "Quản trị",
};

export function isRoleAllowedForAudience(role: Role, audience: LoginAudience): boolean {
  return role === "MANAGER" || role === (audience === "staff" ? "STAFF" : "ADMIN");
}

// Only local destinations inside the chosen experience may survive authentication.
export function safeAudienceCallback(audience: LoginAudience, callbackUrl?: string): string {
  const fallback = `/${audience}`;
  if (!callbackUrl?.startsWith("/") || callbackUrl.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(callbackUrl)) return fallback;
  try {
    decodeURIComponent(callbackUrl); // Reject malformed percent escapes, including in query parameters.
    const url = new URL(callbackUrl, "https://callback.invalid");
    const path = callbackUrl.split(/[?#]/, 1)[0];
    const decodedPath = decodeURIComponent(url.pathname);
    if (url.origin !== "https://callback.invalid" || url.pathname !== path || decodedPath !== path) return fallback;
    if (path !== fallback && !path.startsWith(`${fallback}/`)) return fallback;
    if (path === `${fallback}/login` || path.startsWith(`${fallback}/login/`)) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
