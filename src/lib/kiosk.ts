import type { Inventory } from "@/generated/prisma/client";

export type Availability = "AVAILABLE" | "LOW" | "OUT";

export function availabilityOf(inventory: Pick<Inventory, "onShelf" | "lowThreshold">): Availability {
  if (inventory.onShelf <= 0) return "OUT";
  if (inventory.onShelf <= inventory.lowThreshold) return "LOW";
  return "AVAILABLE";
}

export function availabilityLabel(availability: Availability) {
  return { AVAILABLE: "Còn hàng", LOW: "Sắp hết", OUT: "Hết hàng" }[availability];
}

export type Point = { x: number; y: number };

export function gridRoute(start: Point, end: Point): Point[] {
  const points: Point[] = [{ ...start }];
  let x = start.x;
  let y = start.y;
  while (y !== end.y) {
    y += y < end.y ? 1 : -1;
    points.push({ x, y });
  }
  while (x !== end.x) {
    x += x < end.x ? 1 : -1;
    points.push({ x, y });
  }
  return points;
}
