import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/simulate/route";
import { prisma } from "@/lib/db";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("next-auth", () => ({ getServerSession: async () => auth.session }));

const run = randomUUID();
const operationId = randomUUID();
let fixture: { actorId: string; storeId: string; productId: string; inventoryId: string };

beforeAll(async () => {
  const store = await prisma.store.create({ data: { code: `SIM-${run}`, name: "Simulator idempotency", address: "Simulator test store" } });
  const product = await prisma.product.create({ data: { sku: `SIM-${run}`, barcode: `SIM-${run}`, name: "Simulator product", searchText: "simulator", category: "Test", unit: "Cái", basePriceVnd: 10_000 } });
  const shelf = await prisma.shelf.create({ data: { storeId: store.id, code: "SIM-01", label: "Kệ mô phỏng", x: 0, y: 1 } });
  const inventory = await prisma.inventory.create({ data: { storeId: store.id, shelfId: shelf.id, productId: product.id, onShelf: 10, backroom: 20, capacity: 20, lowThreshold: 2 } });
  const actor = await prisma.user.create({ data: { email: `sim-${run}@demo.bhx`, name: "Simulator Admin", passwordHash: "unused", role: "ADMIN" } });
  fixture = { actorId: actor.id, storeId: store.id, productId: product.id, inventoryId: inventory.id };
  auth.session = { expires: "2099-01-01", user: { id: actor.id, role: "ADMIN", storeIds: [], defaultStoreId: null } };
});

afterAll(async () => {
  if (!fixture) return;
  await prisma.integrationEvent.deleteMany({ where: { externalEventId: { contains: operationId } } });
  await prisma.store.delete({ where: { id: fixture.storeId } });
  await prisma.product.delete({ where: { id: fixture.productId } });
  await prisma.user.delete({ where: { id: fixture.actorId } });
});

function simulate() {
  return POST(new Request("http://localhost/api/admin/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "POS", inventoryId: fixture.inventoryId, quantity: 2, operationId }),
  }));
}

describe("Admin simulator idempotency", () => {
  it("returns the reconciled result for the same operation key without duplicating effects", async () => {
    const first = await simulate();
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const retry = await simulate();
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(firstBody);

    expect(await prisma.inventory.findUniqueOrThrow({ where: { id: fixture.inventoryId } })).toMatchObject({ onShelf: 8, version: 2 });
    expect(await prisma.saleEvent.count({ where: { storeId: fixture.storeId, productId: fixture.productId } })).toBe(1);
    expect(await prisma.integrationEvent.count({ where: { externalEventId: { contains: operationId } } })).toBe(1);
    expect(await prisma.mutationReceipt.count({ where: { clientMutationId: operationId, userId: fixture.actorId } })).toBe(1);
  });
});
