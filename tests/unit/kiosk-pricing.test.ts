import { describe, expect, it } from "vitest";
import { selectPublicPrice } from "@/lib/kiosk-pricing";

describe("selectPublicPrice", () => {
  const basePriceVnd = 32_600;

  it("returns the regular price for the earliest available lot", () => {
    expect(selectPublicPrice(basePriceVnd, [
      { status: "AVAILABLE", quantity: 4, expiryDate: new Date("2026-11-16"), markdownPercent: null, markdownPriceVnd: null },
      { status: "MARKED_DOWN", quantity: 4, expiryDate: new Date("2026-11-17"), markdownPercent: 20, markdownPriceVnd: 26_080 },
    ])).toEqual({ priceVnd: 32_600, originalPriceVnd: 32_600, markdownPercent: null });
  });

  it("returns the markdown from the earliest marked-down sellable lot", () => {
    expect(selectPublicPrice(basePriceVnd, [
      { status: "MARKED_DOWN", quantity: 4, expiryDate: new Date("2026-11-16"), markdownPercent: 20, markdownPriceVnd: 26_080 },
      { status: "AVAILABLE", quantity: 4, expiryDate: new Date("2026-11-17"), markdownPercent: null, markdownPriceVnd: null },
    ])).toEqual({ priceVnd: 26_080, originalPriceVnd: 32_600, markdownPercent: 20 });
  });

  it("excludes quarantined and zero-quantity lots", () => {
    expect(selectPublicPrice(basePriceVnd, [
      { status: "QUARANTINED", quantity: 3, expiryDate: new Date("2026-11-14"), markdownPercent: 50, markdownPriceVnd: 16_300 },
      { status: "MARKED_DOWN", quantity: 0, expiryDate: new Date("2026-11-15"), markdownPercent: 30, markdownPriceVnd: 22_820 },
      { status: "MARKED_DOWN", quantity: 2, expiryDate: new Date("2026-11-16"), markdownPercent: 20, markdownPriceVnd: 26_080 },
    ])).toEqual({ priceVnd: 26_080, originalPriceVnd: 32_600, markdownPercent: 20 });
  });

  it("falls back to the base price when no sellable lot exists", () => {
    expect(selectPublicPrice(basePriceVnd, [
      { status: "SOLD_OUT", quantity: 8, expiryDate: new Date("2026-11-16"), markdownPercent: null, markdownPriceVnd: null },
      { status: "AVAILABLE", quantity: 0, expiryDate: new Date("2026-11-17"), markdownPercent: null, markdownPriceVnd: null },
    ])).toEqual({ priceVnd: 32_600, originalPriceVnd: 32_600, markdownPercent: null });
  });
});
