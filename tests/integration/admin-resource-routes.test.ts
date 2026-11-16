import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { PUT } from "@/app/api/admin/[resource]/[id]/route";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("next-auth", () => ({ getServerSession: async () => auth.session }));

const run = randomUUID();
let fixture: { storeId: string; inventoryId: string; productId: string; actorId: string };
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
  const inventory = await prisma.inventory.create({ data: { storeId: store.id, shelfId: shelf.id, productId: product.id, onShelf: 6, backroom: 10, capacity: 12, lowThreshold: 3 } });
  const actor = await prisma.user.create({ data: { email: `task2-${run}@demo.bhx`, name: "Route Admin", passwordHash: "unused", role: "ADMIN" } });
  fixture = { storeId: store.id, productId: product.id, inventoryId: inventory.id, actorId: actor.id };
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
  it.each(["unassigned Manager", "Staff", "anonymous"])("denies %s without mutation", async (kind) => {
    if (kind === "anonymous") auth.session = null;
    else auth.session!.user.role = kind === "Staff" ? "STAFF" : "MANAGER";
    expect((await put({ onShelf: 8 })).status).toBe(kind === "anonymous" ? 401 : 403);
    await expectUnchanged();
  });
});
