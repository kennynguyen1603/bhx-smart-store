import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-auth";
import { completeFefoTask, completeRestock, processSaleEvent, runFefoEngine, startTask } from "@/lib/business";
import { prisma } from "@/lib/db";
import { Prisma, Role, TaskPriority, TaskStatus, TaskType } from "@/generated/prisma/client";

const outcomePush = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue({ sent: 0, skipped: true }) }));
vi.mock("@/lib/push", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/push")>(), sendPushToUsers: outcomePush.send }));

const STORE_CODE = "TST-INT";
const PRODUCT_SKU = "TST-SKU";
const USER_EMAIL = "integration@demo.bhx";
const STAFF_EMAILS = ["integration-staff-1@demo.bhx", "integration-staff-2@demo.bhx"];
const OUTCOME_EMAILS = ["integration-manager@demo.bhx", "integration-inactive@demo.bhx", "integration-outsider@demo.bhx"];
const EVENT_PREFIX = "integration-test-";

let fixture: { storeId: string; productId: string; shelfId: string; inventoryId: string; userId: string; supplierId: string };

async function getCompetingStaff() {
  return Promise.all(STAFF_EMAILS.map((email, index) => prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: `Integration Staff ${index + 1}`,
      passwordHash: "not-used",
      role: Role.STAFF,
      userStores: { create: { storeId: fixture.storeId, isDefault: true } },
    },
  })));
}

async function cleanupFixture() {
  await prisma.integrationEvent.deleteMany({ where: { externalEventId: { startsWith: EVENT_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { in: [USER_EMAIL, ...STAFF_EMAILS, ...OUTCOME_EMAILS] } } });
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
  await Promise.all(OUTCOME_EMAILS.map((email, i) => prisma.user.create({ data: {
    email, name: `Outcome ${i}`, passwordHash: "unused", role: Role.MANAGER, active: i !== 1,
    ...(i !== 2 ? { userStores: { create: { storeId: store.id } } } : {}),
  } })));
  await prisma.fefoRule.createMany({ data: [
    { storeId: store.id, daysRemaining: 0, discountPercent: 0, quarantine: true },
    { storeId: store.id, daysRemaining: 1, discountPercent: 30 },
    { storeId: store.id, daysRemaining: 3, discountPercent: 20 },
  ] });
  fixture = { storeId: store.id, productId: product.id, shelfId: shelf.id, inventoryId: inventory.id, userId: user.id, supplierId: supplier.id };
});

beforeEach(async () => {
  outcomePush.send.mockReset().mockResolvedValue({ sent: 0, skipped: true });
  await prisma.integrationEvent.deleteMany({ where: { externalEventId: { startsWith: EVENT_PREFIX } } });
  await prisma.saleEvent.deleteMany({ where: { storeId: fixture.storeId } });
  await prisma.task.deleteMany({ where: { storeId: fixture.storeId } });
  await prisma.lot.deleteMany({ where: { storeId: fixture.storeId } });
  await prisma.stockMovement.deleteMany({ where: { inventoryId: fixture.inventoryId } });
  await prisma.auditLog.deleteMany({ where: { storeId: fixture.storeId } });
  await prisma.mutationReceipt.deleteMany({ where: { userId: fixture.userId } });
  await prisma.store.update({ where: { id: fixture.storeId }, data: { timeZone: "Asia/Ho_Chi_Minh" } });
  await prisma.inventory.update({ where: { id: fixture.inventoryId }, data: { onShelf: 6, backroom: 10, capacity: 10, lowThreshold: 3, version: 1 } });
  await prisma.eSL.updateMany({ where: { storeId: fixture.storeId }, data: { ledOn: false } });
});

afterEach(() => vi.useRealTimers());

afterAll(cleanupFixture);

describe("POS and RESTOCK business flow", () => {
  it.each(["start", "restock", "fefo"])("forbids Manager %s without stealing an assignment or changing durable state", async (command) => {
    const [staff] = await getCompetingStaff();
    const manager = await prisma.user.findUniqueOrThrow({ where: { email: OUTCOME_EMAILS[0] } });
    const { lot, task: unassigned } = await createFefoFixture("2026-11-17");
    const task = await prisma.task.update({ where: { id: unassigned.id }, data: { type: command === "fefo" ? "FEFO" : "RESTOCK", assigneeId: staff.id } });
    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { id: fixture.inventoryId } });
    const mutationId = randomUUID();
    const user = { id: manager.id, role: Role.MANAGER, storeIds: [fixture.storeId] };
    const execute = () => command === "start" ? startTask(task.id, user, mutationId) : command === "fefo" ? completeFefoTask(task.id, user, mutationId) : completeRestock(task.id, user, { quantity: 1, expectedVersion: inventory.version, clientMutationId: mutationId });
    await expect(execute()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toEqual(task);
    expect(await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).toEqual(lot);
    expect(await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).toEqual(inventory);
    expect(await prisma.taskEvent.count({ where: { taskId: task.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { taskId: task.id } })).toBe(0);
    expect(await prisma.stockMovement.count({ where: { taskId: task.id } })).toBe(0);
    expect(await prisma.mutationReceipt.count({ where: { clientMutationId: mutationId } })).toBe(0);
    expect(outcomePush.send).not.toHaveBeenCalled();
  });

  it("atomically allows exactly one Staff member to claim a task", async () => {
    const [firstStaff, secondStaff] = await getCompetingStaff();
    const task = await prisma.task.create({
      data: { storeId: fixture.storeId, productId: fixture.productId, shelfId: fixture.shelfId, type: TaskType.RESTOCK, status: TaskStatus.OPEN, title: "Competing claim test" },
    });

    const results = await Promise.allSettled([
      startTask(task.id, { id: firstStaff.id, role: Role.STAFF, storeIds: [fixture.storeId] }, randomUUID()),
      startTask(task.id, { id: secondStaff.id, role: Role.STAFF, storeIds: [fixture.storeId] }, randomUUID()),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ status: 409, code: "TASK_ALREADY_ASSIGNED" } satisfies Partial<ApiError>);
    const ownerId = (await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId;
    expect(ownerId).toBe(results[0].status === "fulfilled" ? firstStaff.id : secondStaff.id);
  });

  it("allows only one competing Staff completion to apply a restock", async () => {
    const [firstStaff, secondStaff] = await getCompetingStaff();
    const inventory = await prisma.inventory.update({
      where: { id: fixture.inventoryId },
      data: { onShelf: 1, backroom: 8, version: 10 },
    });
    const task = await prisma.task.create({
      data: { storeId: fixture.storeId, productId: fixture.productId, shelfId: fixture.shelfId, type: TaskType.RESTOCK, status: TaskStatus.OPEN, title: "Competing restock completion" },
    });
    const users = [firstStaff, secondStaff].map((staff) => ({ id: staff.id, role: Role.STAFF, storeIds: [fixture.storeId] }));

    const results = await Promise.allSettled(users.map((user) => completeRestock(task.id, user, {
      quantity: 5,
      expectedVersion: inventory.version,
      clientMutationId: randomUUID(),
    })));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ status: 409, code: "TASK_ALREADY_ASSIGNED" } satisfies Partial<ApiError>);
    const winnerIndex = results.findIndex((result) => result.status === "fulfilled");
    const savedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(savedTask).toMatchObject({ status: TaskStatus.COMPLETED, assigneeId: users[winnerIndex].id });
    expect(await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).toMatchObject({ onShelf: 6, backroom: 3, version: 11 });
    expect(await prisma.stockMovement.count({ where: { taskId: task.id } })).toBe(1);
  });

  it("serializes competing Staff start and restock completion claims", async () => {
    const [firstStaff, secondStaff] = await getCompetingStaff();
    const inventory = await prisma.inventory.update({
      where: { id: fixture.inventoryId },
      data: { onShelf: 1, backroom: 8, version: 20 },
    });
    const task = await prisma.task.create({
      data: { storeId: fixture.storeId, productId: fixture.productId, shelfId: fixture.shelfId, type: TaskType.RESTOCK, status: TaskStatus.OPEN, title: "Start versus completion" },
    });
    const starter = { id: firstStaff.id, role: Role.STAFF, storeIds: [fixture.storeId] };
    const completer = { id: secondStaff.id, role: Role.STAFF, storeIds: [fixture.storeId] };

    const results = await Promise.allSettled([
      startTask(task.id, starter, randomUUID()),
      completeRestock(task.id, completer, { quantity: 5, expectedVersion: inventory.version, clientMutationId: randomUUID() }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ status: 409, code: "TASK_ALREADY_ASSIGNED" } satisfies Partial<ApiError>);
    const savedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    const savedInventory = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
    if (results[0].status === "fulfilled") {
      expect(savedTask).toMatchObject({ status: TaskStatus.IN_PROGRESS, assigneeId: firstStaff.id });
      expect(savedInventory).toMatchObject({ onShelf: 1, backroom: 8, version: 20 });
    } else {
      expect(savedTask).toMatchObject({ status: TaskStatus.COMPLETED, assigneeId: secondStaff.id });
      expect(savedInventory).toMatchObject({ onShelf: 6, backroom: 3, version: 21 });
    }
    expect(await prisma.stockMovement.count({ where: { taskId: task.id } })).toBe(results[1].status === "fulfilled" ? 1 : 0);
  });

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
    expect(await prisma.taskEvent.count({ where: { task: { storeId: fixture.storeId }, type: "CREATED" } })).toBe(1);
    expect((await prisma.eSL.findUniqueOrThrow({ where: { code: "ESL-TST-01" } })).ledOn).toBe(true);
  });

  it("records priority escalation transactionally so an older POS commit changes the event cardinality", async () => {
    const input = { externalEventId: `${EVENT_PREFIX}${randomUUID()}`, storeCode: STORE_CODE, productSku: PRODUCT_SKU, shelfCode: "T-01", quantity: 4, priceVnd: 10_000, occurredAt: new Date() };
    await processSaleEvent(input);
    const task = await prisma.task.findFirstOrThrow({ where: { storeId: fixture.storeId } });
    expect(task.priority).toBe("MEDIUM");
    await processSaleEvent({ ...input, externalEventId: `${EVENT_PREFIX}${randomUUID()}`, quantity: 2 });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ priority: "HIGH" });
    expect(await prisma.taskEvent.count({ where: { taskId: task.id } })).toBe(2);
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

  it("uses inventory version CAS so concurrent restocks cannot both apply", async () => {
    const inventory = await prisma.inventory.update({
      where: { id: fixture.inventoryId },
      data: { onShelf: 1, backroom: 8, version: 30 },
    });
    const tasks = await Promise.all(["first", "second"].map((suffix) => prisma.task.create({
      data: { storeId: fixture.storeId, productId: fixture.productId, shelfId: fixture.shelfId, type: TaskType.RESTOCK, status: TaskStatus.OPEN, title: `CAS restock ${suffix}` },
    })));
    const user = { id: fixture.userId, role: Role.ADMIN, storeIds: [] };

    const results = await Promise.allSettled(tasks.map((task) => completeRestock(task.id, user, {
      quantity: 5,
      expectedVersion: inventory.version,
      clientMutationId: randomUUID(),
    })));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ status: 409, code: "VERSION_CONFLICT" } satisfies Partial<ApiError>);
    expect(await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).toMatchObject({ onShelf: 6, backroom: 3, version: 31 });
    expect(await prisma.stockMovement.count({ where: { taskId: { in: tasks.map((task) => task.id) } } })).toBe(1);
  });
});

async function createFefoFixture(expiryDate: string, markdownPercent: number | null = null) {
  const lot = await prisma.lot.create({ data: {
    storeId: fixture.storeId, productId: fixture.productId, supplierId: fixture.supplierId,
    batchCode: `FEFO-DATE-${randomUUID()}`, origin: "Việt Nam", receivedAt: new Date(),
    expiryDate: new Date(expiryDate), quantity: 4,
    status: markdownPercent === null ? "AVAILABLE" : "MARKED_DOWN",
    markdownPercent, markdownPriceVnd: markdownPercent === null ? null : 10_000 * (100 - markdownPercent) / 100,
  } });
  const task = await prisma.task.create({ data: {
    storeId: fixture.storeId, productId: fixture.productId, shelfId: fixture.shelfId,
    lotId: lot.id, type: TaskType.FEFO, title: "Store-day FEFO", note: "Original note",
  } });
  return { lot, task };
}

describe("FEFO engine", () => {
  it.each([
    { percent: 20, expiry: "2026-11-19", count: 0 },
    { percent: 30, expiry: "2026-11-19", count: 0 },
    { percent: 20, expiry: "2026-11-17", count: 1 },
  ])("creates $count upgrade tasks for an existing $percent percent markdown expiring $expiry", async ({ percent, expiry, count }) => {
    const { lot, task } = await createFefoFixture(expiry, percent);
    await prisma.task.delete({ where: { id: task.id } });
    await runFefoEngine(new Date("2026-11-16T08:00:00Z"));
    const tasks = await prisma.task.findMany({ where: { lotId: lot.id } });
    expect(tasks).toHaveLength(count);
    if (count) expect(tasks[0]).toMatchObject({ type: TaskType.FEFO, note: `Lô ${lot.batchCode} còn 1 ngày · Giảm 30%` });
  });

  it.each([
    { timeZone: "Asia/Ho_Chi_Minh", now: "2026-11-16T18:00:00Z", expiry: "2026-11-20", days: 3, type: TaskType.FEFO, priority: TaskPriority.MEDIUM, discount: 20 },
    { timeZone: "America/New_York", now: "2026-11-16T01:00:00Z", expiry: "2026-11-16", days: 1, type: TaskType.FEFO, priority: TaskPriority.HIGH, discount: 30 },
    { timeZone: "Asia/Ho_Chi_Minh", now: "2026-11-16T18:00:00Z", expiry: "2026-11-17", days: 0, type: TaskType.QUARANTINE, priority: TaskPriority.HIGH, discount: 0 },
  ])("selects store-day rules in $timeZone at $now for expiry $expiry", async ({ timeZone, now, expiry, days, type, priority, discount }) => {
    await prisma.store.update({ where: { id: fixture.storeId }, data: { timeZone } });
    const { lot, task } = await createFefoFixture(expiry);
    await prisma.task.delete({ where: { id: task.id } });
    await runFefoEngine(new Date(now));
    const tasks = await prisma.task.findMany({ where: { lotId: lot.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ type, priority, status: TaskStatus.OPEN });
    if (type === TaskType.FEFO) expect(tasks[0].note).toContain(`còn ${days} ngày · Giảm ${discount}%`);
  });

  it.each([
    { status: "QUARANTINED" as const, quantity: 4 },
    { status: "SOLD_OUT" as const, quantity: 4 },
    { status: "AVAILABLE" as const, quantity: 0 },
    { status: "MARKED_DOWN" as const, quantity: -1 },
    { status: "QUARANTINED" as const, quantity: 4, markdownPercent: 30 },
    { status: "MARKED_DOWN" as const, quantity: 0, markdownPercent: 30 },
  ])("does not revive an ineligible $status lot with quantity $quantity", async ({ status, quantity, markdownPercent }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T08:00:00Z"));
    const { lot, task } = await createFefoFixture("2026-11-17");
    const before = await prisma.lot.update({ where: { id: lot.id }, data: { status, quantity, markdownPercent } });
    await prisma.eSL.update({ where: { code: "ESL-TST-01" }, data: { ledOn: true } });
    const mutationId = randomUUID();
    await expect(completeFefoTask(task.id, { id: fixture.userId, role: Role.ADMIN, storeIds: [] }, mutationId))
      .rejects.toMatchObject({ status: 409, code: "LOT_NOT_SELLABLE" });
    expect(await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).toEqual(before);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toEqual(task);
    expect(await prisma.markdown.count({ where: { lotId: lot.id } })).toBe(0);
    expect(await prisma.taskEvent.count({ where: { taskId: task.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: lot.id } })).toBe(0);
    expect(await prisma.mutationReceipt.count({ where: { clientMutationId: mutationId } })).toBe(0);
    expect((await prisma.eSL.findUniqueOrThrow({ where: { code: "ESL-TST-01" } })).ledOn).toBe(true);
  });

  it.each([null, 30])("does not revive or supersede a lot with %s percent markdown quarantined after the task snapshot", async (markdownPercent) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T08:00:00Z"));
    const { lot, task } = await createFefoFixture("2026-11-17", markdownPercent);
    const quarantineTask = await prisma.task.create({ data: {
      storeId: fixture.storeId, productId: fixture.productId, shelfId: fixture.shelfId,
      lotId: lot.id, type: TaskType.QUARANTINE, title: "Concurrent quarantine",
    } });
    let snapshotRead!: () => void;
    let releaseMarkdown!: () => void;
    const snapshotReady = new Promise<void>((resolve) => { snapshotRead = resolve; });
    const quarantineCommitted = new Promise<void>((resolve) => { releaseMarkdown = resolve; });
    const runTransaction = prisma.$transaction.bind(prisma);
    const transaction = vi.spyOn(prisma, "$transaction").mockImplementation((async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      return runTransaction(async (tx) => {
        const taskDelegate = new Proxy(tx.task, {
          get(target, property) {
            if (property !== "findUnique") return Reflect.get(target, property);
            return async (args: Prisma.TaskFindUniqueArgs) => {
              const snapshot = await tx.task.findUnique(args);
              if (args.where.id === task.id) {
                snapshotRead();
                await quarantineCommitted;
              }
              return snapshot;
            };
          },
        });
        return callback(new Proxy(tx, {
          get(target, property) { return property === "task" ? taskDelegate : Reflect.get(target, property); },
        }));
      }, { timeout: 15_000 });
    }) as typeof prisma.$transaction);
    const user = { id: fixture.userId, role: Role.ADMIN, storeIds: [] };
    const markdownMutation = randomUUID();
    const quarantineMutation = randomUUID();
    const markdownResult = Promise.allSettled([completeFefoTask(task.id, user, markdownMutation)]);
    try {
      await snapshotReady;
      await completeFefoTask(quarantineTask.id, user, quarantineMutation);
      releaseMarkdown();
      const [result] = await markdownResult;
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason).toMatchObject({ status: 409, code: "LOT_NOT_SELLABLE" });
      expect(await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).toMatchObject({ status: "QUARANTINED", markdownPercent, markdownPriceVnd: markdownPercent === null ? null : 7_000 });
      expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toEqual(task);
      expect(await prisma.task.findUniqueOrThrow({ where: { id: quarantineTask.id } })).toMatchObject({ status: TaskStatus.COMPLETED });
      expect(await prisma.markdown.count({ where: { lotId: lot.id } })).toBe(0);
      expect(await prisma.taskEvent.count({ where: { taskId: task.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { entityId: lot.id, action: "FEFO_MARKDOWN" } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { entityId: lot.id, action: "LOT_QUARANTINE" } })).toBe(1);
      expect(await prisma.mutationReceipt.count({ where: { clientMutationId: markdownMutation } })).toBe(0);
      expect(await prisma.mutationReceipt.count({ where: { clientMutationId: quarantineMutation } })).toBe(1);
    } finally {
      releaseMarkdown();
      await markdownResult;
      transaction.mockRestore();
    }
  });

  // Catches obsolete tasks rejecting or mutating an already sufficient lot instead of closing once.
  it.each([20, 30])("cancels a superseded task for an existing %i percent markdown without changing the lot", async (percent) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
    const { lot, task } = await createFefoFixture("2026-11-20", percent);
    const historical = await prisma.markdown.create({ data: { lotId: lot.id, discountPercent: percent, originalPriceVnd: 10_000, markdownPriceVnd: percent === 20 ? 8_000 : 7_000 } });
    const [staff] = await getCompetingStaff();
    const user = { id: staff.id, role: Role.STAFF, storeIds: [fixture.storeId] };
    await prisma.eSL.update({ where: { code: "ESL-TST-01" }, data: { ledOn: true } });
    const clientMutationId = randomUUID();
    const result = await completeFefoTask(task.id, user, clientMutationId);
    const note = `Không cần xử lý: lô đã giảm ${percent}%, bằng hoặc cao hơn quy tắc 20%.`;
    expect(result).toEqual({ resolution: "ALREADY_APPLIED", task: { id: task.id, status: "CANCELLED", note }, lot: { id: lot.id, status: "MARKED_DOWN", markdownPercent: percent, markdownPriceVnd: percent === 20 ? 8_000 : 7_000 } });
    await expect(completeFefoTask(task.id, user, clientMutationId)).resolves.toEqual(result);
    await expect(completeFefoTask(task.id, user, randomUUID())).rejects.toMatchObject({ status: 409, code: "INVALID_TASK_STATE" });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: TaskStatus.CANCELLED, assigneeId: staff.id, note, completedAt: null });
    expect(await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).toEqual(lot);
    expect(await prisma.markdown.findMany({ where: { lotId: lot.id } })).toEqual([historical]);
    expect(await prisma.taskEvent.findMany({ where: { taskId: task.id } })).toMatchObject([{ type: "CANCELLED", actorId: staff.id, note }]);
    expect(await prisma.auditLog.findMany({ where: { storeId: fixture.storeId } })).toMatchObject([{ action: "FEFO_TASK_SUPERSEDED", entityType: "Task", entityId: task.id, actorId: staff.id }]);
    expect(await prisma.mutationReceipt.findMany({ where: { clientMutationId } })).toMatchObject([{ userId: staff.id, action: "FEFO_COMPLETE", response: result }]);
    expect((await prisma.eSL.findUniqueOrThrow({ where: { code: "ESL-TST-01" } })).ledOn).toBe(false);
    expect(await prisma.notification.count({ where: { taskId: task.id } })).toBe(0);
    expect(outcomePush.send).not.toHaveBeenCalled();
  });

  // Catches clearing an ESL that still represents actionable work on the same shelf/product.
  it("keeps the ESL on when cancelling a superseded task with an active sibling", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
    const { task } = await createFefoFixture("2026-11-20", 20);
    const sibling = await prisma.task.create({ data: { storeId: fixture.storeId, productId: fixture.productId, shelfId: fixture.shelfId, type: TaskType.RESTOCK, status: TaskStatus.BLOCKED, title: "Remaining shelf work" } });
    await prisma.eSL.update({ where: { code: "ESL-TST-01" }, data: { ledOn: true } });
    await completeFefoTask(task.id, { id: fixture.userId, role: Role.ADMIN, storeIds: [] }, randomUUID());
    expect(await prisma.task.findUniqueOrThrow({ where: { id: sibling.id } })).toEqual(sibling);
    expect((await prisma.eSL.findUniqueOrThrow({ where: { code: "ESL-TST-01" } })).ledOn).toBe(true);
  });

  // Catches cancellation overwriting the LED of a concurrently committed sibling task.
  it("keeps the ESL on when a sibling is created concurrently with superseded cancellation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
    const { task } = await createFefoFixture("2026-11-20", 20);
    let creatorReady!: () => void;
    let allowCreatorCommit!: () => void;
    let cancellationStarted!: (pid: number) => void;
    const creatorHasLedLock = new Promise<void>((resolve) => { creatorReady = resolve; });
    const creatorCanCommit = new Promise<void>((resolve) => { allowCreatorCommit = resolve; });
    const cancellationPid = new Promise<number>((resolve) => { cancellationStarted = resolve; });
    let siblingRead = false;
    let transactions = 0;
    let creation!: Promise<PromiseSettledResult<Awaited<ReturnType<typeof processSaleEvent>>>[]>;
    const runTransaction = prisma.$transaction.bind(prisma);
    const transaction = vi.spyOn(prisma, "$transaction").mockImplementation((async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const creatingSibling = transactions++ === 0;
      return runTransaction(async (tx) => {
        if (creatingSibling) {
          const eslDelegate = new Proxy(tx.eSL, {
            get(target, property) {
              if (property !== "updateMany") return Reflect.get(target, property);
              return async (args: Prisma.ESLUpdateManyArgs) => {
                const result = await tx.eSL.updateMany(args);
                creatorReady();
                await creatorCanCommit;
                return result;
              };
            },
          });
          return callback(new Proxy(tx, { get(target, property) { return property === "eSL" ? eslDelegate : Reflect.get(target, property); } }));
        }
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        cancellationStarted(pid);
        const taskDelegate = new Proxy(tx.task, {
          get(target, property) {
            if (property !== "findFirst") return Reflect.get(target, property);
            return async (args: Prisma.TaskFindFirstArgs) => {
              const snapshot = await tx.task.findFirst(args);
              siblingRead = true;
              // Without an ESL lock, preserve the stale no-sibling snapshot until creation commits.
              await creation;
              return snapshot;
            };
          },
        });
        return callback(new Proxy(tx, { get(target, property) { return property === "task" ? taskDelegate : Reflect.get(target, property); } }));
      }, { timeout: 15_000 });
    }) as typeof prisma.$transaction);
    let cancellation: Promise<PromiseSettledResult<object>[]> | undefined;
    try {
      creation = Promise.allSettled([processSaleEvent({ externalEventId: `${EVENT_PREFIX}${randomUUID()}`, storeCode: STORE_CODE, productSku: PRODUCT_SKU, shelfCode: "T-01", quantity: 4, priceVnd: 10_000, occurredAt: new Date() })]);
      await creatorHasLedLock;
      cancellation = Promise.allSettled([completeFefoTask(task.id, { id: fixture.userId, role: Role.ADMIN, storeIds: [] }, randomUUID())]);
      const pid = await cancellationPid;
      const deadline = performance.now() + 10_000;
      while (!siblingRead) {
        // Release creation only once cancellation either holds a stale snapshot or waits on its ESL lock.
        const [{ blocked }] = await prisma.$queryRaw<{ blocked: boolean }[]>`SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS blocked`;
        if (blocked) break;
        if (performance.now() >= deadline) throw new Error("Cancellation neither read siblings nor waited for the ESL lock");
      }
      allowCreatorCommit();
      const [created] = await creation;
      const [cancelled] = await cancellation;
      expect(created.status).toBe("fulfilled");
      expect(cancelled.status).toBe("fulfilled");
      if (cancelled.status === "fulfilled") expect(cancelled.value).toMatchObject({ resolution: "ALREADY_APPLIED", task: { id: task.id, status: "CANCELLED" } });
      expect(await prisma.task.findMany({ where: { storeId: fixture.storeId, productId: fixture.productId, shelfId: fixture.shelfId, type: TaskType.RESTOCK } })).toMatchObject([{ status: "OPEN" }]);
      expect((await prisma.eSL.findUniqueOrThrow({ where: { code: "ESL-TST-01" } })).ledOn).toBe(true);
    } finally {
      allowCreatorCommit();
      await creation;
      await cancellation;
      transaction.mockRestore();
    }
  });

  it("replaces 20% with the store-day 30% price and appends one historical markdown on retry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
    const { lot, task } = await createFefoFixture("2026-11-18", 20);
    const historical = await prisma.markdown.create({ data: { lotId: lot.id, discountPercent: 20, originalPriceVnd: 10_000, markdownPriceVnd: 8_000 } });
    const user = { id: fixture.userId, role: Role.ADMIN, storeIds: [] };
    const clientMutationId = randomUUID();
    const result = await completeFefoTask(task.id, user, clientMutationId);
    await expect(completeFefoTask(task.id, user, clientMutationId)).resolves.toEqual(result);
    expect(await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).toMatchObject({ status: "MARKED_DOWN", markdownPercent: 30, markdownPriceVnd: 7_000 });
    expect(await prisma.markdown.findUnique({ where: { id: historical.id } })).toEqual(historical);
    expect(await prisma.markdown.count({ where: { lotId: lot.id } })).toBe(2);
    expect(await prisma.markdown.count({ where: { lotId: lot.id, discountPercent: 30, originalPriceVnd: 10_000, markdownPriceVnd: 7_000 } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: lot.id, action: "FEFO_MARKDOWN" } })).toBe(1);
    expect(await prisma.taskEvent.count({ where: { taskId: task.id } })).toBe(1);
  });

  it("quarantines a stale FEFO task on the store expiry day without creating a markdown", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
    const { lot, task } = await createFefoFixture("2026-11-17", 20);
    await completeFefoTask(task.id, { id: fixture.userId, role: Role.ADMIN, storeIds: [] }, randomUUID());
    expect(await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).toMatchObject({ status: "QUARANTINED" });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: TaskStatus.COMPLETED, note: `Đã cách ly lô ${lot.batchCode}` });
    expect(await prisma.markdown.count({ where: { lotId: lot.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: lot.id, action: "LOT_QUARANTINE" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: lot.id, action: "FEFO_MARKDOWN" } })).toBe(0);
  });

  it.each([
    { scope: "the same task", distinctTasks: false },
    { scope: "two distinct tasks for the same lot", distinctTasks: true },
  ])("atomically completes FEFO once for concurrent Admin requests on $scope", async ({ distinctTasks }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T08:00:00Z"));
    const expiryDate = new Date();
    expiryDate.setUTCDate(expiryDate.getUTCDate() + 1);
    const lot = await prisma.lot.create({
      data: { storeId: fixture.storeId, productId: fixture.productId, supplierId: fixture.supplierId, batchCode: `ADMIN-FEFO-RACE-${randomUUID()}`, origin: "Việt Nam", receivedAt: new Date(), expiryDate, quantity: 4 },
    });
    const task = await prisma.task.create({
      data: { storeId: fixture.storeId, productId: fixture.productId, shelfId: fixture.shelfId, lotId: lot.id, type: TaskType.FEFO, status: TaskStatus.OPEN, title: "Competing Admin FEFO completion" },
    });
    const tasks = [task, distinctTasks ? await prisma.task.create({
      data: { storeId: fixture.storeId, productId: fixture.productId, shelfId: fixture.shelfId, lotId: lot.id, type: TaskType.FEFO, status: TaskStatus.OPEN, title: "Second task for the same lot" },
    }) : task];
    let reads = 0;
    let releaseReads!: () => void;
    const bothTasksRead = new Promise<void>((resolve) => { releaseReads = resolve; });
    // Execute real database transactions, but force both initial task snapshots
    // to be read before either completion can mutate anything.
    const runTransaction = prisma.$transaction.bind(prisma);
    const transaction = vi.spyOn(prisma, "$transaction").mockImplementation((async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      return runTransaction(async (tx) => {
        const synchronizedTask = new Proxy(tx.task, {
          get(target, property) {
            if (property !== "findUnique") return Reflect.get(target, property);
            return async (args: Prisma.TaskFindUniqueArgs) => {
              const snapshot = await tx.task.findUnique(args);
              if (tasks.some((candidate) => candidate.id === args.where.id)) {
                reads += 1;
                if (reads === 2) releaseReads();
                await bothTasksRead;
              }
              return snapshot;
            };
          },
        });
        return callback(new Proxy(tx, {
          get(target, property) {
            return property === "task" ? synchronizedTask : Reflect.get(target, property);
          },
        }));
      });
    }) as typeof prisma.$transaction);
    const user = { id: fixture.userId, role: Role.ADMIN, storeIds: [] };
    const mutationIds = [randomUUID(), randomUUID()];

    try {
      const results = await Promise.allSettled(mutationIds.map((id, index) => completeFefoTask(tasks[index].id, user, id)));

      transaction.mockRestore();
      expect(reads).toBe(2);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(distinctTasks ? 2 : 1);
      if (!distinctTasks) {
        const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        expect(rejected?.reason).toMatchObject({ status: 409, code: "INVALID_TASK_STATE" } satisfies Partial<ApiError>);
      }
      const savedTasks = await prisma.task.findMany({ where: { id: { in: tasks.map((candidate) => candidate.id) } } });
      expect(savedTasks.filter((candidate) => candidate.status === TaskStatus.COMPLETED)).toHaveLength(1);
      const winningTask = savedTasks.find((candidate) => candidate.status === TaskStatus.COMPLETED)!;
      const winnerIndex = distinctTasks ? tasks.findIndex((candidate) => candidate.id === winningTask.id) : results.findIndex((result) => result.status === "fulfilled");
      expect(winningTask.assigneeId).toBe(user.id);
      if (distinctTasks) {
        const cancelled = savedTasks.filter((candidate) => candidate.status === TaskStatus.CANCELLED);
        expect(cancelled).toHaveLength(1);
        expect(cancelled[0]).toMatchObject({ assigneeId: user.id, note: "Không cần xử lý: lô đã giảm 30%, bằng hoặc cao hơn quy tắc 30%." });
        expect((results[1 - winnerIndex] as PromiseFulfilledResult<unknown>).value).toMatchObject({ resolution: "ALREADY_APPLIED", task: { id: cancelled[0].id, status: "CANCELLED" } });
        expect(await prisma.taskEvent.count({ where: { taskId: cancelled[0].id, type: "CANCELLED" } })).toBe(1);
        expect(await prisma.auditLog.count({ where: { entityId: cancelled[0].id, action: "FEFO_TASK_SUPERSEDED" } })).toBe(1);
        await expect(completeFefoTask(cancelled[0].id, user, mutationIds[1 - winnerIndex])).resolves.toEqual((results[1 - winnerIndex] as PromiseFulfilledResult<unknown>).value);
      }
      expect(await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).toMatchObject({ status: "MARKED_DOWN", markdownPercent: 30, markdownPriceVnd: 7_000 });
      expect(await prisma.markdown.count({ where: { lotId: lot.id } })).toBe(1);
      expect(await prisma.taskEvent.count({ where: { taskId: { in: tasks.map((candidate) => candidate.id) }, type: "COMPLETED" } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: lot.id, action: "FEFO_MARKDOWN" } })).toBe(1);
      expect(await prisma.mutationReceipt.count({ where: { clientMutationId: { in: mutationIds } } })).toBe(distinctTasks ? 2 : 1);
      await expect(completeFefoTask(winningTask.id, user, mutationIds[winnerIndex])).resolves.toEqual((results[winnerIndex] as PromiseFulfilledResult<unknown>).value);
      await expect(completeFefoTask(winningTask.id, user, randomUUID())).rejects.toMatchObject({ status: 409, code: "INVALID_TASK_STATE" });
      expect(await prisma.markdown.count({ where: { lotId: lot.id } })).toBe(1);
      expect(await prisma.notification.count({ where: { taskId: { in: tasks.map((candidate) => candidate.id) }, type: "TASK_COMPLETED" } })).toBe(1);
      expect(outcomePush.send).toHaveBeenCalledTimes(1);
    } finally {
      transaction.mockRestore();
    }
  });

  it("allows only one competing Staff completion to apply FEFO side effects", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T08:00:00Z"));
    const [firstStaff, secondStaff] = await getCompetingStaff();
    const expiryDate = new Date();
    expiryDate.setUTCDate(expiryDate.getUTCDate() + 1);
    const lot = await prisma.lot.create({
      data: { storeId: fixture.storeId, productId: fixture.productId, supplierId: fixture.supplierId, batchCode: `FEFO-RACE-${randomUUID()}`, origin: "Việt Nam", receivedAt: new Date(), expiryDate, quantity: 4 },
    });
    const task = await prisma.task.create({
      data: { storeId: fixture.storeId, productId: fixture.productId, shelfId: fixture.shelfId, lotId: lot.id, type: TaskType.FEFO, status: TaskStatus.OPEN, title: "Competing FEFO completion" },
    });
    const users = [firstStaff, secondStaff].map((staff) => ({ id: staff.id, role: Role.STAFF, storeIds: [fixture.storeId] }));

    const results = await Promise.allSettled(users.map((user) => completeFefoTask(task.id, user, randomUUID())));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ status: 409, code: "TASK_ALREADY_ASSIGNED" } satisfies Partial<ApiError>);
    const winnerIndex = results.findIndex((result) => result.status === "fulfilled");
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: TaskStatus.COMPLETED, assigneeId: users[winnerIndex].id });
    expect(await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).toMatchObject({ status: "MARKED_DOWN", markdownPercent: 30, markdownPriceVnd: 7_000 });
    expect(await prisma.markdown.count({ where: { lotId: lot.id } })).toBe(1);
  });

  it("is idempotent and creates a quarantine task instead of a markdown for an expired lot", async () => {
    const lot = await prisma.lot.create({ data: { storeId: fixture.storeId, productId: fixture.productId, supplierId: fixture.supplierId, batchCode: "EXPIRED-01", origin: "Việt Nam", receivedAt: new Date("2026-11-01T00:00:00Z"), expiryDate: new Date("2026-11-12T00:00:00Z"), quantity: 4 } });
    const now = new Date("2026-11-13T08:00:00Z");

    await runFefoEngine(now);
    await runFefoEngine(now);

    const tasks = await prisma.task.findMany({ where: { lotId: lot.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].type).toBe(TaskType.QUARANTINE);
    expect(await prisma.taskEvent.count({ where: { taskId: tasks[0].id, type: "CREATED" } })).toBe(1);
    expect(await prisma.markdown.count({ where: { lotId: lot.id } })).toBe(0);

    await completeFefoTask(tasks[0].id, { id: fixture.userId, role: Role.ADMIN, storeIds: [] }, randomUUID());
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe("QUARANTINED");
    expect(await prisma.markdown.count({ where: { lotId: lot.id } })).toBe(0);
  });
});


describe("transactional task outcomes", () => {
  it.each([{ quantity: 1, outcome: "BLOCKED" }, { quantity: 5, outcome: "COMPLETED" }])("notifies active store oversight once for $outcome and survives push failure", async ({ quantity, outcome }) => {
    const [staff] = await getCompetingStaff();
    const manager = await prisma.user.findUniqueOrThrow({ where: { email: OUTCOME_EMAILS[0] } });
    const inventory = await prisma.inventory.update({ where: { id: fixture.inventoryId }, data: { onShelf: 1, backroom: 8, version: 70 } });
    const task = await prisma.task.create({ data: { storeId: fixture.storeId, productId: fixture.productId, shelfId: fixture.shelfId, type: TaskType.RESTOCK, title: "Outcome test" } });
    const mutation = { quantity, expectedVersion: inventory.version, clientMutationId: randomUUID() };
    let committed: unknown;
    outcomePush.send.mockImplementationOnce(async (ids, payload) => {
      committed = { ids: [...ids].sort(), url: payload.url, status: (await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status, notifications: await prisma.notification.count({ where: { taskId: task.id } }) };
      throw new Error("controlled outcome push failure");
    });
    const user = { id: staff.id, role: Role.STAFF, storeIds: [fixture.storeId] };
    const first = await completeRestock(task.id, user, mutation);
    expect(committed).toEqual({ ids: [fixture.userId, manager.id].sort(), url: `/admin?storeId=${fixture.storeId}&task=${task.id}`, status: outcome, notifications: 2 });
    expect(await completeRestock(task.id, user, mutation)).toEqual(first);
    const notifications = await prisma.notification.findMany({ where: { taskId: task.id } });
    expect(notifications).toHaveLength(2);
    expect(notifications.every((n) => n.type === `TASK_${outcome}`)).toBe(true);
    expect(outcomePush.send).toHaveBeenCalledTimes(1);
  });
  it("excludes the completing actor from FEFO outcomes and never repeats on receipt replay or terminal retry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T08:00:00Z"));
    const { task } = await createFefoFixture("2026-11-17");
    const user = { id: fixture.userId, role: Role.ADMIN, storeIds: [] };
    const mutationId = randomUUID();
    await completeFefoTask(task.id, user, mutationId);
    await completeFefoTask(task.id, user, mutationId);
    await expect(completeFefoTask(task.id, user, randomUUID())).rejects.toMatchObject({ code: "INVALID_TASK_STATE" });
    const manager = await prisma.user.findUniqueOrThrow({ where: { email: OUTCOME_EMAILS[0] } });
    expect(await prisma.notification.findMany({ where: { taskId: task.id } })).toMatchObject([{ userId: manager.id, type: "TASK_COMPLETED" }]);
    expect(outcomePush.send).toHaveBeenCalledTimes(1);
  });
});
