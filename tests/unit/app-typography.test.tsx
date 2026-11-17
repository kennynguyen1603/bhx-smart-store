// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import { LoginForm } from "@/components/login-form";
import { LoginRoleChoice, LoginShell } from "@/components/login-role-choice";
import { StaffApp } from "@/components/staff-app";
import { AdminApp } from "@/components/admin-app";
import { referenceOverview } from "../fixtures/admin-reference";

// Replace authentication, persistent device storage and server I/O, retaining real UI/CSS.
vi.mock("next-auth/react", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/offline", () => ({
  cacheStaffPayload: vi.fn(async () => undefined), enqueueMutation: vi.fn(async () => undefined),
  markCachedStaffNotificationsRead: vi.fn(async () => undefined),
  flushOfflineMutations: vi.fn(async () => ({ remaining: 0, conflicts: [] })),
  getCachedStaffPayload: vi.fn(async () => null), offlineQueueCount: vi.fn(async () => 0),
}));
const stylesheet = readFileSync("src/app/globals.css", "utf8");
const user: Session["user"] = { id: "user", name: "Nhân viên cửa hàng", role: "STAFF", storeIds: ["store"], defaultStoreId: "store" };
const notification = { id: "n", type: "TASK_CREATED", title: "Nhiệm vụ được giao", body: "Kiểm tra và bổ sung hàng lên kệ", readAt: null, createdAt: "2026-11-17T00:00:00Z", taskId: null };
const task = { id: "task", type: "RESTOCK", status: "OPEN", priority: "HIGH", title: "Bổ sung sữa tươi cho cửa hàng", note: "Kiểm tra tồn kệ", createdAt: "2026-11-17T00:00:00Z", completedAt: null, assignee: null,
  product: { id: "product", name: "Sữa tươi", emoji: "🥛", basePriceVnd: 17000 },
  shelf: { id: "shelf", code: "K-01", label: "Kệ sữa", esls: [{ code: "ESL-01" }] }, lot: null, inventory: null };
let root: Root, host: HTMLDivElement, style: HTMLStyleElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.startsWith("/api/store-changes") ? { token: "base" } : url.startsWith("/api/admin") ? { ...referenceOverview, notifications: [notification] } : {
    stores: referenceOverview.stores, selectedStoreId: "store", tasks: [task], inventories: [], notifications: [notification], recentEvents: [], metrics: { openTasks: 1, highPriority: 1, lowShelves: 0, fefoTasks: 0, completionRate: 0 },
  })));
  style = document.createElement("style"); style.textContent = stylesheet; document.head.append(style);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); style.remove(); vi.unstubAllGlobals(); });
async function mount(element: React.ReactNode) {
  await act(async () => root.render(element));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}
async function click(name: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => (node.getAttribute("aria-label") || node.textContent) === name);
  expect(button, name).toBeDefined(); await act(async () => button!.click());
}
function readable(selectors: string[], minimum = 14) {
  for (const selector of selectors) {
    const nodes = [...document.querySelectorAll(selector)]; expect(nodes.length, selector).toBeGreaterThan(0);
    for (const node of nodes) expect.soft(parseFloat(getComputedStyle(node).fontSize), `${selector}: ${node.textContent}`).toBeGreaterThanOrEqual(minimum);
  }
}
function touchable(selectors: string[]) {
  readable(selectors);
  for (const selector of selectors) for (const node of document.querySelectorAll(selector)) {
    expect.soft(parseFloat(getComputedStyle(node).minHeight), `${selector} height`).toBeGreaterThanOrEqual(44);
  }
}

describe.each([320, 390, 1280])("application typography at %ipx", width => {
  beforeEach(() => (window as unknown as Window).happyDOM.setViewport({ width, height: 900 }));
  it("keeps landing copy, eyebrow and entry links readable", async () => {
    await mount(<HomePage />);
    readable([".landing-hero p", ".card-copy > span", ".card-link"]);
    readable([".logo small", ".card-copy small", ".system-online"], 12);
    touchable([".demo-links a"]);
  });
  it.each(["choice", "staff", "admin"] as const)("keeps %s login copy and controls readable", async audience => {
    await mount(<LoginShell>{audience === "choice" ? <LoginRoleChoice /> : <LoginForm audience={audience} />}</LoginShell>);
    readable([".login-card p"]); readable([".auth-visual > small"], 12);
    touchable([audience === "choice" ? ".login-role-choice .button" : ".login-card form > button"]);
    if (audience !== "choice") { readable([".login-card label", ".input-wrap input"]); touchable([".input-wrap button"]); }
  });
  it("keeps Staff navigation, filters and task details readable", async () => {
    await mount(<StaffApp user={user} />);
    readable([".side-nav button", ".task-copy strong"]);
    readable([".side-nav .count", ".notification-button span", ".metric small", ".task-meta .badge", ".task-meta time"], 12);
    await click("Nhiệm vụ1");
    touchable([".filter-row button"]);
    await act(async () => host.querySelector<HTMLButtonElement>(".task-row")!.click());
    readable([".modal-head p", ".product-summary strong", ".detail-box strong"]);
    readable([".product-summary small", ".detail-box span", ".section-label"], 12);
    touchable([".modal-actions .button"]);
  });
  it("keeps Admin navigation, tables, forms and notifications readable", async () => {
    await mount(<AdminApp user={{ ...user, role: "ADMIN" }} />);
    readable([".side-nav button"]); readable([".notification-button span"], 12);
    await click("Danh mục");
    readable([".data-table th", ".data-table td"]); touchable([".admin-actions .button", ".row-actions .button"]);
    await click("Thêm sản phẩm");
    readable([".ui-dialog-title"], 18); readable([".ui-label", ".ui-input", ".ui-dialog-description"]);
    touchable([".ui-dialog-footer button"]);
    await click("Hủy");
    await click("Thông báo, 1 chưa đọc");
    readable([".notification-status", ".notification-row strong", ".notification-row p"]);
    readable([".notification-row time", ".notification-row-heading span"], 12);
    touchable([".notification-read-one", ".notification-read-action .ui-button"]);
  });
});
