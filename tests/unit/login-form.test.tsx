// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";

const { signIn, params } = vi.hoisted(() => ({ signIn: vi.fn(), params: new URLSearchParams() }));
vi.mock("next-auth/react", () => ({ signIn }));
vi.mock("next/navigation", () => ({ useSearchParams: () => params }));

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  params.delete("callbackUrl");
  window.location.href = "http://localhost/login";
  signIn.mockReset().mockResolvedValue({ ok: true, status: 200, error: undefined, url: null });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<LoginForm />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("explains all three demo roles in Vietnamese", () => {
  expect(Array.from(container.querySelectorAll(".account-chips button"), (button) => button.textContent)).toEqual([
    "Nhân viên — thực hiện nhiệm vụ", "Quản lý — giám sát cửa hàng", "Quản trị — cấu hình hệ thống",
  ]);
});

it.each([
  [0, "staff@demo.bhx", "/staff", "/admin"],
  [1, "manager@demo.bhx", "/staff", "/admin"],
  [2, "admin@demo.bhx", "/admin", "/staff"],
] as const)("signs in selected account %s and uses its primary destination", async (index, email, destination, callback) => {
  params.set("callbackUrl", callback);
  await act(async () => container.querySelectorAll<HTMLButtonElement>(".account-chips button")[index].click());
  expect(container.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe(email);
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(signIn).toHaveBeenCalledExactlyOnceWith("credentials", { email, password: "Demo@123", redirect: false, callbackUrl: destination });
  expect(window.location.pathname).toBe(destination);
});

it("uses the successful sign-in response URL", async () => {
  signIn.mockResolvedValue({ ok: true, status: 200, error: undefined, url: "http://localhost/staff?welcome=1" });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(window.location.pathname + window.location.search).toBe("/staff?welcome=1");
});

it.each([undefined, "/staff?view=history"])("keeps manual-email fallback or explicit callback %s", async (callback) => {
  if (callback) params.set("callbackUrl", callback);
  const input = container.querySelector<HTMLInputElement>('input[type="email"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "manual@example.com");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const destination = callback || "/staff";
  expect(signIn).toHaveBeenCalledExactlyOnceWith("credentials", { email: "manual@example.com", password: "Demo@123", redirect: false, callbackUrl: destination });
  expect(window.location.pathname + window.location.search).toBe(destination);
});

it("keeps an unsuccessful sign-in on the form with feedback", async () => {
  signIn.mockResolvedValue({ ok: false, status: 401, error: "CredentialsSignin", url: null });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(window.location.pathname).toBe("/login");
  expect(container.querySelector(".form-error")?.textContent).toBe("Email hoặc mật khẩu không đúng.");
});
