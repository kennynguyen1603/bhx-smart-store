import { describe, expect, it } from "vitest";
import { daysUntilStoreDate } from "@/lib/store-calendar";

describe("daysUntilStoreDate", () => {
  it.each([
    ["Asia/Ho_Chi_Minh", 0],
    ["UTC", 1],
  ])("compares a database date with the current calendar day in %s", (timeZone, expected) => {
    expect(daysUntilStoreDate(new Date("2026-11-16"), new Date("2026-11-15T17:30:00Z"), timeZone)).toBe(expected);
  });

  it("keeps the database date's UTC calendar fields in a timezone west of UTC", () => {
    expect(daysUntilStoreDate(new Date("2026-11-16"), new Date("2026-11-15T18:00:00Z"), "America/New_York")).toBe(1);
  });

  it.each([
    ["2026-11-15", "2026-11-15T17:30:00Z", "Asia/Ho_Chi_Minh", -1],
    ["2027-01-01", "2026-12-31T12:00:00Z", "UTC", 1],
    ["2028-03-01", "2028-02-28T12:00:00Z", "UTC", 2],
    ["2026-03-09", "2026-03-07T17:00:00Z", "America/New_York", 2],
  ])("compares calendar days for %s at %s in %s", (date, now, timeZone, expected) => {
    expect(daysUntilStoreDate(new Date(date), new Date(now), timeZone)).toBe(expected);
  });

  it.each(["", "   "])("uses the store default for empty timezone %j", (timeZone) => {
    expect(daysUntilStoreDate(new Date("2026-11-16"), new Date("2026-11-15T17:30:00Z"), timeZone)).toBe(0);
  });
  it("rejects a non-empty invalid persisted timezone", () => {
    expect(() => daysUntilStoreDate(new Date("2026-11-16"), new Date("2026-11-15T17:30:00Z"), "not/a-timezone")).toThrow(RangeError);
  });
});
