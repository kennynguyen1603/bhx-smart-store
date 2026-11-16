import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { DELETE, PUT } from "@/app/api/admin/[resource]/[id]/route";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("next-auth", () => ({ getServerSession: async () => auth.session }));

const run = randomUUID();
let fixture: {
  storeId: string;
  inventoryId: string;
  productId: string;
  actorId: string;
  shelfId: string;
  zoneId: string;
  foreignStoreId: string;
  foreignZoneId: string;
  foreignShelfId: string;
  eslId: string;
  emptyShelfId: string;
};
async function put(body: unknown) {
  return PUT(new Request("http://localhost/api/admin/inventories/test", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ resource: "inventories", id: fixture.inventoryId }) });
}
async function expectUnchanged() {
  expect(await prisma.inventory.findUniqueOrThrow({ where: { id: fixture.inventoryId } })).toMatchObject({
    onShelf: 6, backroom: 10, capacity: 12, lowThreshold: 3, version: 7,
  });
  expect(await prisma.auditLog.count({ where: { entityId: fixture.inventoryId } })).toBe(0);
}
beforeAll(async () => {
  const store = await prisma.store.create({ data: { code: `T2-${run}`, name: "Task 2 test", address: "Test route only" } });
  const product = await prisma.product.create({ data: { sku: `T2-${run}`, barcode: `T2-${run}`, name: "Test product", searchText: "test", category: "Test", unit: "Cái", basePriceVnd: 1000 } });
  const shelf = await prisma.shelf.create({ data: { storeId: store.id, code: "T2-01", label: "Kệ test", x: 0, y: 1 } });
  const zone = await prisma.zone.create({ data: { storeId: store.id, name: "Zone test", x: 0, y: 0, width: 2, height: 2 } });
  const emptyShelf = await prisma.shelf.create({ data: { storeId: store.id, zoneId: zone.id, code: "T2-EMPTY", label: "Kệ trống", x: 2, y: 1 } });
  const inventory = await prisma.inventory.create({ data: { storeId: store.id, shelfId: shelf.id, productId: product.id, onShelf: 6, backroom: 10, capacity: 12, lowThreshold: 3 } });
  const esl = await prisma.eSL.create({ data: { code: `ESL-${run}`, storeId: store.id, shelfId: shelf.id, productId: product.id } });
  const foreignStore = await prisma.store.create({ data: { code: `T2-F-${run}`, name: "Foreign store", address: "Foreign route test" } });
  const foreignZone = await prisma.zone.create({ data: { storeId: foreignStore.id, name: "Foreign zone", x: 0, y: 0, width: 2, height: 2 } });
  const foreignShelf = await prisma.shelf.create({ data: { storeId: foreignStore.id, zoneId: foreignZone.id, code: "F-01", label: "Kệ ngoại", x: 0, y: 1 } });
  const actor = await prisma.user.create({ data: { email: `task2-${run}@demo.bhx`, name: "Route Admin", passwordHash: "unused", role: "ADMIN" } });
  fixture = { storeId: store.id, productId: product.id, inventoryId: inventory.id, actorId: actor.id, shelfId: shelf.id, zoneId: zone.id, foreignStoreId: foreignStore.id, foreignZoneId: foreignZone.id, foreignShelfId: foreignShelf.id, eslId: esl.id, emptyShelfId: emptyShelf.id };
});
beforeEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: fixture.inventoryId } });
  await prisma.inventory.update({ where: { id: fixture.inventoryId }, data: { onShelf: 6, backroom: 10, capacity: 12, lowThreshold: 3, version: 7 } });
  auth.session = { expires: "2099-01-01", user: { id: fixture.actorId, role: "ADMIN", storeIds: [], defaultStoreId: null } };
});
afterAll(async () => {
  if (!fixture) return;
  await prisma.auditLog.deleteMany({ where: { entityId: fixture.inventoryId } });
  await prisma.store.delete({ where: { id: fixture.storeId } });
  await prisma.store.delete({ where: { id: fixture.foreignStoreId } });
  await prisma.product.delete({ where: { id: fixture.productId } });
  await prisma.user.delete({ where: { id: fixture.actorId } });
});

describe("inventory Admin PUT real route and database", () => {
  // A refined schema .partial() returns 500 instead of reaching either persistence or validation.
  it("accepts partial quantities, preserves omitted fields, increments once and writes one before/after audit", async () => {
    const response = await put({ onShelf: 8, backroom: 0, version: 999, storeId: "tampered" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ onShelf: 8, backroom: 0, capacity: 12, lowThreshold: 3, version: 8, storeId: fixture.storeId });
    const saved = await prisma.inventory.findUniqueOrThrow({ where: { id: fixture.inventoryId } });
    expect(saved).toMatchObject({ onShelf: 8, backroom: 0, capacity: 12, lowThreshold: 3, version: 8 });
    const audits = await prisma.auditLog.findMany({ where: { entityId: fixture.inventoryId } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: fixture.actorId, storeId: fixture.storeId, action: "INVENTORY_ADMIN_UPDATE", entityType: "Inventory", before: { onShelf: 6, backroom: 10, version: 7 }, after: { onShelf: 8, backroom: 0, version: 8 } });
  });
  it.each([
    { onShelf: 13 }, { capacity: 5 }, { lowThreshold: 12 }, { capacity: 3 },
    { onShelf: -1 }, { backroom: 1.5 }, { capacity: 0 }, { lowThreshold: -1 }, { onShelf: "8" },
  ])("rejects invalid merged inventory %j without a mutation or audit", async (body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    await expectUnchanged();
  });
  it("validates a combined capacity and threshold change using the merged values", async () => {
    const response = await put({ capacity: 20, lowThreshold: 15 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ onShelf: 6, backroom: 10, capacity: 20, lowThreshold: 15, version: 8 });
  });
  it("allows an assigned Manager to update inventory", async () => {
    auth.session!.user.role = "MANAGER";
    auth.session!.user.storeIds = [fixture.storeId];
    expect((await put({ backroom: 5 })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { entityId: fixture.inventoryId } })).toBe(1);
  });
  it("rolls back inventory and version when audit insertion fails", async () => {
    const suffix = run.replaceAll("-", "");
    const functionName = `fail_inventory_audit_${suffix}`;
    const triggerName = `fail_inventory_audit_trigger_${suffix}`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled audit failure'; END; $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "AuditLog" FOR EACH ROW WHEN (NEW."entityId" = '${fixture.inventoryId}') EXECUTE FUNCTION "${functionName}"()`);
    try {
      const response = await put({ onShelf: 8 });
      expect(response.status).toBe(500);
      await expectUnchanged();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
  });
  it.each(["unassigned Manager", "Staff", "anonymous"])("denies %s without mutation", async (kind) => {
    if (kind === "anonymous") auth.session = null;
    else auth.session!.user.role = kind === "Staff" ? "STAFF" : "MANAGER";
    expect((await put({ onShelf: 8 })).status).toBe(kind === "anonymous" ? 401 : 403);
    await expectUnchanged();
  });
});

describe("Admin same-store references", () => {
  it("rejects a Manager assigning a shelf to a zone from another store without mutation or audit", async () => {
    auth.session = { expires: "2099-01-01", user: { id: fixture.actorId, role: "MANAGER", storeIds: [fixture.storeId], defaultStoreId: fixture.storeId } };
    const response = await PUT(new Request("http://localhost/api/admin/shelves/test", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ zoneId: fixture.foreignZoneId }) }), { params: Promise.resolve({ resource: "shelves", id: fixture.shelfId }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "CROSS_STORE_REFERENCE" } });
    expect(await prisma.shelf.findUniqueOrThrow({ where: { id: fixture.shelfId } })).toMatchObject({ zoneId: null, storeId: fixture.storeId });
    expect(await prisma.auditLog.count({ where: { entityId: fixture.shelfId } })).toBe(0);
  });

  it("rejects an Admin moving an ESL to a shelf from another store without mutation or audit", async () => {
    auth.session = { expires: "2099-01-01", user: { id: fixture.actorId, role: "ADMIN", storeIds: [], defaultStoreId: null } };
    const response = await PUT(new Request("http://localhost/api/admin/esls/test", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shelfId: fixture.foreignShelfId }) }), { params: Promise.resolve({ resource: "esls", id: fixture.eslId }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "CROSS_STORE_REFERENCE" } });
    expect(await prisma.eSL.findUniqueOrThrow({ where: { id: fixture.eslId } })).toMatchObject({ shelfId: fixture.shelfId, storeId: fixture.storeId });
    expect(await prisma.auditLog.count({ where: { entityId: fixture.eslId } })).toBe(0);
  });
});

describe("safe shelf deletion", () => {
  it("rejects a shelf with operational dependencies and preserves every row", async () => {
    auth.session = { expires: "2099-01-01", user: { id: fixture.actorId, role: "ADMIN", storeIds: [], defaultStoreId: null } };
    const response = await DELETE(new Request("http://localhost/api/admin/shelves/test", { method: "DELETE" }), { params: Promise.resolve({ resource: "shelves", id: fixture.shelfId }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "SHELF_NOT_EMPTY", message: expect.stringContaining("Chỉ có thể xoá kệ trống") } });
    expect(await prisma.shelf.count({ where: { id: fixture.shelfId } })).toBe(1);
    expect(await prisma.inventory.count({ where: { id: fixture.inventoryId } })).toBe(1);
    expect(await prisma.eSL.count({ where: { id: fixture.eslId } })).toBe(1);
  });

  it("deletes a truly empty shelf", async () => {
    auth.session = { expires: "2099-01-01", user: { id: fixture.actorId, role: "ADMIN", storeIds: [], defaultStoreId: null } };
    const response = await DELETE(new Request("http://localhost/api/admin/shelves/test", { method: "DELETE" }), { params: Promise.resolve({ resource: "shelves", id: fixture.emptyShelfId }) });
    expect(response.status).toBe(204);
    expect(await prisma.shelf.count({ where: { id: fixture.emptyShelfId } })).toBe(0);
  });
});
