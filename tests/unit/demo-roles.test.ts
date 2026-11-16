import { expect, it } from "vitest";
import { isRoleAllowedForAudience, safeAudienceCallback } from "@/lib/demo-roles";

it.each([
  ["STAFF", "staff", true], ["MANAGER", "staff", true], ["ADMIN", "staff", false],
  ["STAFF", "admin", false], ["MANAGER", "admin", true], ["ADMIN", "admin", true],
] as const)("allows %s into %s only when authorized", (role, audience, allowed) => {
  expect(isRoleAllowedForAudience(role, audience)).toBe(allowed);
});

it.each(["staff", "admin"] as const)("preserves same-audience task destinations for %s", audience => {
  const path = `/${audience}?storeId=store-2&task=task-7&taskId=task-7`;
  expect(safeAudienceCallback(audience, path)).toBe(path);
  expect(safeAudienceCallback(audience, `/${audience}/tasks/task-7?storeId=store-2`)).toBe(`/${audience}/tasks/task-7?storeId=store-2`);
});

it.each([
  undefined, "", "https://evil.example/staff", "http://localhost/staff", "//evil.example/staff",
  "/\\evil.example/staff", "staff", "/staffing", "/staff/../admin", "/staff%2f..%2fadmin",
  "/staff?bad=%", "/staff?bad=%E0%A4%A", "/staff\n", "/staff/login", "/staff/login?callbackUrl=/admin",
  "/admin", "/admin?storeId=other&task=task-2", "/staff\\..\\admin",
])("rejects unsafe Staff callback %s", callback => {
  expect(safeAudienceCallback("staff", callback)).toBe("/staff");
});
it.each(["/staff", "/administrator", "//evil.example/admin", "/admin/../staff", "/admin?bad=%", "/admin/login"])("rejects unsafe Admin callback %s", callback => {
  expect(safeAudienceCallback("admin", callback)).toBe("/admin");
});
