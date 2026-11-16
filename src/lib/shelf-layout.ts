export type ShelfRect = { id: string; x: number; y: number; width: number; height: number };
export type MapBounds = { width: number; height: number };

export function validateShelfPlacement(
  candidate: ShelfRect,
  shelves: ShelfRect[],
  bounds: MapBounds,
): { valid: true } | { valid: false; reason: "out-of-bounds" | "occupied" } {
  if (candidate.x < 0 || candidate.y < 0 || candidate.x + candidate.width > bounds.width || candidate.y + candidate.height > bounds.height) {
    return { valid: false, reason: "out-of-bounds" };
  }
  if (shelves.some((shelf) => shelf.id !== candidate.id
    && candidate.x < shelf.x + shelf.width && candidate.x + candidate.width > shelf.x
    && candidate.y < shelf.y + shelf.height && candidate.y + candidate.height > shelf.y)) {
    return { valid: false, reason: "occupied" };
  }
  return { valid: true };
}
