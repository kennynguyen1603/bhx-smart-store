// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApp } from "@/components/admin-app";
import { toast } from "@/components/ui/sonner";
import { overview } from "../fixtures/admin-core";

const admin: Session["user"] = { id: "admin", name: "Quản trị", role: "ADMIN", storeIds: ["store"], defaultStoreId: "store" };
const manager: Session["user"] = { id: "manager", name: "Quản lý", role: "MANAGER", storeIds: ["store"], defaultStoreId: "store" };
const actions = [
  ["POS", "POS bán 2 sản phẩm"],
  ["WMS", "WMS nhập thêm kho sau"],
  ["SUPPLIER", "Supplier gửi lô mới"],
  ["FEFO", "Chạy FEFO engine"],
] as const;

let root: Root;
let host: HTMLDivElement;
let writes: { body: Record<string, unknown> }[];
let readCount: number;
let writeRequest: () => Promise<Response>;
let refreshRequest: () => Promise<Response>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  writes = [];
  readCount = 0;
  writeRequest = async () => Response.json({ ok: true });
  refreshRequest = async () => Response.json(overview);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/store-changes")) return Response.json({ token: "baseline", taskUpdatedAt: null, notificationUpdatedAt: null, unreadCount: 0 });
    if (!init?.method) {
      readCount += 1;
      return readCount === 1 ? Response.json(overview) : refreshRequest();
    }
    writes.push({ body: JSON.parse(String(init.body)) });
    return writeRequest();
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { toast.dismiss(); root.unmount(); });
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => { await new Promise((done) => setTimeout(done, 20)); });
}

function button(name: string, parent: ParentNode = document) {
  const found = [...parent.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => (item.getAttribute("aria-label") || item.textContent) === name);
  expect(found, `button ${name}`).toBeDefined();
  return found!;
}

function simulator() {
  const panel = [...document.querySelectorAll<HTMLElement>("section.panel")]
    .find((item) => item.textContent?.includes("Mô phỏng dữ liệu đầu vào"));
  expect(panel, "integration simulator panel").toBeDefined();
  return panel!;
}

function simulatorButtons() {
  return [...simulator().querySelectorAll<HTMLButtonElement>("button")];
}

async function openIntegrations(user: Session["user"] = admin) {
  await act(async () => root.render(<AdminApp user={user} />));
  await settle();
  await act(async () => button("Tích hợp").click());
  expect(simulatorButtons()).toHaveLength(4);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe.each(actions)("$s integration simulation", (mode, label) => {
  it("starts immediately, blocks duplicate actions, and stays pending through refresh", async () => {
    const write = deferred<Response>();
    const refresh = deferred<Response>();
    writeRequest = () => write.promise;
    refreshRequest = () => refresh.promise;
    await openIntegrations();

    act(() => {
      const action = button(label, simulator());
      action.click();
      action.click();
    });

    expect(writes).toHaveLength(1);
    expect(writes[0].body).toMatchObject({ mode });
    expect(writes[0].body.operationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(simulatorButtons().every((item) => item.disabled)).toBe(true);
    const active = button("Đang xử lý…", simulator());
    expect(active.querySelector(".ui-spinner")).not.toBeNull();

    await act(async () => write.resolve(Response.json({ ok: true })));
    await settle();
    expect(readCount).toBe(2);
    expect(writes).toHaveLength(1);
    expect(simulatorButtons().every((item) => item.disabled)).toBe(true);
    expect(button("Đang xử lý…", simulator()).querySelector(".ui-spinner")).not.toBeNull();

    await act(async () => refresh.resolve(Response.json(overview)));
    await settle();
    expect(simulatorButtons().every((item) => !item.disabled)).toBe(true);
    expect(simulator().textContent).not.toContain("Đang xử lý…");
    expect(writes).toHaveLength(1);
  });
});

it("clears pending after an HTTP write failure and permits retry", async () => {
  const write = deferred<Response>();
  writeRequest = () => write.promise;
  await openIntegrations();
  act(() => button("POS bán 2 sản phẩm", simulator()).click());
  expect(simulatorButtons().every((item) => item.disabled)).toBe(true);

  await act(async () => write.resolve(Response.json({ error: { message: "Mô phỏng thất bại" } }, { status: 500 })));
  await settle();
  expect(simulatorButtons().every((item) => !item.disabled)).toBe(true);
  expect(document.body.textContent).toContain("Mô phỏng thất bại");

  writeRequest = async () => Response.json({ ok: true });
  await act(async () => button("POS bán 2 sản phẩm", simulator()).click());
  await settle();
  expect(writes).toHaveLength(2);
});

it("clears pending after a network write error and permits retry", async () => {
  writeRequest = async () => { throw new TypeError("Failed to fetch"); };
  await openIntegrations();
  await act(async () => button("WMS nhập thêm kho sau", simulator()).click());
  await settle();
  expect(simulatorButtons().every((item) => !item.disabled)).toBe(true);
  expect(document.body.textContent).toContain("Không thể kết nối đến máy chủ");

  writeRequest = async () => Response.json({ ok: true });
  await act(async () => button("WMS nhập thêm kho sau", simulator()).click());
  await settle();
  expect(writes).toHaveLength(2);
});

it("keeps write success separate from a failed refresh and never replays the write", async () => {
  const refresh = deferred<Response>();
  refreshRequest = () => refresh.promise;
  await openIntegrations();
  await act(async () => button("Supplier gửi lô mới", simulator()).click());
  await settle();
  expect(writes).toHaveLength(1);
  expect(simulatorButtons().every((item) => item.disabled)).toBe(true);

  await act(async () => refresh.resolve(Response.json({}, { status: 503 })));
  await settle();
  const notices = [...document.querySelectorAll<HTMLElement>("[data-sonner-toast]")].map((item) => item.textContent || "");
  expect(notices.some((message) => message.includes("Đã cập nhật dữ liệu."))).toBe(true);
  expect(notices.some((message) => message.includes("Đã lưu thay đổi nhưng không thể tải lại dữ liệu."))).toBe(true);
  expect(simulatorButtons().every((item) => !item.disabled)).toBe(true);
  expect(writes).toHaveLength(1);

  refreshRequest = async () => Response.json(overview);
  await act(async () => button("Tải lại dữ liệu").click());
  await settle();
  expect(readCount).toBe(3);
  expect(writes).toHaveLength(1);
});

it("labels global FEFO scope accurately and keeps simulator actions available to Manager", async () => {
  await openIntegrations(manager);
  expect(simulator().textContent).toContain("FEFO chạy cho tất cả cửa hàng đang hoạt động");
  expect(simulatorButtons().every((item) => !item.disabled)).toBe(true);
});

it("times out a never-settling write, clears pending, and reuses its operation key for explicit retry", async () => {
  await openIntegrations();
  vi.useFakeTimers();
  writeRequest = () => new Promise<Response>(() => undefined);

  act(() => button("POS bán 2 sản phẩm", simulator()).click());
  await act(async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); });
  expect(simulatorButtons().every((item) => item.disabled)).toBe(true);

  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  await act(async () => vi.advanceTimersByTimeAsync(100));
  await act(async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); });
  expect(simulatorButtons().every((item) => !item.disabled)).toBe(true);
  expect(document.body.textContent).toContain("Không xác định được kết quả mô phỏng do quá thời gian");
  const operationId = writes[0].body.operationId;

  writeRequest = async () => Response.json({ ok: true });
  await act(async () => button("POS bán 2 sản phẩm", simulator()).click());
  await act(async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); });
  expect(writes).toHaveLength(2);
  expect(writes[1].body.operationId).toBe(operationId);

  await act(async () => button("POS bán 2 sản phẩm", simulator()).click());
  await act(async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); });
  expect(writes).toHaveLength(3);
  expect(writes[2].body.operationId).not.toBe(operationId);
});

it("times out a never-settling refresh after confirmed success without replaying the write", async () => {
  await openIntegrations();
  vi.useFakeTimers();
  const successToast = vi.spyOn(toast, "success");
  const errorToast = vi.spyOn(toast, "error");
  refreshRequest = () => new Promise<Response>(() => undefined);

  act(() => button("WMS nhập thêm kho sau", simulator()).click());
  await act(async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); });
  expect(writes).toHaveLength(1);
  expect(simulatorButtons().every((item) => item.disabled)).toBe(true);

  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  await act(async () => vi.advanceTimersByTimeAsync(100));
  await act(async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); });
  expect(simulatorButtons().every((item) => !item.disabled)).toBe(true);
  expect(writes).toHaveLength(1);
  expect(successToast).toHaveBeenCalledWith("Đã cập nhật dữ liệu.");
  expect(errorToast).toHaveBeenCalledWith("Đã lưu thay đổi nhưng quá thời gian tải lại dữ liệu. Vui lòng tải lại dữ liệu.");
});
