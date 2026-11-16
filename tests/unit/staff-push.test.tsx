// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { StaffApp } from "@/components/staff-app";

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/components/barcode-scanner", () => ({ BarcodeScanner: () => null }));
vi.mock("@/components/esl-scanner-modal", () => ({ EslScannerModal: () => null }));
vi.mock("@/components/logo", () => ({ Logo: () => null }));
vi.mock("@/lib/offline", () => ({
  cacheStaffPayload: vi.fn(async () => undefined),
  enqueueMutation: vi.fn(async () => undefined),
  flushOfflineMutations: vi.fn(async () => ({ remaining: 0, conflicts: [] })),
  getCachedStaffPayload: vi.fn(async () => null),
  offlineQueueCount: vi.fn(async () => 0),
}));

const user = {
  id: "staff-1",
  name: "Nhân viên Demo",
  email: "staff@demo.bhx",
  role: "STAFF",
  storeIds: ["store-1"],
  defaultStoreId: "store-1",
} as Session["user"];

const staffPayload = {
  stores: [{ id: "store-1", code: "BHX-01", name: "BHX Demo", address: "123 Demo" }],
  selectedStoreId: "store-1",
  tasks: [],
  inventories: [],
  notifications: [{ id: "notification-1" }],
  recentEvents: [],
  metrics: { openTasks: 0, highPriority: 0, lowShelves: 0, fefoTasks: 0, completionRate: 100 },
};

type PushSubscriptionDouble = { toJSON(): { endpoint: string; keys: { auth: string; p256dh: string } } };

function subscription(): PushSubscriptionDouble {
  return { toJSON: () => ({ endpoint: "https://push.example/subscription", keys: { auth: "auth", p256dh: "key" } }) };
}

describe("Staff Web Push lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: Mock<typeof fetch>;
  let pushRequest: () => Promise<Response>;
  let serviceWorkerDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "AQIDBA==");
    serviceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
    pushRequest = async () => new Response(null, { status: 201 });
    fetchMock = vi.fn(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/staff/tasks")) {
        return new Response(JSON.stringify(staffPayload), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "/api/push/subscriptions") return pushRequest();
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(StaffApp, { user }));
      await Promise.resolve();
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    if (serviceWorkerDescriptor) Object.defineProperty(navigator, "serviceWorker", serviceWorkerDescriptor);
    else delete (navigator as Navigator & { serviceWorker?: ServiceWorkerContainer }).serviceWorker;
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function installPushApis({
    permission = "granted",
    requestPermission = vi.fn(async () => permission),
    ready = Promise.resolve({ pushManager: { subscribe: vi.fn(async () => subscription()) } }),
  }: {
    permission?: NotificationPermission;
    requestPermission?: Mock<() => Promise<NotificationPermission>>;
    ready?: Promise<{ pushManager: { subscribe: Mock<() => Promise<PushSubscriptionDouble>> } }>;
  } = {}) {
    vi.stubGlobal("Notification", { permission, requestPermission });
    vi.stubGlobal("PushManager", function PushManager() {});
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready, getRegistrations: vi.fn(async () => []) },
    });
    return { requestPermission, ready };
  }

  function pushButton() {
    const button = container.querySelector<HTMLButtonElement>(".notification-button");
    expect(button).not.toBeNull();
    return button!;
  }

  function pushPosts() {
    return fetchMock.mock.calls.filter(([input]) => String(input) === "/api/push/subscriptions");
  }

  async function flushPromises() {
    await act(async () => {
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
  }

  async function clickPush() {
    await act(async () => {
      pushButton().click();
      await Promise.resolve();
    });
    await flushPromises();
  }

  function expectIdle() {
    expect(pushButton().disabled).toBe(false);
    expect(pushButton().getAttribute("aria-label")).toBe("Bật thông báo");
  }

  it("reports unsupported browser APIs without attempting a subscription and clears pending", async () => {
    vi.stubGlobal("Notification", undefined);
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });

    await clickPush();

    expect(container.textContent).toContain("Trình duyệt này không hỗ trợ Web Push.");
    expect(pushPosts()).toHaveLength(0);
    expectIdle();
  });

  it("does not request or subscribe again after notification permission was denied", async () => {
    const requestPermission = vi.fn(async () => "denied" as NotificationPermission);
    const subscribe = vi.fn(async () => subscription());
    installPushApis({
      permission: "denied",
      requestPermission,
      ready: Promise.resolve({ pushManager: { subscribe } }),
    });

    await clickPush();

    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Bạn đã từ chối quyền nhận thông báo.");
    expectIdle();
  });

  it("bounds service-worker readiness, reports the timeout, and clears pending", async () => {
    vi.useFakeTimers();
    installPushApis({ ready: new Promise(() => undefined) });

    await act(async () => {
      pushButton().click();
      await Promise.resolve();
    });
    expect(pushButton().disabled).toBe(true);
    expect(pushButton().getAttribute("aria-label")).toBe("Đang bật thông báo");

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    await flushPromises();

    expect(container.textContent).toContain("Service Worker chưa sẵn sàng. Hãy thử lại.");
    expect(pushPosts()).toHaveLength(0);
    expectIdle();
  });

  it("reports a rejected subscription and clears pending for retry", async () => {
    installPushApis({
      ready: Promise.resolve({ pushManager: { subscribe: vi.fn(async () => { throw new Error("subscribe failed"); }) } }),
    });

    await clickPush();

    expect(container.textContent).toContain("Không thể tạo đăng ký Web Push trên trình duyệt này.");
    expect(pushPosts()).toHaveLength(0);
    expectIdle();
  });

  it("treats a non-OK subscription POST as failure and never shows success", async () => {
    installPushApis();
    pushRequest = async () => new Response(JSON.stringify({ error: { message: "unavailable" } }), { status: 503 });

    await clickPush();

    expect(pushPosts()).toHaveLength(1);
    expect(container.textContent).toContain("Không thể lưu đăng ký Web Push. Hãy thử lại.");
    expect(container.textContent).not.toContain("Đã bật Web Push cho thiết bị này.");
    expectIdle();
  });

  it("disables duplicate clicks with an accessible spinner label and succeeds only after an OK POST", async () => {
    let resolveSubscription!: (value: PushSubscriptionDouble) => void;
    const pendingSubscription = new Promise<PushSubscriptionDouble>((resolve) => { resolveSubscription = resolve; });
    const subscribe = vi.fn(() => pendingSubscription);
    installPushApis({ ready: Promise.resolve({ pushManager: { subscribe } }) });

    await act(async () => {
      pushButton().click();
      await Promise.resolve();
    });
    expect(pushButton().disabled).toBe(true);
    expect(pushButton().getAttribute("aria-label")).toBe("Đang bật thông báo");
    expect(pushButton().querySelector(".spin")).not.toBeNull();
    pushButton().click();
    expect(subscribe).toHaveBeenCalledTimes(1);

    await act(async () => resolveSubscription(subscription()));
    await flushPromises();

    expect(pushPosts()).toHaveLength(1);
    expect(pushPosts()[0][1]).toMatchObject({ method: "POST" });
    expect(container.textContent).toContain("Đã bật Web Push cho thiết bị này.");
    expectIdle();
  });
});
