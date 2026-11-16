import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUT } from "@/app/api/admin/[resource]/[id]/route";

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn().mockResolvedValue([]),
  session: vi.fn(), shelf: { findUniqueOrThrow: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  store: { findUniqueOrThrow: vi.fn() }, zone: { findFirst: vi.fn() },
}));
vi.mock("next-auth", () => ({ getServerSession: db.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: (work: (tx: unknown) => unknown) => work(db) } }));

const shelf = { id: "a", storeId: "store", zoneId: null, code: "A-01", label: "Kệ A", x: 1, y: 1, width: 2, height: 2 };
const neighbor = { ...shelf, id: "b", code: "B-01", x: 4, y: 2, width: 2, height: 3 };
beforeEach(() => {
  vi.clearAllMocks();
  db.session.mockResolvedValue({ user: { id: "admin", role: "ADMIN", storeIds: [] } });
  db.shelf.findUniqueOrThrow.mockResolvedValue(shelf);
  db.shelf.findMany.mockResolvedValue([shelf, neighbor]);
  db.store.findUniqueOrThrow.mockResolvedValue({ id: "store", mapWidth: 8, mapHeight: 6 });
  db.zone.findFirst.mockResolvedValue(null);
  db.shelf.update.mockImplementation(async ({ data }) => ({ ...shelf, ...data }));
});
async function put(body: unknown) {
  return PUT(new Request("http://localhost/api/admin/shelves/a", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ resource: "shelves", id: "a" }) });
}

describe("generic shelves PUT placement validation", () => {
  it.each([{ x: -1 }, { y: -1 }, { x: 7 }, { y: 5 }, { width: 8 }, { height: 6 }])("rejects merged out-of-bounds geometry %j before mutation", async (body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "SHELF_OUT_OF_BOUNDS", message: expect.any(String) } });
    expect(db.shelf.update).not.toHaveBeenCalled();
  });
  it.each([{ x: 3 }, { y: 2, width: 4 }, { width: 4, height: 3 }])("rejects merged occupied geometry %j before mutation", async (body) => {
    const response = await put(body);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "SHELF_POSITION_OCCUPIED", message: expect.any(String) } });
    expect(db.shelf.update).not.toHaveBeenCalled();
  });
  it.each([{ x: 2, y: 4 }, { x: 2 }, { x: 1, y: 1 }, { label: "Kệ mới", zoneId: null }])("permits valid partial, touching, self-overlapping and unchanged updates %j", async (body) => {
    const response = await put(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ...shelf, ...body });
    expect(db.shelf.update).toHaveBeenCalledExactlyOnceWith({ where: { id: "a" }, data: body });
    expect(db.store.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "store" } }));
    expect(db.shelf.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ storeId: "store" }) }));
  });
  it("retains assigned Manager access", async () => {
    db.session.mockResolvedValue({ user: { id: "manager", role: "MANAGER", storeIds: ["store"] } });
    expect((await put({ x: 2, y: 4 })).status).toBe(200);
  });
  it.each(["MANAGER", "STAFF", "anonymous"])("denies unassigned %s before writing", async (role) => {
    db.session.mockResolvedValue(role === "anonymous" ? null : { user: { id: "user", role, storeIds: [] } });
    expect((await put({ x: 2, y: 4 })).status).toBe(role === "anonymous" ? 401 : 403);
    expect(db.shelf.update).not.toHaveBeenCalled();
  });
  it("retains the same-store zone reference guard", async () => {
    const response = await put({ zoneId: "foreign" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "CROSS_STORE_REFERENCE" } });
    expect(db.shelf.update).not.toHaveBeenCalled();
  });
});
