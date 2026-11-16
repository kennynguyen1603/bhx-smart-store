import type { Session } from "next-auth";
import { beforeEach, expect, it, vi } from "vitest";
import StaffPage from "@/app/staff/page";
import AdminPage from "@/app/admin/page";
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("next-auth", () => ({ getServerSession: async () => auth.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/components/staff-app", () => ({ StaffApp: () => null }));
vi.mock("@/components/admin-app", () => ({ AdminApp: () => null }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
beforeEach(() => { auth.session = { expires: "2099-01-01", user: { id: "manager", role: "MANAGER", storeIds: ["home", "other"], defaultStoreId: "home" } }; });
it.each([["staff", StaffPage], ["admin", AdminPage]] as const)("%s forwards an authorized task destination and ignores a forbidden store", async (_, page) => {
  const result = await page({ searchParams: Promise.resolve({ storeId: "other", task: "task-2" }) });
  expect(result.props).toMatchObject({ initialStoreId: "other", initialTaskId: "task-2" });
  const denied = await page({ searchParams: Promise.resolve({ storeId: "forbidden", task: "secret" }) });
  expect(denied.props.initialStoreId).toBeUndefined(); expect(denied.props.initialTaskId).toBeUndefined();
});
it.each([["staff", StaffPage], ["admin", AdminPage]] as const)("%s preserves the task destination through login", async (path, page) => {
  auth.session = null;
  await expect(page({ searchParams: Promise.resolve({ storeId: "other", task: "task-2" }) })).rejects.toMatchObject({ message: `/${path}/login?callbackUrl=${encodeURIComponent(`/${path}?storeId=other&task=task-2`)}` });
});

it("translates an authenticated Admin push destination to the Admin task view", async () => {
  auth.session!.user.role = "ADMIN";
  await expect(StaffPage({ searchParams: Promise.resolve({ storeId: "other", task: "task-2" }) })).rejects.toMatchObject({ message: "/admin?storeId=other&task=task-2" });
});
it("retains Admin global-store access when translating a push link", async () => {
  auth.session!.user.role = "ADMIN";
  await expect(StaffPage({ searchParams: Promise.resolve({ storeId: "outside-memberships", task: "task-2" }) })).rejects.toMatchObject({ message: "/admin?storeId=outside-memberships&task=task-2" });
});
const adminQueries: [Record<string, string | string[] | undefined>, string][] = [
  [{ storeId: ["other", "home"], task: ["task-2"] }, "/admin"],
  [{ storeId: "other", task: ["task-2"] }, "/admin?storeId=other"],
  [{ storeId: ["other"], task: "task-2" }, "/admin?task=task-2"],
  [{ callbackUrl: "//evil.example/staff", redirect: "https://evil.example" }, "/admin"],
  [{ storeId: "other&callbackUrl=//evil.example", task: "task-2#https://evil.example" }, "/admin?storeId=other%26callbackUrl%3D%2F%2Fevil.example&task=task-2%23https%3A%2F%2Fevil.example"],
];
it.each(adminQueries)("Admin translation ignores malformed fields and encodes retained values: %j", async (query, destination) => {
  auth.session!.user.role = "ADMIN";
  await expect(StaffPage({ searchParams: Promise.resolve({ ...query }) })).rejects.toMatchObject({ message: destination });
});
it.each(["STAFF", "MANAGER"] as const)("keeps %s forbidden-store task context out of the Staff app", async role => {
  auth.session!.user.role = role;
  const result = await StaffPage({ searchParams: Promise.resolve({ storeId: "forbidden", task: "secret" }) });
  expect(result.props).toMatchObject({ initialStoreId: undefined, initialTaskId: undefined });
});
it("does not translate a Staff account into an Admin task context", async () => {
  auth.session!.user.role = "STAFF";
  await expect(AdminPage({ searchParams: Promise.resolve({ storeId: "other", task: "task-2" }) })).rejects.toMatchObject({ message: "/staff" });
});
