// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { StaffApp } from "@/components/staff-app";
import { setupDevicePush } from "@/lib/push-client";

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/components/barcode-scanner", () => ({ BarcodeScanner: () => null }));
vi.mock("@/components/logo", () => ({ Logo: () => null }));
vi.mock("@/components/esl-scanner-modal", () => ({
  EslScannerModal: ({ onSelectTask }: { onSelectTask(task: unknown): void }) => {
    const task = {
      id: "task-from-esl", type: "RESTOCK", status: "OPEN", priority: "HIGH", title: "Bổ sung từ ESL", note: "Chỉ xem",
      createdAt: "2026-11-16T00:00:00.000Z", completedAt: null, assignee: { id: "staff-2", name: "Nhân viên khác" },
      product: { id: "product-1", name: "Sữa tươi", emoji: "🥛", basePriceVnd: 17_000 },
      shelf: { id: "shelf-1", code: "K-01", label: "Kệ sữa", esls: [{ code: "ESL-01" }] }, lot: null,
      inventory: { id: "inventory-1", onShelf: 2, backroom: 10, capacity: 12, lowThreshold: 3, version: 4, product: { id: "product-1", name: "Sữa tươi", emoji: "🥛" }, shelf: { id: "shelf-1", code: "K-01", label: "Kệ sữa" } },
    };
    return <div><button onClick={() => onSelectTask(task)}>Tự chọn một nhiệm vụ</button><button onClick={() => onSelectTask(task)}>Chọn trong nhiều nhiệm vụ</button></div>;
  },
}));
vi.mock("@/lib/offline", () => ({
  cacheStaffPayload: vi.fn(async () => undefined), enqueueMutation: vi.fn(async () => undefined),
  flushOfflineMutations: vi.fn(async () => ({ remaining: 0, conflicts: [] })),
  getCachedStaffPayload: vi.fn(async () => null), offlineQueueCount: vi.fn(async () => 0),
}));

const user = { id: "staff-1", name: "Nhân viên Demo", email: "staff@demo.bhx", role: "STAFF", storeIds: ["store-1"], defaultStoreId: "store-1" } as Session["user"];
const notifications = [
  { id: "notification-1", type: "TASK_CREATED", title: "Cần bổ sung sữa", body: "Kệ sữa chỉ còn 2 hộp.", readAt: null, createdAt: "2026-11-16T01:30:00.000Z", taskId: "task-1" },
  { id: "notification-2", type: "TASK_CREATED", title: "Kiểm tra hạn sử dụng", body: "Lô sữa sắp hết hạn.", readAt: "2026-11-16T02:00:00.000Z", createdAt: "2026-11-16T01:00:00.000Z", taskId: null },
];
const staffPayload = {
  stores: [{ id: "store-1", code: "BHX-01", name: "BHX Demo", address: "123 Demo" }], selectedStoreId: "store-1",
  tasks: [], inventories: [], notifications, recentEvents: [],
  metrics: { openTasks: 0, highPriority: 0, lowShelves: 0, fefoTasks: 0, completionRate: 100 },
};
const subscription = { toJSON: () => ({ endpoint: "https://push.example/subscription", keys: { auth: "auth", p256dh: "key" } }) };
let container: HTMLDivElement;
let root: Root;
let fetchMock: Mock<typeof fetch>;
let pushRequest: (init?: RequestInit) => Promise<Response>;
let readRequest: () => Promise<Response>;
let payload: typeof staffPayload;
let workerDescriptor: PropertyDescriptor | undefined;

function installPushApis(permission: NotificationPermission = "granted") {
  const requestPermission = vi.fn(async (): Promise<NotificationPermission> => "granted");
  const subscribe = vi.fn(async () => subscription);
  const getSubscription = vi.fn(async (): Promise<typeof subscription | null> => null);
  const registration = {
    active: { scriptURL: "https://store.example/sw.js", state: "activated" } as { scriptURL: string; state: ServiceWorkerState } | null,
    installing: null as (EventTarget & { state: ServiceWorkerState }) | null,
    waiting: null,
    pushManager: { subscribe, getSubscription },
  };
  const worker = { getRegistration: vi.fn(async (): Promise<typeof registration | undefined> => registration), register: vi.fn(async () => registration) };
  vi.stubGlobal("Notification", { permission, requestPermission });
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: worker });
  return { requestPermission, subscribe, getSubscription, worker };
}
function button(text: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(text));
  expect(found, `button: ${text}`).toBeDefined(); return found!;
}
function bell() { return container.querySelector<HTMLButtonElement>(".notification-button")!; }
function pushCalls(method: string) { return fetchMock.mock.calls.filter(([input, init]) => String(input) === "/api/push/subscriptions" && (init?.method || "GET") === method); }
async function click(target: HTMLElement) { await act(async () => target.click()); }
async function openCenter() { await click(bell()); }
async function enable() { await openCenter(); await click(button("Bật thông báo trên thiết bị")); }
async function render(asUser = user) {
  await act(async () => { root.render(createElement(StaffApp, { user: asUser })); await new Promise((done) => setTimeout(done, 10)); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  workerDescriptor = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
  payload = structuredClone(staffPayload);
  pushRequest = async (init) => init?.method === "POST" ? new Response(null, { status: 201 }) : Response.json({ configured: true, publicKey: "AQIDBA" });
  readRequest = async () => Response.json({ updated: 1, readAt: "2026-11-16T03:00:00.000Z" });
  fetchMock = vi.fn(async (input, init) => {
    const url = String(input);
    if (url.startsWith("/api/staff/tasks")) return Response.json(payload);
    if (url === "/api/push/subscriptions") return pushRequest(init);
    if (url === "/api/staff/notifications") return readRequest();
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  if (workerDescriptor) Object.defineProperty(navigator, "serviceWorker", workerDescriptor);
  else delete (navigator as Navigator & { serviceWorker?: ServiceWorkerContainer }).serviceWorker;
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("Staff notification center", () => {
  it("opens the bell dialog without push side effects or marking anything read", async () => {
    const apis = installPushApis("default"); await render(); await openCenter();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull(); expect(dialog?.textContent).toContain("Cần bổ sung sữa");
    expect(dialog?.textContent).toContain("Kệ sữa chỉ còn 2 hộp."); expect(dialog?.textContent).toContain("Kiểm tra hạn sử dụng");
    expect(dialog?.querySelector("time")?.dateTime).toBe("2026-11-16T01:30:00.000Z");
    expect(dialog?.querySelector("time")?.textContent).toMatch(/\d{2}:\d{2}/); expect(bell().textContent).toBe("1");
    expect(apis.requestPermission).not.toHaveBeenCalled(); expect(apis.worker.getRegistration).not.toHaveBeenCalled();
    expect(apis.worker.register).not.toHaveBeenCalled(); expect(pushCalls("GET")).toHaveLength(0); expect(pushCalls("POST")).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/staff/notifications")).toBe(false);
  });
  it("shows an empty state and disables mark-all when there are no notifications", async () => {
    payload.notifications = []; await render(); await openCenter();
    expect(document.body.textContent).toContain("Chưa có thông báo"); expect(bell().textContent).toBe("");
    expect(button("Đánh dấu tất cả đã đọc").disabled).toBe(true);
  });
  it("marks unread rows optimistically once and retains the read badge after persistence", async () => {
    let finish!: (response: Response) => void;
    readRequest = () => new Promise((resolve) => { finish = resolve; }); await render(); await openCenter();
    await act(async () => { const action = button("Đánh dấu tất cả đã đọc"); action.click(); action.click(); });
    expect(bell().textContent).toBe(""); expect(button("Đánh dấu tất cả đã đọc").disabled).toBe(true);
    const calls = fetchMock.mock.calls.filter(([url]) => String(url) === "/api/staff/notifications");
    expect(calls).toHaveLength(1); expect(calls[0][1]?.method).toBe("PATCH"); expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ storeId: "store-1" });
    await act(async () => finish(Response.json({ updated: 1, readAt: "2026-11-16T03:00:00.000Z" })));
    expect(bell().textContent).toBe(""); expect(document.querySelector(".toast.error")).toBeNull();
  });
  it.each(["http", "network"])("restores unread state with inline retry after %s failure", async (failure) => {
    readRequest = async () => { if (failure === "network") throw new TypeError("Failed to fetch"); return new Response(null, { status: 503 }); };
    await render(); await openCenter(); await click(button("Đánh dấu tất cả đã đọc"));
    expect(bell().textContent).toBe("1"); expect(button("Đánh dấu tất cả đã đọc").disabled).toBe(false);
    expect(document.querySelector('.notification-read-action [role="status"]')?.textContent).toContain("Không thể đánh dấu đã đọc");
    expect(document.querySelector(".toast.error")).toBeNull();
    readRequest = async () => Response.json({ updated: 1, readAt: "2026-11-16T03:00:00.000Z" });
    await click(button("Đánh dấu tất cả đã đọc")); expect(bell().textContent).toBe("");
  });
  it("preserves optimistic reads across refresh and restores only prior rows on failure", async () => {
    let finish!: (response: Response) => void;
    readRequest = () => new Promise((resolve) => { finish = resolve; });
    await render(); await openCenter(); await click(button("Đánh dấu tất cả đã đọc"));
    payload.notifications.push({ ...notifications[0], id: "notification-new", title: "Thông báo mới" });
    const reload = container.querySelector<HTMLButtonElement>('[aria-label="Tải lại"]')!;
    await click(reload);
    expect(bell().textContent).toBe("1");
    await act(async () => finish(new Response(null, { status: 503 })));
    expect(bell().textContent).toBe("2"); expect(document.body.textContent).toContain("Thông báo mới");
  });
  it("does not restore one store's notifications into another store after a failed read", async () => {
    let finish!: (response: Response) => void;
    readRequest = () => new Promise((resolve) => { finish = resolve; });
    payload.stores.push({ id: "store-2", code: "BHX-02", name: "BHX Hai", address: "456 Demo" });
    await render(); await openCenter(); await click(button("Đánh dấu tất cả đã đọc"));
    payload = { ...payload, selectedStoreId: "store-2", notifications: [{ ...notifications[0], id: "other-store", title: "Thông báo cửa hàng hai" }] };
    await act(async () => {
      const select = container.querySelector<HTMLSelectElement>(".store-selector select")!;
      select.value = "store-2"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    await act(async () => finish(new Response(null, { status: 503 })));
    await openCenter();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Thông báo cửa hàng hai");
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Cần bổ sung sữa");
  });
});

describe("deliberate device push setup", () => {
  it.each([
    ["unsupported", "Trình duyệt này không hỗ trợ Web Push."], ["denied", "Bạn đã từ chối quyền nhận thông báo."],
    ["worker", "Không thể khởi tạo thông báo trên thiết bị. Hãy thử lại."],
    ["unconfigured", "Thông báo trên thiết bị chưa được cấu hình. Bạn vẫn có thể xem thông báo tại đây."],
    ["persistence", "Không thể lưu đăng ký Web Push. Hãy thử lại."],
    ["readiness", "Không thể kiểm tra thông báo trên thiết bị. Hãy thử lại."],
    ["subscription", "Không thể tạo đăng ký Web Push trên trình duyệt này."],
  ])("renders %s inline without an error toast", async (state, message) => {
    const apis = installPushApis(state === "denied" ? "denied" : "default");
    if (state === "unsupported") vi.stubGlobal("Notification", undefined);
    if (state === "worker") apis.worker.getRegistration.mockRejectedValueOnce(new Error("raw worker error"));
    if (state === "unconfigured") pushRequest = async () => Response.json({ configured: false, publicKey: null });
    if (state === "persistence") pushRequest = async (init) => init?.method === "POST" ? new Response(null, { status: 503 }) : Response.json({ configured: true, publicKey: "AQIDBA" });
    if (state === "readiness") pushRequest = async () => { throw new TypeError("Failed to fetch"); };
    if (state === "subscription") apis.subscribe.mockRejectedValueOnce(new Error("raw subscribe error"));
    await render(); await enable();
    expect(document.querySelector('[role="dialog"] [role="status"]')?.textContent).toContain(message);
    expect(document.querySelector(".toast.error")).toBeNull(); expect(document.body.textContent).not.toContain("raw worker error");
    expect(button("Bật thông báo trên thiết bị").disabled).toBe(false);
    if (["unsupported", "denied", "worker", "unconfigured", "readiness"].includes(state)) {
      expect(apis.requestPermission).not.toHaveBeenCalled(); expect(apis.subscribe).not.toHaveBeenCalled(); expect(pushCalls("POST")).toHaveLength(0);
    }
  });
  it("checks backend readiness and registers before requesting permission, then converts the public key", async () => {
    const apis = installPushApis("default"); await render(); await enable();
    expect(pushCalls("GET")).toHaveLength(1); expect(apis.requestPermission).toHaveBeenCalledOnce();
    expect(fetchMock.mock.invocationCallOrder[1]).toBeLessThan(apis.worker.getRegistration.mock.invocationCallOrder[0]);
    expect(apis.worker.getRegistration.mock.invocationCallOrder[0]).toBeLessThan(apis.requestPermission.mock.invocationCallOrder[0]);
    expect(apis.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3, 4]) });
    expect(JSON.parse(String(pushCalls("POST")[0][1]?.body))).toEqual(subscription.toJSON());
    expect(document.body.textContent).toContain("Đã bật Web Push cho thiết bị này.");
  });
  it.each(["denied", "default"] as const)("does not subscribe when the permission prompt returns %s", async (permission) => {
    const apis = installPushApis("default"); apis.requestPermission.mockResolvedValueOnce(permission);
    await render(); await enable(); expect(apis.subscribe).not.toHaveBeenCalled(); expect(pushCalls("POST")).toHaveLength(0);
    expect(document.querySelector('[role="dialog"] [role="status"]')?.textContent).toContain(permission === "denied" ? "Bạn đã từ chối" : "Bạn chưa cho phép");
    expect(document.querySelector(".toast.error")).toBeNull();
  });
  it("reuses an existing subscription and persists it once", async () => {
    const apis = installPushApis(); apis.getSubscription.mockResolvedValueOnce(subscription);
    await render(); await enable(); expect(apis.subscribe).not.toHaveBeenCalled(); expect(pushCalls("POST")).toHaveLength(1);
    expect(document.body.textContent).toContain("Đã bật Web Push cho thiết bị này.");
  });
  it("guards same-tick enable clicks and waits for POST success", async () => {
    let finish!: (response: Response) => void;
    pushRequest = async (init) => init?.method === "POST" ? new Promise((resolve) => { finish = resolve; }) : Response.json({ configured: true, publicKey: "AQIDBA" });
    const apis = installPushApis(); await render(); await openCenter();
    await act(async () => { const action = button("Bật thông báo trên thiết bị"); action.click(); action.click(); });
    expect(apis.subscribe).toHaveBeenCalledOnce(); expect(pushCalls("POST")).toHaveLength(1);
    expect(button("Đang bật thông báo").disabled).toBe(true); expect(document.body.textContent).not.toContain("Đã bật Web Push");
    await act(async () => finish(new Response(null, { status: 201 })));
    expect(document.body.textContent).toContain("Đã bật Web Push cho thiết bị này.");
  });
  it("deduplicates helper calls independently of React and releases the guard for retry", async () => {
    const apis = installPushApis();
    const results = await Promise.all([setupDevicePush(), setupDevicePush()]);
    expect(results).toEqual([{ status: "enabled" }, { status: "enabled" }]); expect(apis.subscribe).toHaveBeenCalledOnce(); expect(pushCalls("POST")).toHaveLength(1);
    expect(await setupDevicePush()).toEqual({ status: "enabled" }); expect(pushCalls("POST")).toHaveLength(2);
  });
  it("returns worker-unavailable for a blocked browser getter without leaking its exception", async () => {
    installPushApis();
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, get() { throw new DOMException("blocked raw error", "SecurityError"); } });
    expect(await setupDevicePush()).toEqual({ status: "worker-unavailable", message: "Không thể khởi tạo thông báo trên thiết bị. Hãy thử lại." });
    expect(pushCalls("POST")).toHaveLength(0);
  });
  it("waits for a newly registered worker to activate before subscribing", async () => {
    const apis = installPushApis();
    const installing = Object.assign(new EventTarget(), { state: "installing" as ServiceWorkerState });
    apis.worker.getRegistration.mockResolvedValueOnce(undefined);
    apis.worker.register.mockResolvedValueOnce({ active: null, installing, waiting: null, pushManager: { subscribe: apis.subscribe, getSubscription: apis.getSubscription } });
    const pending = setupDevicePush();
    await vi.waitFor(() => expect(apis.worker.register).toHaveBeenCalledOnce());
    const callsBeforeActivation = apis.subscribe.mock.calls.length;
    installing.state = "activated"; installing.dispatchEvent(new Event("statechange"));
    expect(await pending).toEqual({ status: "enabled" });
    expect(callsBeforeActivation).toBe(0); expect(apis.subscribe).toHaveBeenCalledOnce();
  });
  it.each(["redundant", "installing"] as const)("returns worker-unavailable when activation stays %s", async (state) => {
    vi.useFakeTimers(); const apis = installPushApis("default");
    const installing = Object.assign(new EventTarget(), { state: state as ServiceWorkerState });
    apis.worker.getRegistration.mockResolvedValueOnce(undefined);
    apis.worker.register.mockResolvedValueOnce({ active: null, installing, waiting: null, pushManager: { subscribe: apis.subscribe, getSubscription: apis.getSubscription } });
    const pending = setupDevicePush(); await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toMatchObject({ status: "worker-unavailable" });
    expect(apis.requestPermission).not.toHaveBeenCalled(); expect(apis.subscribe).not.toHaveBeenCalled();
  });
  it("classifies a rejected permission prompt as setup failure", async () => {
    const apis = installPushApis("default"); apis.requestPermission.mockRejectedValueOnce(new Error("raw permission error"));
    expect(await setupDevicePush()).toEqual({ status: "failed", message: "Không thể bật thông báo trên thiết bị. Hãy thử lại." });
    expect(apis.subscribe).not.toHaveBeenCalled();
  });
  it("bounds a stalled worker without requesting permission or subscribing", async () => {
    vi.useFakeTimers(); const apis = installPushApis("default");
    apis.worker.getRegistration.mockImplementationOnce(() => new Promise(() => {}));
    const pending = setupDevicePush(); await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toMatchObject({ status: "worker-unavailable" }); expect(apis.requestPermission).not.toHaveBeenCalled();
    expect(apis.subscribe).not.toHaveBeenCalled();
  });
  it("bounds a stalled subscription and ignores its late result", async () => {
    vi.useFakeTimers(); const apis = installPushApis(); let finish!: (value: typeof subscription) => void;
    apis.subscribe.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = setupDevicePush(); await vi.advanceTimersByTimeAsync(8_000);
    expect(await pending).toEqual({ status: "failed", message: "Quá thời gian tạo đăng ký Web Push. Hãy thử lại." });
    finish(subscription); await Promise.resolve(); expect(pushCalls("POST")).toHaveLength(0);
  });
  it("aborts a stalled POST, ignores late success, and allows retry", async () => {
    vi.useFakeTimers(); installPushApis(); let finish!: (response: Response) => void;
    pushRequest = async (init) => init?.method === "POST" ? new Promise((resolve) => { finish = resolve; }) : Response.json({ configured: true, publicKey: "AQIDBA" });
    const pending = setupDevicePush(); await vi.advanceTimersByTimeAsync(8_000);
    expect(await pending).toEqual({ status: "failed", message: "Quá thời gian lưu đăng ký Web Push. Hãy thử lại." });
    expect(pushCalls("POST")[0][1]?.signal?.aborted).toBe(true);
    finish(new Response(null, { status: 201 })); await Promise.resolve();
    pushRequest = async (init) => init?.method === "POST" ? new Response(null, { status: 201 }) : Response.json({ configured: true, publicKey: "AQIDBA" });
    expect(await setupDevicePush()).toEqual({ status: "enabled" });
  });
});

describe.each(["Tự chọn một nhiệm vụ", "Chọn trong nhiều nhiệm vụ"])("Manager ESL read-only selection: %s", (selection) => {
  it("opens task details without starting or exposing mutation controls", async () => {
    await render({ ...user, id: "manager-1", role: "MANAGER" });
    await click(button("Quét ESL")); await click(button(selection));
    expect(container.textContent).toContain("Bổ sung từ ESL"); expect(container.textContent).toContain("Chế độ chỉ xem");
    for (const text of ["Xác minh", "Số lượng bổ sung", "Xác nhận bổ sung"]) expect(container.textContent).not.toContain(text);
    expect(fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => /\/(start|restock|fefo)$/.test(url))).toHaveLength(0);
    expect([...container.querySelectorAll(".side-nav button")].find((item) => item.textContent?.includes("Nhiệm vụ"))?.classList.contains("active")).toBe(true);
  });
});
