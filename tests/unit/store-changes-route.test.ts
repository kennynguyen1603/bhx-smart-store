import { beforeEach, describe, expect, it, vi } from "vitest";

const { getServerSession, taskAggregate, taskEventCount, notificationAggregate, unreadCount } = vi.hoisted(() => ({
  getServerSession: vi.fn(), taskAggregate: vi.fn(), taskEventCount: vi.fn(), notificationAggregate: vi.fn(), unreadCount: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ prisma: { task: { aggregate: taskAggregate }, taskEvent: { count: taskEventCount }, notification: { aggregate: notificationAggregate, count: unreadCount } } }));
const user = { id: "staff-1", role: "STAFF", storeIds: ["store-1"] };
let tasks: { storeId: string; updatedAt: Date }[];
let notifications: { userId: string; storeId: string; createdAt: Date; readAt: Date | null }[];
const at = (seconds: number) => new Date(Date.UTC(2026, 10, 17, 0, 0, seconds));
const max = (dates: (Date | null)[]) => dates.reduce<Date | null>((latest, date) => date && (!latest || date > latest) ? date : latest, null);
beforeEach(() => {
  vi.clearAllMocks(); getServerSession.mockResolvedValue({ user }); tasks = []; notifications = [];
  taskEventCount.mockResolvedValue(0);
  taskAggregate.mockImplementation(async ({ where }) => ({ _max: { updatedAt: max(tasks.filter(t => t.storeId === where.storeId).map(t => t.updatedAt)) } }));
  notificationAggregate.mockImplementation(async ({ where }) => {
    const rows = notifications.filter(n => n.userId === where.userId && n.storeId === where.storeId);
    return { _max: { createdAt: max(rows.map(n => n.createdAt)), readAt: max(rows.map(n => n.readAt)) } };
  });
  unreadCount.mockImplementation(async ({ where }) => notifications.filter(n => n.userId === where.userId && n.storeId === where.storeId && n.readAt === null).length);
});
async function get(query = "?storeId=store-1") {
  const { GET } = await import("@/app/api/store-changes/route");
  return GET(new Request(`http://localhost/api/store-changes${query}`));
}
async function snapshot() { return (await get()).json(); }
describe("store change snapshot", () => {
  it("uses only indexed task/notification aggregates and a current-user unread count", async () => {
    expect(await snapshot()).toMatchObject({ token: expect.any(String), taskUpdatedAt: null, notificationUpdatedAt: null, unreadCount: 0 });
    expect(taskAggregate).toHaveBeenCalledExactlyOnceWith({ where: { storeId: "store-1" }, _max: { updatedAt: true } });
    expect(taskEventCount).toHaveBeenCalledExactlyOnceWith({ where: { task: { storeId: "store-1" } } });
    expect(notificationAggregate).toHaveBeenCalledExactlyOnceWith({ where: { userId: "staff-1", storeId: "store-1" }, _max: { createdAt: true, readAt: true } });
    expect(unreadCount).toHaveBeenCalledExactlyOnceWith({ where: { userId: "staff-1", storeId: "store-1", readAt: null } });
  });
  it("changes on an additional committed task event even when max updatedAt stays unchanged", async () => {
    tasks = [{ storeId: "store-1", updatedAt: at(30) }];
    taskEventCount.mockResolvedValue(1);
    const before = await snapshot();
    taskEventCount.mockResolvedValue(2);
    const after = await snapshot();
    expect(after.taskUpdatedAt).toBe(before.taskUpdatedAt);
    expect(after.token).not.toBe(before.token);
  });
  it("changes for task create, start, and complete, and is deterministic between writes", async () => {
    let previous = await snapshot();
    for (const second of [1, 2, 3]) {
      tasks = [{ storeId: "store-1", updatedAt: at(second) }];
      const next = await snapshot(); expect(next.token).not.toBe(previous.token); expect(next.taskUpdatedAt).toBe(at(second).toISOString());
      expect(await snapshot()).toEqual(next); previous = next;
    }
  });
  it("covers both notification timestamps and unread count even when latest timestamp is unchanged", async () => {
    const baseline = await snapshot();
    notifications.push({ userId: user.id, storeId: "store-1", createdAt: at(10), readAt: null });
    const created = await snapshot(); expect(created.token).not.toBe(baseline.token); expect(created.unreadCount).toBe(1);
    notifications[0].readAt = at(20);
    const read = await snapshot(); expect(read.token).not.toBe(created.token); expect(read.notificationUpdatedAt).toBe(at(20).toISOString());
    notifications.push({ userId: user.id, storeId: "store-1", createdAt: at(1), readAt: null });
    const countChanged = await snapshot(); expect(countChanged.notificationUpdatedAt).toBe(read.notificationUpdatedAt); expect(countChanged.token).not.toBe(read.token);
    // createdAt remains part of the token even when an existing readAt is later.
    notifications.push({ userId: user.id, storeId: "store-1", createdAt: at(15), readAt: at(16) });
    expect((await snapshot()).token).not.toBe(countChanged.token);
  });
  it("ignores unrelated stores and other users' notifications", async () => {
    const initial = await snapshot(); tasks.push({ storeId: "store-2", updatedAt: at(30) });
    notifications.push({ userId: "someone-else", storeId: "store-1", createdAt: at(40), readAt: null }, { userId: user.id, storeId: "store-2", createdAt: at(50), readAt: null });
    expect(await snapshot()).toEqual(initial);
  });
  it.each(["STAFF", "MANAGER"])("rejects unauthorized %s stores before querying", async (role) => {
    getServerSession.mockResolvedValue({ user: { ...user, role } }); expect((await get("?storeId=store-2")).status).toBe(403); expect(taskAggregate).not.toHaveBeenCalled();
  });
  it("requires authentication and an explicit store", async () => {
    expect((await get("")).status).toBe(400); getServerSession.mockResolvedValue(null); expect((await get()).status).toBe(401); expect(taskAggregate).not.toHaveBeenCalled();
  });
});
