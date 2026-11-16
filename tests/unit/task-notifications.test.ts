import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ subscriptions: vi.fn(), users: vi.fn(), remove: vi.fn(), deliver: vi.fn(), configure: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { pushSubscription: { findMany: mocks.subscriptions, delete: mocks.remove }, userStore: { findMany: mocks.users } } }));
vi.mock("web-push", () => ({ setVapidDetails: mocks.configure, sendNotification: mocks.deliver }));
import * as push from "@/lib/push";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "test-public");
  vi.stubEnv("VAPID_PRIVATE_KEY", "test-private");
  vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.com");
  mocks.remove.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());
describe("targeted task push delivery", () => {
  it("bounds a never-settling provider and supplies an explicit provider timeout", async () => {
    vi.useFakeTimers();
    mocks.subscriptions.mockResolvedValue([{ id: "one", endpoint: "https://push.test/one", p256dh: "key", auth: "auth" }]);
    mocks.deliver.mockImplementation(() => new Promise(() => {}));
    let result: unknown;
    void push.sendPushToUsers(["staff-1"], { title: "Task", body: "New" }).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(result).toEqual({ sent: 0, skipped: true });
    expect(mocks.deliver.mock.calls[0][2]).toMatchObject({ timeout: 3_000 });
  });
  it("targets only active recipient subscriptions and counts successful devices", async () => {
    mocks.subscriptions.mockResolvedValue([{ id: "one", endpoint: "https://push.test/one", p256dh: "key", auth: "auth" }, { id: "two", endpoint: "https://push.test/two", p256dh: "key", auth: "auth" }]);
    mocks.deliver.mockResolvedValueOnce(undefined).mockRejectedValueOnce({ statusCode: 410 });
    expect(await push.sendPushToUsers(["staff-1", "staff-1"], { title: "Task", body: "New", url: "/staff?task=one" })).toEqual({ sent: 1, skipped: false });
    expect(mocks.subscriptions).toHaveBeenCalledWith({ where: { userId: { in: ["staff-1"] }, user: { active: true } } });
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: "two" } });
  });
  it("never rejects when subscription lookup fails", async () => {
    mocks.subscriptions.mockRejectedValueOnce(new Error("lookup down"));
    expect(await push.sendPushToUsers(["staff-1"], { title: "Task", body: "New" })).toEqual({ sent: 0, skipped: true });
  });
  it("skips safely when push is not configured", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(await push.sendPushToUsers(["staff-1"], { title: "Task", body: "New" })).toEqual({ sent: 0, skipped: true });
    expect(mocks.subscriptions).not.toHaveBeenCalled();
  });
  it("preserves store delivery through active store members", async () => {
    mocks.users.mockResolvedValueOnce([{ userId: "staff-1" }]);
    mocks.subscriptions.mockResolvedValueOnce([]);
    expect(await push.sendPushToStore("store-1", { title: "Task", body: "New" })).toEqual({ sent: 0, skipped: false });
    expect(mocks.subscriptions).toHaveBeenCalledWith({ where: { userId: { in: ["staff-1"] }, user: { active: true } } });
  });
});
