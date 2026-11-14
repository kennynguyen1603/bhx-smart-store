export type PublicPriceLot = {
  status: "AVAILABLE" | "MARKED_DOWN" | "QUARANTINED" | "SOLD_OUT";
  quantity: number;
  expiryDate: Date;
  markdownPercent: number | null;
  markdownPriceVnd: number | null;
};

export function selectPublicPrice(basePriceVnd: number, lots: PublicPriceLot[]): { priceVnd: number; originalPriceVnd: number; markdownPercent: number | null } {
  const lot = lots
    .filter(({ quantity, status }) => quantity > 0 && (status === "AVAILABLE" || status === "MARKED_DOWN"))
    .toSorted((left, right) => left.expiryDate.getTime() - right.expiryDate.getTime())[0];

  if (lot?.status === "MARKED_DOWN" && lot.markdownPriceVnd !== null && lot.markdownPercent !== null) {
    return { priceVnd: lot.markdownPriceVnd, originalPriceVnd: basePriceVnd, markdownPercent: lot.markdownPercent };
  }

  return { priceVnd: basePriceVnd, originalPriceVnd: basePriceVnd, markdownPercent: null };
}
