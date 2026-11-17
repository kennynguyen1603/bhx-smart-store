// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import StaffPage from "@/app/staff/page";
import AdminPage from "@/app/admin/page";
import LoginPage from "@/app/login/page";
import StaffLoginPage from "@/app/staff/login/page";
import AdminLoginPage from "@/app/admin/login/page";
const { getServerSession } = vi.hoisted(() => ({ getServerSession: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/staff-app", () => ({ StaffApp: () => null }));
vi.mock("@/components/admin-app", () => ({ AdminApp: () => null }));
beforeEach(() => getServerSession.mockReset().mockResolvedValue(null));

it.each([StaffLoginPage, AdminLoginPage])("drops array callback parameters before rendering the role form", async Page => {
  const element = await Page({ searchParams: Promise.resolve({ callbackUrl: ["/staff?storeId=store-2&task=task-7", "https://evil.example"] }) });
  expect(element.props.children.props.callbackUrl).toBeUndefined();
});

it.each([["staff", StaffPage], ["admin", AdminPage]] as const)("guards unauthenticated %s with audience login retaining task context", async (path, Page) => {
  await expect(Page({ searchParams: Promise.resolve({ storeId: "store-2", task: "task-7" }) })).rejects.toThrow(`redirect:/${path}/login?callbackUrl=${encodeURIComponent(`/${path}?storeId=store-2&task=task-7`)}`);
});
it.each([["staff", StaffPage], ["admin", AdminPage]] as const)("guards bare unauthenticated %s", async (path, Page) => {
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(`redirect:/${path}/login?callbackUrl=${encodeURIComponent(`/${path}`)}`);
});
it.each([["ADMIN", StaffPage, "/admin"], ["STAFF", AdminPage, "/staff"]] as const)("redirects disallowed %s to primary experience", async (role, Page, target) => {
  getServerSession.mockResolvedValue({ user: { id: "u1", role, storeIds: ["store-2"] } });
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(`redirect:${target}`);
});
it.each([StaffPage, AdminPage])("permits Manager and retains authorized task props", async Page => {
  getServerSession.mockResolvedValue({ user: { id: "u1", role: "MANAGER", storeIds: ["store-2"] } });
  const element = await Page({ searchParams: Promise.resolve({ storeId: "store-2", task: "task-7" }) });
  expect(element.props).toMatchObject({ initialStoreId: "store-2", initialTaskId: "task-7" });
});
it.each([StaffPage, AdminPage])("drops task context outside Manager membership", async Page => {
  getServerSession.mockResolvedValue({ user: { id: "u1", role: "MANAGER", storeIds: ["store-1"] } });
  const element = await Page({ searchParams: Promise.resolve({ storeId: "store-2", task: "task-7" }) });
  expect(element.props).toMatchObject({ initialStoreId: undefined, initialTaskId: undefined });
});
it("renders neutral login as only two audience links with no credential form", async () => {
  const element = await LoginPage({ searchParams: Promise.resolve({ callbackUrl: "/admin?storeId=store-2&task=task-7" }) });
  const container = document.createElement("div"); container.innerHTML = renderToStaticMarkup(element);
  const links = Array.from(container.querySelectorAll('nav[aria-label="Chọn trang đăng nhập"] a'));
  expect(links.map(a => [a.textContent, a.getAttribute("href")])).toEqual([
    ["Tôi là nhân viên / quản lý", "/staff/login"],
    ["Tôi là quản trị", "/admin/login?callbackUrl=%2Fadmin%3FstoreId%3Dstore-2%26task%3Dtask-7"],
  ]);
  expect(container.querySelector("input, form")).toBeNull();
  expect(container.textContent).not.toMatch(/@demo\.bhx|Demo@123/);
});
