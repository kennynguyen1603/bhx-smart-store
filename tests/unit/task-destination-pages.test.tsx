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
  await expect(page({ searchParams: Promise.resolve({ storeId: "other", task: "task-2" }) })).rejects.toMatchObject({ message: `/login?callbackUrl=${encodeURIComponent(`/${path}?storeId=other&task=task-2`)}` });
});
