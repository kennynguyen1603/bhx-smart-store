import { describe, expect, it } from "vitest";
import { selectPublicPrice, type PublicPriceContext, type PublicPriceLot } from "@/lib/kiosk-pricing";

describe("selectPublicPrice", () => {
  const basePriceVnd = 32_600;
  const context: PublicPriceContext = { now: new Date("2026-11-15T17:30:00Z"), timeZone: "Asia/Ho_Chi_Minh" };
  const regularLot: PublicPriceLot = { status: "AVAILABLE", quantity: 4, expiryDate: new Date("2026-11-17"), markdownPercent: null, markdownPriceVnd: null };
  const markdownLot: PublicPriceLot = { status: "MARKED_DOWN", quantity: 2, expiryDate: new Date("2026-11-17"), markdownPercent: 20, markdownPriceVnd: 26_080 };

  it("returns the regular price when the earliest valid lot precedes a markdown", () => {
    expect(selectPublicPrice(basePriceVnd, [
      { ...markdownLot, expiryDate: new Date("2026-11-18") },
      regularLot,
    ], context)).toEqual({ priceVnd: 32_600, originalPriceVnd: 32_600, markdownPercent: null });
  });

  it("returns current, original and percent prices from the earliest valid markdown", () => {
    expect(selectPublicPrice(basePriceVnd, [
      { ...regularLot, expiryDate: new Date("2026-11-18") },
      markdownLot,
    ], context)).toEqual({ priceVnd: 26_080, originalPriceVnd: 32_600, markdownPercent: 20 });
  });

  it.each([
    ["expiry day", { expiryDate: new Date("2026-11-16") }],
    ["past day", { expiryDate: new Date("2026-11-15") }],
    ["zero quantity", { quantity: 0 }],
    ["sold out", { status: "SOLD_OUT" as const }],
    ["quarantined", { status: "QUARANTINED" as const }],
  ])("excludes a lot on its %s", (_reason, override) => {
    expect(selectPublicPrice(basePriceVnd, [
      { ...markdownLot, markdownPercent: 50, markdownPriceVnd: 16_300, ...override },
      { ...regularLot, expiryDate: new Date("2026-11-18") },
    ], context)).toEqual({ priceVnd: 32_600, originalPriceVnd: 32_600, markdownPercent: null });
  });

  it("uses the store timezone to decide whether an expiry date is sellable", () => {
    const lots = [{ ...markdownLot, expiryDate: new Date("2026-11-16") }];
    expect(selectPublicPrice(basePriceVnd, lots, { ...context, timeZone: "UTC" })).toEqual({ priceVnd: 26_080, originalPriceVnd: 32_600, markdownPercent: 20 });
    expect(selectPublicPrice(basePriceVnd, lots, context)).toEqual({ priceVnd: 32_600, originalPriceVnd: 32_600, markdownPercent: null });
  });

  it.each([""])("excludes expiry-day markdowns with persisted timezone %j", (timeZone) => {
    expect(selectPublicPrice(basePriceVnd, [{ ...markdownLot, expiryDate: new Date("2026-11-16") }], { ...context, timeZone })).toEqual({ priceVnd: 32_600, originalPriceVnd: 32_600, markdownPercent: null });
  });

  it("rejects a non-empty invalid persisted timezone instead of choosing a store day", () => {
    expect(() => selectPublicPrice(basePriceVnd, [markdownLot], { ...context, timeZone: "invalid/timezone" })).toThrow(RangeError);
  });

  it("falls back to the base price when no lots exist", () => {
    expect(selectPublicPrice(basePriceVnd, [], context)).toEqual({ priceVnd: 32_600, originalPriceVnd: 32_600, markdownPercent: null });
  });
});
