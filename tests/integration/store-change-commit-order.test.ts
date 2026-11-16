import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import { expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET } from "@/app/api/store-changes/route";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("next-auth", () => ({ getServerSession: async () => auth.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

it("detects an older task transaction committing after a newer maximum was acknowledged", async () => {
  const run = randomUUID();
  const store = await prisma.store.create({ data: { code: `ORDER-${run}`, name: "Commit order", address: "Test" } });
  const product = await prisma.product.create({ data: { sku: run, barcode: run, name: "Order", searchText: "order", category: "test", unit: "test", basePriceVnd: 1 } });
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  let ready!: () => void;
  const written = new Promise<void>(resolve => { ready = resolve; });
  let older: Promise<unknown> | undefined;
  try {
    const shelf = await prisma.shelf.create({ data: { storeId: store.id, code: "test", label: "Test", x: 0, y: 0 } });
    auth.session = { expires: "2099-01-01", user: { id: "reader", role: "MANAGER", storeIds: [store.id], defaultStoreId: store.id } };
    const taskData = { storeId: store.id, productId: product.id, shelfId: shelf.id, type: "RESTOCK" as const, title: "Order" };
    const oldDate = new Date("2026-11-16T01:00:00Z"), newDate = new Date("2026-11-16T02:00:00Z");
    older = prisma.$transaction(async tx => {
      await tx.task.create({ data: { ...taskData, updatedAt: oldDate, events: { create: { type: "CREATED" } } } });
      ready();
      await released;
    }, { timeout: 20_000 });
    // Attach a rejection handler while coordinating the open transaction.
    void older.catch(() => undefined);
    await written;
    await prisma.$transaction(async tx => {
      await tx.task.create({ data: { ...taskData, updatedAt: newDate, events: { create: { type: "CREATED" } } } });
    });
    const request = () => GET(new Request(`http://localhost/api/store-changes?storeId=${store.id}`));
    const acknowledged = await (await request()).json();
    expect(acknowledged.taskUpdatedAt).toBe(newDate.toISOString());
    expect(await prisma.taskEvent.count({ where: { task: { storeId: store.id } } })).toBe(1);
    release();
    await older;
    const after = await (await request()).json();
    expect(after.taskUpdatedAt).toBe(acknowledged.taskUpdatedAt);
    expect(await prisma.taskEvent.count({ where: { task: { storeId: store.id } } })).toBe(2);
    expect(after.token).not.toBe(acknowledged.token);
  } finally {
    release();
    await older?.catch(() => undefined);
    await prisma.store.delete({ where: { id: store.id } });
    await prisma.product.delete({ where: { id: product.id } });
  }
});
