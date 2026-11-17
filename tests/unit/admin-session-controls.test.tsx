// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "next-auth";
import { signOut } from "next-auth/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminApp } from "@/components/admin-app";
import { referenceOverview } from "../fixtures/admin-reference";

// Auth.js clears the cookie and navigates the browser; isolate that external boundary.
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.startsWith("/api/store-changes") ? { token: "base" } : structuredClone(referenceOverview))));
  vi.mocked(signOut).mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it.each(["ADMIN", "MANAGER"] as const)("%s can sign out once to Admin login from either named session control", async role => {
  const user: Session["user"] = { id: "admin", name: "Quản trị", role, storeIds: ["store"], defaultStoreId: "store" };
  await act(async () => root.render(<AdminApp user={user} />));
  for (const surface of [".user-card", ".workspace-header"]) {
    const control = host.querySelector<HTMLButtonElement>(`${surface} button[aria-label="Đăng xuất"]`);
    expect(control, `${surface} named logout`).not.toBeNull();
    expect(control!.textContent).toContain("Đăng xuất");
    vi.mocked(signOut).mockClear();
    await act(async () => control!.click());
    expect(signOut).toHaveBeenCalledExactlyOnceWith({ callbackUrl: "/admin/login" });
  }
});
