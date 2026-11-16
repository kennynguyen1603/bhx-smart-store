import { daysUntilStoreDate } from "@/lib/store-calendar";

export type PublicPriceLot = {
  status: "AVAILABLE" | "MARKED_DOWN" | "QUARANTINED" | "SOLD_OUT";
  quantity: number;
  expiryDate: Date;
  markdownPercent: number | null;
  markdownPriceVnd: number | null;
};

export type PublicPriceContext = { now: Date; timeZone: string };
export type PublicPrice = { priceVnd: number; originalPriceVnd: number; markdownPercent: number | null };

export function selectPublicPrice(basePriceVnd: number, lots: PublicPriceLot[], context: PublicPriceContext): PublicPrice {
  const lot = lots
    .filter(({ quantity, status, expiryDate }) => quantity > 0 && (status === "AVAILABLE" || status === "MARKED_DOWN") && daysUntilStoreDate(expiryDate, context.now, context.timeZone) > 0)
    .toSorted((left, right) => left.expiryDate.getTime() - right.expiryDate.getTime())[0];

  if (lot?.status === "MARKED_DOWN" && lot.markdownPriceVnd !== null && lot.markdownPercent !== null) {
    return { priceVnd: lot.markdownPriceVnd, originalPriceVnd: basePriceVnd, markdownPercent: lot.markdownPercent };
  }

  return { priceVnd: basePriceVnd, originalPriceVnd: basePriceVnd, markdownPercent: null };
}
