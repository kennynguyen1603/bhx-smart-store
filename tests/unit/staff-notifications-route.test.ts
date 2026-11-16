import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getServerSession, updateMany, deleteMany, findFirst } = vi.hoisted(() => ({ getServerSession: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), findFirst: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ prisma: { notification: { updateMany }, pushSubscription: { deleteMany, findFirst } } }));
const user = { id: "staff-1", role: "STAFF", storeIds: ["store-1"], defaultStoreId: "store-1" };
beforeEach(() => { vi.clearAllMocks(); getServerSession.mockResolvedValue({ user }); updateMany.mockResolvedValue({ count: 2 }); });
afterEach(() => vi.unstubAllEnvs());

async function patch(body: unknown) {
  const { PATCH } = await import("@/app/api/staff/notifications/route");
  return PATCH(new Request("http://localhost/api/staff/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}
describe("PATCH staff notifications", () => {
  it.each(["STAFF", "MANAGER", "ADMIN"])("scopes %s read updates to the authenticated user, selected store, and unread rows", async (role) => {
    getServerSession.mockResolvedValue({ user: { ...user, role } });
    const response = await patch({ storeId: "store-1", userId: "other-user", ids: ["shown-1", "shown-2"] });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toEqual({ updated: 2, readAt: expect.any(String) });
    expect(new Date(result.readAt).toISOString()).toBe(result.readAt);
    expect(updateMany).toHaveBeenCalledExactlyOnceWith({ where: { id: { in: ["shown-1", "shown-2"] }, userId: "staff-1", storeId: "store-1", readAt: null }, data: { readAt: new Date(result.readAt) } });
  });
  it("rejects unauthenticated requests before mutation", async () => {
    getServerSession.mockResolvedValue(null);
    expect((await patch({ storeId: "store-1" })).status).toBe(401); expect(updateMany).not.toHaveBeenCalled();
  });
  it.each(["STAFF", "MANAGER"])("denies %s access to another store before mutation", async (role) => {
    getServerSession.mockResolvedValue({ user: { ...user, role } });
    expect((await patch({ storeId: "store-2", ids: ["shown-1"] })).status).toBe(403); expect(updateMany).not.toHaveBeenCalled();
  });
  it.each([{}, { storeId: "" }, { storeId: 12 }, null, { storeId: "store-1" }, { storeId: "store-1", ids: "all" }, { storeId: "store-1", ids: [""] }, { storeId: "store-1", ids: [12] }])("rejects invalid input %j without mutation", async (body) => {
    expect((await patch(body)).status).toBe(400); expect(updateMany).not.toHaveBeenCalled();
  });
  it("returns zero when every notification is already read", async () => {
    updateMany.mockResolvedValue({ count: 0 }); const response = await patch({ storeId: "store-1", ids: ["read-1"] });
    expect(await response.json()).toEqual({ updated: 0, readAt: expect.any(String) });
  });
});

describe("GET push subscription readiness", () => {
  it("verifies the endpoint only for the authenticated user and prevents caching across accounts", async () => {
    const { GET } = await import("@/app/api/push/subscriptions/route");
    findFirst.mockResolvedValueOnce({ id: "registered" }).mockResolvedValueOnce(null);
    const request = new Request("http://localhost/api/push/subscriptions?endpoint=https%3A%2F%2Fpush.example%2Fone&userId=someone-else");
    const first = await GET(request);
    expect(await first.json()).toMatchObject({ registered: true });
    expect(first.headers.get("Cache-Control")).toBe("private, no-store");
    expect(findFirst).toHaveBeenLastCalledWith({ where: { endpoint: "https://push.example/one", userId: "staff-1" }, select: { id: true } });
    getServerSession.mockResolvedValue({ user: { ...user, id: "staff-2" } });
    expect(await (await GET(request)).json()).toMatchObject({ registered: false });
    expect(findFirst).toHaveBeenLastCalledWith({ where: { endpoint: "https://push.example/one", userId: "staff-2" }, select: { id: true } });
  });
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-key"); vi.stubEnv("VAPID_PRIVATE_KEY", "private-secret"); vi.stubEnv("VAPID_SUBJECT", "mailto:private@example.com");
  });
  it("requires authentication", async () => {
    getServerSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/push/subscriptions/route");
    expect((await GET()).status).toBe(401);
  });
  it("returns only configured and the public key", async () => {
    const { GET } = await import("@/app/api/push/subscriptions/route");
    const response = await GET(); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: true, publicKey: "public-key" });
  });
  it.each(["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"])("reports unconfigured without %s", async (key) => {
    vi.stubEnv(key, ""); const { GET } = await import("@/app/api/push/subscriptions/route");
    expect(await (await GET()).json()).toEqual({ configured: false, publicKey: key === "NEXT_PUBLIC_VAPID_PUBLIC_KEY" ? null : "public-key" });
  });
});

describe("DELETE push subscription", () => {
  async function remove(body: unknown) {
    const { DELETE } = await import("@/app/api/push/subscriptions/route");
    return DELETE(new Request("http://localhost/api/push/subscriptions", { method: "DELETE", body: JSON.stringify(body) }));
  }
  it.each([{}, { endpoint: "invalid" }, { endpoint: 12 }, null])("rejects invalid endpoint %j before deleting", async body => {
    expect((await remove(body)).status).toBe(400); expect(deleteMany).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    getServerSession.mockResolvedValue(null); expect((await remove({ endpoint: "https://push.example/one" })).status).toBe(401); expect(deleteMany).not.toHaveBeenCalled();
  });
  it.each([0, 1])("scopes deletion to the current user with %i matching rows", async count => {
    deleteMany.mockResolvedValue({ count });
    expect((await remove({ endpoint: "https://push.example/one", userId: "someone-else" })).status).toBe(204);
    expect(deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { endpoint: "https://push.example/one", userId: "staff-1" } });
  });
});
