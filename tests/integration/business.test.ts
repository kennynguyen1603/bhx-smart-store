import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-auth";
import { completeFefoTask, completeRestock, processSaleEvent, runFefoEngine } from "@/lib/business";
import { prisma } from "@/lib/db";
import { Role, TaskPriority, TaskStatus, TaskType } from "@/generated/prisma/client";

const STORE_CODE = "TST-INT";
const PRODUCT_SKU = "TST-SKU";
const USER_EMAIL = "integration@demo.bhx";
const EVENT_PREFIX = "integration-test-";

let fixture: { storeId: string; productId: string; shelfId: string; inventoryId: string; userId: string; supplierId: string };

async function cleanupFixture() {
  await prisma.integrationEvent.deleteMany({ where: { externalEventId: { startsWith: EVENT_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: USER_EMAIL } });
  await prisma.store.deleteMany({ where: { code: STORE_CODE } });
  await prisma.product.deleteMany({ where: { sku: PRODUCT_SKU } });
  await prisma.supplier.deleteMany({ where: { code: "TST-SUP" } });
}

beforeAll(async () => {
  await cleanupFixture();
  const store = await prisma.store.create({ data: { code: STORE_CODE, name: "Integration Test Store", address: "Test only", mapWidth: 8, mapHeight: 6 } });
  const supplier = await prisma.supplier.create({ data: { code: "TST-SUP", name: "Test Supplier", country: "Việt Nam" } });
  const product = await prisma.product.create({ data: { sku: PRODUCT_SKU, barcode: "2999999999991", name: "Sản phẩm kiểm thử", searchText: "san pham kiem thu", category: "Test", unit: "Cái", basePriceVnd: 10_000 } });
  const shelf = await prisma.shelf.create({ data: { storeId: store.id, code: "T-01", label: "Kệ test", x: 2, y: 2 } });
  const inventory = await prisma.inventory.create({ data: { storeId: store.id, shelfId: shelf.id, productId: product.id, onShelf: 6, backroom: 10, capacity: 10, lowThreshold: 3 } });
  await prisma.eSL.create({ data: { code: "ESL-TST-01", storeId: store.id, shelfId: shelf.id, productId: product.id } });
  const user = await prisma.user.create({ data: { email: USER_EMAIL, name: "Integration Admin", passwordHash: "not-used", role: Role.ADMIN, userStores: { create: { storeId: store.id, isDefault: true } } } });
  await prisma.fefoRule.createMany({ data: [
    { storeId: store.id, daysRemaining: 0, discountPercent: 0, quarantine: true },
    { storeId: store.id, daysRemaining: 1, discountPercent: 30 },
    { storeId: store.id, daysRemaining: 3, discountPercent: 20 },
  ] });
  fixture = { storeId: store.id, productId: product.id, shelfId: shelf.id, inventoryId: inventory.id, userId: user.id, supplierId: supplier.id };
});

beforeEach(async () => {
  await prisma.integrationEvent.deleteMany({ where: { externalEventId: { startsWith: EVENT_PREFIX } } });
  await prisma.saleEvent.deleteMany({ where: { storeId: fixture.storeId } });
  await prisma.task.deleteMany({ where: { storeId: fixture.storeId } });
  await prisma.lot.deleteMany({ where: { storeId: fixture.storeId } });
  await prisma.stockMovement.deleteMany({ where: { inventoryId: fixture.inventoryId } });
  await prisma.auditLog.deleteMany({ where: { storeId: fixture.storeId } });
  await prisma.mutationReceipt.deleteMany({ where: { userId: fixture.userId } });
  await prisma.inventory.update({ where: { id: fixture.inventoryId }, data: { onShelf: 6, backroom: 10, capacity: 10, lowThreshold: 3, version: 1 } });
  await prisma.eSL.updateMany({ where: { storeId: fixture.storeId }, data: { ledOn: false } });
});

afterAll(cleanupFixture);

describe("POS and RESTOCK business flow", () => {
  it("processes a POS event once, floors stock at zero, creates one task and turns on the ESL", async () => {
    const externalEventId = `${EVENT_PREFIX}${randomUUID()}`;
    const input = { externalEventId, storeCode: STORE_CODE, productSku: PRODUCT_SKU, shelfCode: "T-01", quantity: 9, priceVnd: 10_000, occurredAt: new Date() };
    const first = await processSaleEvent(input);
    const duplicate = await processSaleEvent(input);

    expect(first.duplicate).toBe(false);
    if (!("inventory" in first)) throw new Error("Expected processed inventory result");
    expect(first.inventory.onShelf).toBe(0);
    expect(duplicate.duplicate).toBe(true);
    expect(await prisma.saleEvent.count({ where: { externalEventId } })).toBe(1);
    expect(await prisma.task.count({ where: { storeId: fixture.storeId, type: TaskType.RESTOCK, status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED] } } })).toBe(1);
    expect((await prisma.eSL.findUniqueOrThrow({ where: { code: "ESL-TST-01" } })).ledOn).toBe(true);
  });

  it("updates shelf, backroom, task, LED, movement and audit atomically", async () => {
    const inventory = await prisma.inventory.update({ where: { id: fixture.inventoryId }, data: { onShelf: 1, backroom: 8, version: 4 } });
    await prisma.eSL.update({ where: { code: "ESL-TST-01" }, data: { ledOn: true } });
    const task = await prisma.task.create({ data: { storeId: fixture.storeId, productId: fixture.productId, shelfId: fixture.shelfId, type: TaskType.RESTOCK, status: TaskStatus.OPEN, priority: TaskPriority.HIGH, title: "Bổ sung test" } });
    const clientMutationId = randomUUID();
    const user = { id: fixture.userId, role: Role.ADMIN, storeIds: [fixture.storeId] };

    const first = await completeRestock(task.id, user, { quantity: 5, expectedVersion: inventory.version, clientMutationId }) as { task: { status: TaskStatus }; inventory: { onShelf: number; backroom: number; version: number } };
    const duplicate = await completeRestock(task.id, user, { quantity: 5, expectedVersion: inventory.version, clientMutationId }) as typeof first;

    expect(first.task.status).toBe(TaskStatus.COMPLETED);
    expect(duplicate).toEqual(first);
    expect(first.inventory).toMatchObject({ onShelf: 6, backroom: 3, version: 5 });
    expect((await prisma.eSL.findUniqueOrThrow({ where: { code: "ESL-TST-01" } })).ledOn).toBe(false);
    expect(await prisma.stockMovement.count({ where: { clientMutationId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { storeId: fixture.storeId, action: "RESTOCK" } })).toBe(1);
  });

  it("rejects a stale inventory version with a 409 conflict", async () => {
    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { id: fixture.inventoryId } });
    const task = await prisma.task.create({ data: { storeId: fixture.storeId, productId: fixture.productId, shelfId: fixture.shelfId, type: TaskType.RESTOCK, status: TaskStatus.OPEN, title: "Conflict test" } });
    await prisma.inventory.update({ where: { id: inventory.id }, data: { version: { increment: 1 } } });

    await expect(completeRestock(task.id, { id: fixture.userId, role: Role.ADMIN, storeIds: [] }, { quantity: 1, expectedVersion: inventory.version, clientMutationId: randomUUID() }))
      .rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" } satisfies Partial<ApiError>);
  });
});

describe("FEFO engine", () => {
  it("is idempotent and creates a quarantine task instead of a markdown for an expired lot", async () => {
    const lot = await prisma.lot.create({ data: { storeId: fixture.storeId, productId: fixture.productId, supplierId: fixture.supplierId, batchCode: "EXPIRED-01", origin: "Việt Nam", receivedAt: new Date("2026-11-01T00:00:00Z"), expiryDate: new Date("2026-11-12T00:00:00Z"), quantity: 4 } });
    const now = new Date("2026-11-13T08:00:00Z");

    await runFefoEngine(now);
    await runFefoEngine(now);

    const tasks = await prisma.task.findMany({ where: { lotId: lot.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].type).toBe(TaskType.QUARANTINE);
    expect(await prisma.markdown.count({ where: { lotId: lot.id } })).toBe(0);

    await completeFefoTask(tasks[0].id, { id: fixture.userId, role: Role.ADMIN, storeIds: [] }, randomUUID());
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe("QUARANTINED");
    expect(await prisma.markdown.count({ where: { lotId: lot.id } })).toBe(0);
  });
});
