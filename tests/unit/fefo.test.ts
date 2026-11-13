import { describe, expect, it } from "vitest";
import { daysRemaining } from "@/lib/business";

describe("FEFO day calculation", () => {
  it("uses calendar days so the result is stable across times of day", () => {
    const now = new Date("2026-11-13T16:30:00.000Z");
    expect(daysRemaining(new Date("2026-11-16T00:00:00.000Z"), now)).toBe(3);
    expect(daysRemaining(new Date("2026-11-13T00:00:00.000Z"), now)).toBe(0);
    expect(daysRemaining(new Date("2026-11-12T00:00:00.000Z"), now)).toBe(-1);
  });
});
