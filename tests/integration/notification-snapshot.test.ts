import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import { afterAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET } from "@/app/api/staff/tasks/route";
import { PATCH } from "@/app/api/staff/notifications/route";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("next-auth", () => ({ getServerSession: async () => auth.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
afterAll(() => prisma.$disconnect());

it("marks only the displayed unread snapshot, ignoring older, arriving, foreign, read and missing IDs", async () => {
  const run = randomUUID();
  const storeIds: string[] = [];
  const userIds: string[] = [];
  try {
    for (const suffix of ["own", "other"]) {
      const store = await prisma.store.create({ data: { code: `READ-${suffix}-${run}`, name: "Snapshot test", address: "Test only" } });
      storeIds.push(store.id);
      const user = await prisma.user.create({ data: { email: `${suffix}-${run}@snapshot.test`, name: "Snapshot staff", passwordHash: "unused", role: "STAFF" } });
      userIds.push(user.id);
    }
    const [storeId, otherStoreId] = storeIds;
    const [userId, otherUserId] = userIds;
    auth.session = { expires: "2099-01-01", user: { id: userId, role: "STAFF", storeIds: [storeId], defaultStoreId: storeId } };
    const base = { storeId, userId, type: "TASK_CREATED" as const, title: "Snapshot", body: "Test only" };
    const alreadyReadAt = new Date("2026-11-15T00:00:00Z");
    await prisma.notification.createMany({ data: Array.from({ length: 21 }, (_, i) => ({
      ...base, id: `${run}-${i}`, createdAt: new Date(Date.UTC(2026, 10, 16, 0, i)), readAt: i === 20 ? alreadyReadAt : null,
    })) });
    const feed = await GET(new Request(`http://localhost/api/staff/tasks?storeId=${storeId}`));
    expect(feed.status).toBe(200);
    const displayed = (await feed.json()).notifications as { id: string; readAt: string | null }[];
    expect(displayed).toHaveLength(20);
    expect(displayed.some((item) => item.id === `${run}-0`)).toBe(false);
    const ids = displayed.filter((item) => !item.readAt).map((item) => item.id);
    const arriving = await prisma.notification.create({ data: { ...base, createdAt: new Date("2026-11-16T01:00:00Z") } });
    const foreign = await prisma.notification.create({ data: { ...base, userId: otherUserId } });
    const otherStore = await prisma.notification.create({ data: { ...base, storeId: otherStoreId } });
    const response = await PATCH(new Request("http://localhost/api/staff/notifications", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, ids: [...ids, ids[0], foreign.id, otherStore.id, `${run}-20`, "nonexistent"] }),
    }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.updated).toBe(19);
    expect(await prisma.notification.count({ where: { id: { in: ids }, readAt: new Date(result.readAt) } })).toBe(19);
    const untouchedIds = [`${run}-0`, arriving.id, foreign.id, otherStore.id];
    expect(await prisma.notification.count({ where: { id: { in: untouchedIds }, readAt: null } })).toBe(4);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: `${run}-20` } })).readAt).toEqual(alreadyReadAt);
    const empty = await PATCH(new Request("http://localhost/api/staff/notifications", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ storeId, ids: [] }),
    }));
    expect(await empty.json()).toMatchObject({ updated: 0 });
  } finally {
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
});
