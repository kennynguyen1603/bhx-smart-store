import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const delivery = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: async () => auth.session }));
vi.mock("@/lib/push", () => ({ sendPushToUsers: delivery.send }));
const run = randomUUID();
let storeId: string, foreignStoreId: string, productId: string, otherProductId: string, shelfId: string, foreignShelfId: string, supplierId: string;
let users: { id: string; role: "STAFF" | "MANAGER" | "ADMIN"; active: boolean }[];
async function post(patch: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/admin/tasks/route");
  return POST(new Request("http://localhost/api/admin/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storeId, productId, shelfId, type: "RESTOCK", priority: "HIGH", ...patch }) }));
}
async function lot(patch: Record<string, unknown> = {}) {
  return prisma.lot.create({ data: { storeId, productId, supplierId, batchCode: randomUUID(), origin: "VN", receivedAt: new Date(), expiryDate: new Date("2030-01-03"), quantity: 4, ...patch } });
}
async function unchanged() {
  expect(await prisma.task.count({ where: { storeId } })).toBe(0);
  expect(await prisma.notification.count({ where: { storeId } })).toBe(0);
  expect(delivery.send).not.toHaveBeenCalled();
}
beforeAll(async () => {
  const stores = await Promise.all(["home", "foreign"].map((code) => prisma.store.create({ data: { code: `AT-${code}-${run}`, name: code, address: "Test" } })));
  [storeId, foreignStoreId] = stores.map((s) => s.id);
  const products = await Promise.all(["main", "other"].map((sku) => prisma.product.create({ data: { sku: `AT-${sku}-${run}`, barcode: `AT-${sku}-${run}`, name: sku, searchText: sku, category: "Test", unit: "Cái", basePriceVnd: 1000 } })));
  [productId, otherProductId] = products.map((p) => p.id);
  const shelves = await Promise.all(stores.map((store) => prisma.shelf.create({ data: { storeId: store.id, code: "01", label: "Kệ test", x: 0, y: 0 } })));
  [shelfId, foreignShelfId] = shelves.map((s) => s.id);
  supplierId = (await prisma.supplier.create({ data: { code: `AT-${run}`, name: "Test", country: "VN" } })).id;
  await prisma.inventory.create({ data: { storeId, productId, shelfId, onShelf: 2, backroom: 8, capacity: 10, lowThreshold: 3 } });
  users = await Promise.all((["ADMIN", "MANAGER", "STAFF", "STAFF", "STAFF", "STAFF"] as const).map((role, index) => prisma.user.create({ data: { email: `AT-${index}-${run}@test.local`, name: `User ${index}`, passwordHash: "unused", role, active: index !== 4, userStores: { create: { storeId: index === 5 ? foreignStoreId : storeId } } } })));
});
beforeEach(async () => {
  await prisma.notification.deleteMany({ where: { storeId } });
  await prisma.task.deleteMany({ where: { storeId } });
  await prisma.lot.deleteMany({ where: { storeId: { in: [storeId, foreignStoreId] } } });
  auth.session = { expires: "2099-01-01", user: { id: users[0].id, role: "ADMIN", storeIds: [], defaultStoreId: storeId } };
  delivery.send.mockReset().mockResolvedValue({ sent: 0, skipped: true });
});
afterAll(async () => {
  if (!storeId) return;
  await prisma.store.deleteMany({ where: { id: { in: [storeId, foreignStoreId] } } });
  await prisma.product.deleteMany({ where: { id: { in: [productId, otherProductId] } } });
  await prisma.supplier.delete({ where: { id: supplierId } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
});

describe("Admin task command", () => {
  it.each(["ADMIN", "MANAGER"] as const)("allows an authorized %s and returns display relations with a CREATED event", async (role) => {
    auth.session!.user = { id: users[role === "ADMIN" ? 0 : 1].id, role, storeIds: [storeId], defaultStoreId: storeId };
    const response = await post({ assigneeId: users[2].id, note: "Test note", dueAt: "2030-01-02T10:00:00+07:00" });
    expect(response.status).toBe(201);
    const { task } = await response.json();
    expect(task).toMatchObject({ status: "OPEN", type: "RESTOCK", priority: "HIGH", lotId: null, note: "Test note", dueAt: "2030-01-02T03:00:00.000Z", product: { name: "main" }, shelf: { label: "Kệ test" }, assignee: { name: "User 2" } });
    expect(await prisma.taskEvent.findMany({ where: { taskId: task.id } })).toMatchObject([{ type: "CREATED", actorId: auth.session!.user.id }]);
    expect((await prisma.notification.findMany({ where: { taskId: task.id } })).map((n) => n.userId)).toEqual([users[2].id]);
    expect(delivery.send).toHaveBeenCalledWith([users[2].id], expect.objectContaining({ url: `/staff?storeId=${storeId}&task=${task.id}`, tag: task.id }));
  });
  it.each(["STAFF", "foreign Manager", "anonymous"])("rejects %s without side effects", async (kind) => {
    if (kind === "anonymous") auth.session = null;
    else auth.session!.user = { id: users[2].id, role: kind === "STAFF" ? "STAFF" : "MANAGER", storeIds: kind === "STAFF" ? [storeId] : [foreignStoreId], defaultStoreId: null };
    expect((await post()).status).toBe(kind === "anonymous" ? 401 : 403);
    await unchanged();
  });
  it.each([{ type: "INVALID" }, { priority: "URGENT" }, { storeId: "" }, { productId: "" }, { shelfId: "" }, { dueAt: "invalid" }, { dueAt: null }, { assigneeId: "" }, { note: 123 }])("validates command %j", async (patch) => {
    expect((await post(patch)).status).toBe(400);
    await unchanged();
  });
  it.each(["foreign shelf", "product without inventory", "foreign lot", "wrong product lot", "foreign Staff", "inactive Staff", "Manager assignee", "Admin assignee"])("rejects %s atomically", async (kind) => {
    let patch: Record<string, unknown> = {};
    if (kind === "foreign shelf") patch = { shelfId: foreignShelfId };
    if (kind === "product without inventory") patch = { productId: otherProductId };
    if (kind.includes("lot")) patch = { type: "FEFO", lotId: (await lot(kind === "foreign lot" ? { storeId: foreignStoreId } : { productId: otherProductId })).id };
    if (kind.includes("assignee") || kind.includes("Staff")) patch = { assigneeId: users[kind === "foreign Staff" ? 5 : kind === "inactive Staff" ? 4 : kind === "Manager assignee" ? 1 : 0].id };
    expect((await post(patch)).status).toBe(400);
    await unchanged();
  });
  it.each(["TaskEvent", "Notification"])("rolls back task, event and notification writes when %s insertion fails", async (table) => {
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `fail_task_command_${suffix}`;
    const triggerName = `fail_task_command_trigger_${suffix}`;
    const condition = table === "Notification" ? `NEW."storeId" = '${storeId}'` : `NEW."actorId" = '${users[0].id}'`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled task command failure'; END; $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "${table}" FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION "${functionName}"()`);
    try {
      expect((await post()).status).toBe(500);
      await unchanged();
      expect(await prisma.taskEvent.count({ where: { actorId: users[0].id } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${table}"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
  });
  it("validates a supplied RESTOCK lot but stores no lot", async () => {
    const valid = await lot();
    const response = await post({ lotId: valid.id });
    expect(response.status).toBe(201);
    expect((await response.json()).task.lotId).toBeNull();
  });
  it.each(["FEFO", "QUARANTINE"])("selects earliest positive sellable lot for %s", async (type) => {
    await lot({ expiryDate: new Date("2029-01-01"), status: "QUARANTINED" });
    await lot({ expiryDate: new Date("2029-01-02"), status: "SOLD_OUT" });
    await lot({ expiryDate: new Date("2029-01-03"), quantity: 0 });
    await lot();
    const earliest = await lot({ expiryDate: new Date("2030-01-01"), status: "MARKED_DOWN" });
    const response = await post({ type });
    expect(response.status).toBe(201);
    expect((await response.json()).task).toMatchObject({ lotId: earliest.id, lot: { batchCode: earliest.batchCode } });
  });
  it.each(["FEFO", "QUARANTINE"])("requires a lot for %s when no eligible lot exists", async (type) => {
    await lot({ quantity: 0 });
    const response = await post({ type });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "LOT_REQUIRED" } });
    await unchanged();
  });
  it("commits task and active Staff notifications before a failing push", async () => {
    let committed: unknown;
    delivery.send.mockImplementationOnce(async (ids, payload) => {
      committed = { ids: [...ids].sort(), tasks: await prisma.task.count({ where: { id: payload.tag } }), notifications: await prisma.notification.count({ where: { taskId: payload.tag } }) };
      throw new Error("controlled push failure");
    });
    const response = await post();
    expect(response.status).toBe(201);
    expect(committed).toEqual({ ids: [users[2].id, users[3].id].sort(), tasks: 1, notifications: 2 });
    const { task } = await response.json();
    expect(await prisma.task.count({ where: { id: task.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { taskId: task.id } })).toBe(2);
  });
});
