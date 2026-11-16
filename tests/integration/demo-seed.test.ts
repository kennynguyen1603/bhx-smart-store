import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

// Run after npm run db:seed. These assertions inspect the real persisted demo.
describe("durable demo seed", () => {
  it.each(["NT-Q5", "LVV-TD"])("keeps explicit sellable and excluded lot scenarios in %s", async (code) => {
    const store = await prisma.store.findUniqueOrThrow({ where: { code } });
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: store.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const value = (type: string) => Number(parts.find((part) => part.type === type)!.value);
    const today = Date.UTC(value("year"), value("month") - 1, value("day"));
    const plusThree = new Date(today + 3 * 86_400_000);
    const lotsFor = (sku: string) => prisma.lot.findMany({ where: { storeId: store.id, product: { sku } }, orderBy: { expiryDate: "asc" } });

    for (const [sku, price] of [["GREENS-500", 14_320], ["BREAD-300", 22_800]] as const) {
      const [earliest] = await lotsFor(sku);
      expect(earliest, sku).toMatchObject({ status: "MARKED_DOWN", markdownPercent: 20, markdownPriceVnd: price, expiryDate: plusThree });
      expect(earliest.quantity).toBeGreaterThan(0);
    }
    for (const sku of ["YOGURT-4", "EGGS-10"]) {
      const [earliest] = await lotsFor(sku);
      expect(earliest, sku).toMatchObject({ status: "AVAILABLE", markdownPercent: null, markdownPriceVnd: null, expiryDate: plusThree });
      if (code === "NT-Q5") {
        const tasks = await prisma.task.findMany({ where: { lotId: earliest.id, type: "FEFO", status: "OPEN" } });
        expect(tasks, sku).toHaveLength(1);
        expect(tasks[0]).toMatchObject({ priority: "MEDIUM", note: `Lô ${earliest.batchCode} còn 3 ngày · Giảm 20%` });
      }
    }
    const [cheese] = await lotsFor("CHEESE-8");
    expect(cheese.status).toBe("AVAILABLE");
    expect(cheese.expiryDate.getTime()).toBeLessThan(today);
    if (code === "NT-Q5") {
      const tasks = await prisma.task.findMany({ where: { lotId: cheese.id, type: "QUARANTINE", status: "OPEN" } });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ priority: "HIGH", note: `Lô ${cheese.batchCode} đã hết hạn` });
    }
    const [earlierApple, laterApple] = await lotsFor("APPLE-1KG");
    expect(earlierApple).toMatchObject({ status: "SOLD_OUT", quantity: 0 });
    expect(laterApple).toMatchObject({ status: "AVAILABLE", markdownPercent: null, markdownPriceVnd: null });
    expect(laterApple.quantity).toBeGreaterThan(0);
    expect(laterApple.expiryDate.getTime()).toBeGreaterThan(earlierApple.expiryDate.getTime());
  });
});
