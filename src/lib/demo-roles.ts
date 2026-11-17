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

// A store-wide push can arrive at the other role's entry point. Carry only task
// identifiers across that recovery; never forward arbitrary callback parameters.
export function safeAudienceTaskCallback(audience: LoginAudience, callbackUrl?: string): string {
  const source: LoginAudience = audience === "admin" ? "staff" : "admin";
  const callback = safeAudienceCallback(source, callbackUrl);
  const url = new URL(callback, "https://callback.invalid");
  if (url.pathname !== `/${source}`) return `/${audience}`;
  const context = new URLSearchParams();
  for (const key of ["storeId", "task"]) {
    const values = url.searchParams.getAll(key);
    if (values.length > 1 || [...url.searchParams.keys()].some(name => name.startsWith(`${key}[`))) return `/${audience}`;
    if (values.length) {
      if (!/^[a-zA-Z0-9_-]+$/.test(values[0])) return `/${audience}`;
      context.set(key, values[0]);
    }
  }
  return safeAudienceCallback(audience, `/${audience}${context.size ? `?${context}` : ""}`);
}
