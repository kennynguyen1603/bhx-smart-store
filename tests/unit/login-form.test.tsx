// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";

const { signIn, signOut } = vi.hoisted(() => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next-auth/react", () => ({ signIn, signOut }));
let container: HTMLDivElement;
let root: Root;
let sessionRole = "STAFF";
let sessionResponse: () => Promise<Response>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.location.href = "http://localhost/staff/login";
  sessionRole = "STAFF";
  signIn.mockReset().mockResolvedValue({ ok: true, status: 200, error: undefined, url: "https://evil.example/" });
  signOut.mockReset().mockResolvedValue({ url: "/staff/login" });
  sessionResponse = async () => Response.json({ user: { id: "user-1", name: "User", email: "user@example.com", role: sessionRole, storeIds: ["store-2"], defaultStoreId: "store-2" }, expires: "2099-01-01T00:00:00.000Z" });
  vi.stubGlobal("fetch", vi.fn((url, options) => {
    expect(url).toBe("/api/auth/session");
    expect(options).toMatchObject({ cache: "no-store" });
    return sessionResponse();
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(audience: "staff" | "admin", callbackUrl?: string) {
  await act(async () => root.render(<LoginForm audience={audience} callbackUrl={callbackUrl} />));
}
async function submit() {
  // Native setters and change events exercise React's controlled form values.
  await act(async () => {
    for (const [selector, value] of [['input[type="email"]', "user@example.com"], ['input[type="password"]', "a-secret-password"]]) {
      const input = container.querySelector<HTMLInputElement>(selector)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

it.each(["staff", "admin"] as const)("starts %s login blank without demo credentials", async audience => {
  await render(audience);
  expect(container.querySelector<HTMLInputElement>('input[type="email"]')!.value).toBe("");
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
  expect(container.querySelector(".account-chips")).toBeNull();
  expect(container.textContent).not.toMatch(/@demo\.bhx|Demo@123/);
});

it.each([["staff", "STAFF"], ["staff", "MANAGER"], ["admin", "MANAGER"], ["admin", "ADMIN"]] as const)("signs %s audience in with verified %s session and preserves task context", async (audience, role) => {
  sessionRole = role;
  const path = `/${audience}?storeId=store-2&task=task-7`;
  await render(audience, path); await submit();
  expect(signIn).toHaveBeenCalledExactlyOnceWith("credentials", { email: "user@example.com", password: "a-secret-password", redirect: false, callbackUrl: path });
  expect(window.location.pathname + window.location.search).toBe(path);
  expect(signOut).not.toHaveBeenCalled();
});

it.each([["staff", "ADMIN", "/admin/login"], ["admin", "STAFF", "/staff/login"]] as const)("signs out wrong role on %s before showing correct login", async (audience, role, link) => {
  sessionRole = role;
  window.location.href = `http://localhost/${audience}/login`;
  let finishSignOut!: () => void;
  signOut.mockImplementation(() => new Promise(resolve => { finishSignOut = () => resolve({ url: link }); }));
  await render(audience); await submit();
  expect(signOut).toHaveBeenCalledExactlyOnceWith({ redirect: false });
  expect(container.querySelector(`a[href="${link}"]`)).toBeNull();
  await act(async () => finishSignOut());
  expect(window.location.pathname).toBe(`/${audience}/login`);
  expect(container.querySelector(`a[href="${link}"]`)?.textContent).toMatch(/Đăng nhập/);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("vai trò");
});

it("ignores unsafe callback and provider response URL", async () => {
  await render("staff", "//evil.example/staff"); await submit();
  expect(window.location.pathname).toBe("/staff");
  expect(signIn.mock.calls[0][1].callbackUrl).toBe("/staff");
});
it("keeps invalid credentials generic without reading a session", async () => {
  signIn.mockResolvedValue({ ok: false, status: 401, error: "CredentialsSignin", url: null });
  await render("staff"); await submit();
  expect(window.location.pathname).toBe("/staff/login");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Email hoặc mật khẩu không đúng.");
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["missing", "failure", "network"])("fails closed on %s session verification", async kind => {
  sessionResponse = kind === "network" ? async () => { throw new Error("offline"); } : async () => Response.json({}, { status: kind === "failure" ? 503 : 200 });
  await render("staff"); await submit();
  expect(signOut).toHaveBeenCalledWith({ redirect: false });
  expect(window.location.pathname).toBe("/staff/login");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
