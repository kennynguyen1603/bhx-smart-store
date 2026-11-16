import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("next-auth", () => ({ getServerSession: async () => auth.session }));
const run = randomUUID();
let storeId: string, foreignId: string, productId: string, foreignProductId: string, shelfId: string, staffId: string;
let users: string[] = [];
async function overview(query = "") { const { GET } = await import("@/app/api/admin/overview/route"); return GET(new Request(`http://localhost/api/admin/overview${query}`)); }
beforeAll(async () => {
  const stores = await Promise.all(["home", "foreign"].map(code => prisma.store.create({ data: { code: `OV-${code}-${run}`, name: code, address: "test" } })));
  [storeId, foreignId] = stores.map(s => s.id);
  const products = await Promise.all(["home", "foreign"].map(sku => prisma.product.create({ data: { sku: `OV-${sku}-${run}`, barcode: `OV-${sku}-${run}`, name: sku, searchText: sku, category: "test", unit: "Cái", basePriceVnd: 1000 } })));
  [productId, foreignProductId] = products.map(p => p.id);
  const shelves = await Promise.all(stores.map(s => prisma.shelf.create({ data: { storeId: s.id, code: "01", label: `Kệ ${s.name}`, x: 0, y: 0 } })));
  shelfId = shelves[0].id;
  await Promise.all(stores.map((s, index) => prisma.inventory.create({ data: { storeId: s.id, shelfId: shelves[index].id, productId: products[index].id, onShelf: 1, backroom: 4, capacity: 10, lowThreshold: 2 } })));
  const accounts = await Promise.all((["STAFF", "STAFF", "STAFF", "MANAGER"] as const).map((role, index) => prisma.user.create({ data: { email: `OV-${index}-${run}@test.local`, name: `Person ${index}`, passwordHash: "unused", role, active: index !== 2, userStores: { create: { storeId: index === 1 ? foreignId : storeId } } } })));
  users = accounts.map(u => u.id); staffId = users[0];
  auth.session = { expires: "2099-01-01", user: { id: users[3], role: "MANAGER", storeIds: [storeId], defaultStoreId: storeId } };
  await prisma.notification.createMany({ data: [
    { storeId, userId: users[3], type: "TASK_COMPLETED", title: "Own outcome", body: "Complete" },
    { storeId, userId: staffId, type: "TASK_CREATED", title: "Another user's notification", body: "Assigned" },
    { storeId: foreignId, userId: users[3], type: "TASK_BLOCKED", title: "Another store", body: "Blocked" },
  ] });
  await prisma.task.createMany({ data: Array.from({ length: 102 }, (_, index) => ({ storeId, productId, shelfId, title: `Task ${index}`, type: "RESTOCK" as const, priority: "HIGH" as const, status: index < 3 ? (["OPEN", "IN_PROGRESS", "BLOCKED"] as const)[index] : "COMPLETED" as const, assigneeId: staffId, createdAt: new Date(Date.UTC(2030, 0, 1, 0, index)), completedAt: index < 3 ? null : new Date("2030-01-02") })) });
  await prisma.task.create({ data: { storeId: foreignId, productId: foreignProductId, shelfId: shelves[1].id, title: "Foreign task", type: "RESTOCK", priority: "NORMAL" } });
});
afterAll(async () => {
  if (storeId) await prisma.store.deleteMany({ where: { id: { in: [storeId, foreignId] } } });
  if (productId) await prisma.product.deleteMany({ where: { id: { in: [productId, foreignProductId] } } });
  if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
});
it("caps tasks at 100 with active tasks first and newest within each group, with named relations and timestamps", async () => {
  const response = await overview(); expect(response.status).toBe(200); const data = await response.json();
  expect(data.tasks).toHaveLength(100);
  expect(data.tasks.slice(0, 5).map((t: { title: string }) => t.title)).toEqual(["Task 2", "Task 1", "Task 0", "Task 101", "Task 100"]);
  expect(data.tasks[3]).toMatchObject({ product: { name: "home" }, shelf: { label: "Kệ home" }, assignee: { name: "Person 0" }, completedAt: "2030-01-02T00:00:00.000Z", createdAt: "2030-01-01T01:41:00.000Z" });
  expect(data.tasks.every((t: { storeId: string }) => t.storeId === storeId)).toBe(true);
});
it("only offers selected-store inventory products, shelves and active Staff recipients", async () => {
  const data = await (await overview()).json();
  expect(data.taskReferences.products).toEqual([{ id: productId, name: "home" }]);
  expect(data.taskReferences.shelves).toEqual([{ id: shelfId, name: "Kệ home", productIds: [productId] }]);
  expect(data.taskReferences.assignees).toEqual([{ id: staffId, name: "Person 0" }]);
  expect(data.stores.map((s: { id: string }) => s.id)).toEqual([storeId]);
});
it("rejects an unauthorized store instead of exposing its task data", async () => { expect((await overview(`?storeId=${foreignId}`)).status).toBe(403); });
it("never falls back to all stores when Manager has no memberships or default", async () => {
  const previous = auth.session; auth.session = { expires: "2099-01-01", user: { id: staffId, role: "MANAGER", storeIds: [], defaultStoreId: null } };
  try { const data = await (await overview()).json(); expect(data.tasks).toEqual([]); expect(data.taskReferences.assignees).toEqual([]); expect(data.inventories).toEqual([]); expect(data.notifications).toEqual([]); }
  finally { auth.session = previous; }
});

it("returns only the current user's selected-store notifications for Manager and Admin", async () => {
  const previous = auth.session;
  try {
    for (const role of ["MANAGER", "ADMIN"] as const) {
      auth.session = { expires: "2099-01-01", user: { id: users[3], role, storeIds: [storeId], defaultStoreId: storeId } };
      const data = await (await overview()).json();
      expect(data.notifications.map((row: { title: string }) => row.title)).toEqual(["Own outcome"]);
    }
  } finally { auth.session = previous; }
});
