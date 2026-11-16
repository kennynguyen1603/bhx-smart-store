const DEFAULT_STORE_TIME_ZONE = "Asia/Ho_Chi_Minh";
const MILLISECONDS_PER_DAY = 86_400_000;

/** Empty persisted zones use the store default; non-empty invalid zones throw RangeError. */
export function daysUntilStoreDate(date: Date, now: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
    timeZone: timeZone.trim() === "" ? DEFAULT_STORE_TIME_ZONE : timeZone,
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")!.value);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  const day = Number(parts.find((part) => part.type === "day")!.value);
  // @db.Date values encode a calendar date in UTC, not a store-local instant.
  const targetDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MILLISECONDS_PER_DAY;
  const storeDay = Date.UTC(year, month - 1, day) / MILLISECONDS_PER_DAY;
  return targetDay - storeDay;
}
