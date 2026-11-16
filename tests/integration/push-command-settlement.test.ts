import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import { afterEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/admin/tasks/route";
import { completeFefoTask, completeRestock } from "@/lib/business";

const mocks = vi.hoisted(() => ({ session: null as Session | null, deliver: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: async () => mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("web-push", () => ({ setVapidDetails: vi.fn(), sendNotification: mocks.deliver }));
afterEach(() => vi.unstubAllEnvs());

it.each(["create", "restock", "fefo"])("settles committed %s despite a never-resolving provider, preserving notifications and replay semantics", async command => {
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public"); vi.stubEnv("VAPID_PRIVATE_KEY", "private"); vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.com");
  mocks.deliver.mockReset().mockImplementation(() => new Promise(() => {}));
  const run = randomUUID();
  const store = await prisma.store.create({ data: { code: `BOUND-${run}`, name: "Bounded push", address: "Test" } });
  const users = await Promise.all((["ADMIN", "STAFF", "MANAGER"] as const).map(role => prisma.user.create({ data: {
    email: `${role}-${run}@push.test`, name: role, role, passwordHash: "unused", userStores: { create: { storeId: store.id } },
  } })));
  const product = await prisma.product.create({ data: { sku: run, barcode: run, name: "Bounded", searchText: "bounded", category: "test", unit: "test", basePriceVnd: 100 } });
  const mutationId = randomUUID();
  try {
    const shelf = await prisma.shelf.create({ data: { storeId: store.id, code: "01", label: "Shelf", x: 0, y: 0 } });
    const inventory = await prisma.inventory.create({ data: { storeId: store.id, productId: product.id, shelfId: shelf.id, onShelf: 1, backroom: 5, capacity: 10, lowThreshold: 3 } });
    const user = { id: users[0].id, role: "ADMIN" as const, storeIds: [store.id], defaultStoreId: store.id };
    mocks.session = { expires: "2099-01-01", user };
    await prisma.pushSubscription.create({ data: { userId: users[command === "create" ? 1 : 2].id, endpoint: `https://push.test/${run}`, p256dh: "key", auth: "auth" } });
    let taskId: string;
    let pending: Promise<unknown>;
    const started = Date.now();
    if (command === "create") {
      taskId = "";
      pending = POST(new Request("http://localhost/api/admin/tasks", { method: "POST", body: JSON.stringify({ storeId: store.id, productId: product.id, shelfId: shelf.id, type: "RESTOCK", priority: "HIGH", assigneeId: users[1].id }) }));
    } else {
      let lotId: string | undefined;
      if (command === "fefo") {
        const supplier = await prisma.supplier.create({ data: { code: run, name: "Test", country: "VN" } });
        lotId = (await prisma.lot.create({ data: { storeId: store.id, productId: product.id, supplierId: supplier.id, batchCode: run, origin: "VN", receivedAt: new Date(), expiryDate: new Date("2020-01-01"), quantity: 2 } })).id;
      }
      taskId = (await prisma.task.create({ data: { storeId: store.id, productId: product.id, shelfId: shelf.id, lotId, type: command === "fefo" ? "QUARANTINE" : "RESTOCK", title: "Bounded command" } })).id;
      pending = command === "fefo" ? completeFefoTask(taskId, user, mutationId) : completeRestock(taskId, user, { quantity: 4, expectedVersion: inventory.version, clientMutationId: mutationId });
    }
    await vi.waitFor(() => expect(mocks.deliver).toHaveBeenCalledOnce(), { timeout: 10_000, interval: 50 });
    // The provider is still pending; all durable effects already committed.
    const committed = await prisma.task.findFirstOrThrow({ where: { storeId: store.id } });
    taskId ||= committed.id;
    expect(committed.status).toBe(command === "create" ? "OPEN" : "COMPLETED");
    expect(await prisma.notification.count({ where: { taskId } })).toBe(1);
    const result = await pending;
    expect(Date.now() - started).toBeLessThan(12_000);
    if (command === "create") expect((result as Response).status).toBe(201);
    else {
      const replay = command === "fefo" ? completeFefoTask(taskId, user, mutationId) : completeRestock(taskId, user, { quantity: 4, expectedVersion: inventory.version, clientMutationId: mutationId });
      expect(await replay).toEqual(result);
      expect(await prisma.mutationReceipt.count({ where: { clientMutationId: mutationId } })).toBe(1);
      expect(await prisma.taskEvent.count({ where: { taskId } })).toBe(1);
    }
    expect(await prisma.task.count({ where: { storeId: store.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { taskId } })).toBe(1);
    expect(mocks.deliver).toHaveBeenCalledOnce();
  } finally {
    await prisma.auditLog.deleteMany({ where: { storeId: store.id } });
    await prisma.notification.deleteMany({ where: { storeId: store.id } });
    await prisma.mutationReceipt.deleteMany({ where: { clientMutationId: mutationId } });
    await prisma.store.delete({ where: { id: store.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.supplier.deleteMany({ where: { code: run } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  }
}, 30_000);
