import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { PUT } from "@/app/api/admin/[resource]/[id]/route";

vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "concurrency-admin", role: "ADMIN", storeIds: [] } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
afterAll(() => prisma.$disconnect());

it("serializes conflicting shelf PUTs and restores exact coordinates even after assertion failure", async () => {
  // Own isolated rows; no seeded/demo shelf is changed by this regression.
  const store = await prisma.store.create({
    data: { code: `CONCURRENT-${randomUUID()}`, name: "Concurrent moves", address: "Test only", shelves: {
      create: [{ code: "A", label: "Shelf A", x: 0, y: 0 }, { code: "B", label: "Shelf B", x: 2, y: 0 }],
    } }, include: { shelves: { orderBy: { id: "asc" } } },
  });
  const original = store.shelves.map(({ id, x, y }) => ({ id, x, y }));
  const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000, query_timeout: 5_000 });
  const requests: Promise<Response>[] = [];
  let connected = false;
  try {
    await blocker.connect(); connected = true;
    await blocker.query("BEGIN");
    const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await blocker.query('SELECT id FROM "Shelf" WHERE "storeId" = $1 FOR UPDATE', [store.id]);
    for (const shelf of original) {
      requests.push(PUT(new Request(`http://localhost/api/admin/shelves/${shelf.id}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ x: 4, y: 2 }),
      }), { params: Promise.resolve({ resource: "shelves", id: shelf.id }) }));
    }
    // Wait for BOTH real transactions: originally both await Shelf UPDATE;
    // with serialization, one awaits Shelf UPDATE and the other the Store lock.
    // Poll the actual lock graph instead of assuming a scheduling delay is enough.
    await expect.poll(async () => {
      const { rows } = await blocker.query<{ pid: number }>(`
        SELECT DISTINCT pid FROM pg_locks a
        WHERE NOT granted AND ($1 = ANY(pg_blocking_pids(a.pid)) OR EXISTS (
          SELECT 1 FROM unnest(pg_blocking_pids(a.pid)) AS b(pid)
          WHERE $1 = ANY(pg_blocking_pids(b.pid))
        ))`, [pid]);
      return rows.length;
    }, { timeout: 3_000, interval: 20 }).toBe(2);
    await blocker.query("ROLLBACK");
    const responses = await Promise.all(requests);
    const statuses = responses.map((response) => response.status).sort();
    console.log("Concurrent shelf PUT statuses:", statuses);
    expect(statuses).toEqual([200, 409]);
    expect(await responses.find((response) => response.status === 409)!.json()).toMatchObject({ error: { code: "SHELF_POSITION_OCCUPIED" } });
    expect(await prisma.shelf.count({ where: { storeId: store.id, x: 4, y: 2 } })).toBe(1);
  } finally {
    // Release the gate and settle EVERY issued route before restoring, even in RED.
    try {
      if (connected) await blocker.query("ROLLBACK");
    } finally {
      await blocker.end();
      await Promise.allSettled(requests);
      try {
        await prisma.$transaction(original.map(({ id, x, y }) => prisma.shelf.update({ where: { id }, data: { x, y } })));
        const restored = await prisma.shelf.findMany({ where: { storeId: store.id }, select: { id: true, x: true, y: true }, orderBy: { id: "asc" } });
        console.log("Concurrent shelf restoration:", JSON.stringify({ original, restored }));
        expect(restored).toEqual(original);
      } finally {
        await prisma.store.delete({ where: { id: store.id } });
      }
    }
  }
});
