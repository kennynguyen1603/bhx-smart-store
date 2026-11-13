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
export type GridRect = Point & { width: number; height: number };

type RouteOptions = {
  width: number;
  height: number;
  obstacles: GridRect[];
};

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

function key(point: Point) {
  return `${point.x},${point.y}`;
}

function rectDistance(point: Point, rect: GridRect) {
  const right = rect.x + Math.max(1, rect.width) - 1;
  const bottom = rect.y + Math.max(1, rect.height) - 1;
  const dx = point.x < rect.x ? rect.x - point.x : point.x > right ? point.x - right : 0;
  const dy = point.y < rect.y ? rect.y - point.y : point.y > bottom ? point.y - bottom : 0;
  return dx + dy;
}

/**
 * Finds the shortest walkable route to the aisle next to a shelf. Sections,
 * shelves and store facilities are treated as solid fixtures, so the route
 * never cuts through a display just to reach the target coordinate.
 */
export function routeToShelf(start: Point, target: GridRect, options: RouteOptions) {
  const blocked = new Set<string>();
  for (const rect of options.obstacles) {
    for (let y = Math.max(0, rect.y); y < Math.min(options.height, rect.y + Math.max(1, rect.height)); y += 1) {
      for (let x = Math.max(0, rect.x); x < Math.min(options.width, rect.x + Math.max(1, rect.width)); x += 1) {
        blocked.add(key({ x, y }));
      }
    }
  }
  blocked.delete(key(start));

  const walkable = Array.from({ length: options.width * options.height }, (_, index) => ({
    x: index % options.width,
    y: Math.floor(index / options.width),
  })).filter((point) => !blocked.has(key(point)));
  const nearestDistance = Math.min(...walkable.map((point) => rectDistance(point, target)));
  const destinations = new Set(walkable.filter((point) => rectDistance(point, target) === nearestDistance).map(key));

  const queue: Point[] = [{ ...start }];
  const parent = new Map<string, Point | null>([[key(start), null]]);
  const directions = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }];
  let destination: Point | null = null;

  while (queue.length) {
    const current = queue.shift()!;
    if (destinations.has(key(current))) {
      destination = current;
      break;
    }
    for (const direction of directions) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      const nextKey = key(next);
      if (next.x < 0 || next.y < 0 || next.x >= options.width || next.y >= options.height || blocked.has(nextKey) || parent.has(nextKey)) continue;
      parent.set(nextKey, current);
      queue.push(next);
    }
  }

  if (!destination) {
    destination = Array.from(parent.keys())
      .map((value) => {
        const [x, y] = value.split(",").map(Number);
        return { x, y };
      })
      .sort((a, b) => rectDistance(a, target) - rectDistance(b, target))[0] || start;
  }

  const route: Point[] = [];
  let cursor: Point | null = destination;
  while (cursor) {
    route.push(cursor);
    cursor = parent.get(key(cursor)) || null;
  }
  route.reverse();
  return { route, destination };
}
