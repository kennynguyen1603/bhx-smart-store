import { describe, expect, it } from "vitest";
import { availabilityLabel, availabilityOf, gridRoute, routeToShelf } from "@/lib/kiosk";

describe("kiosk availability", () => {
  it("never exposes exact quantities and maps stock to three public states", () => {
    expect(availabilityOf({ onShelf: 8, lowThreshold: 3 })).toBe("AVAILABLE");
    expect(availabilityOf({ onShelf: 3, lowThreshold: 3 })).toBe("LOW");
    expect(availabilityOf({ onShelf: 0, lowThreshold: 3 })).toBe("OUT");
    expect(availabilityLabel("LOW")).toBe("Sắp hết");
  });
});

describe("store map routing", () => {
  it("builds a continuous Manhattan route to the destination shelf", () => {
    const route = gridRoute({ x: 1, y: 7 }, { x: 8, y: 2 });
    expect(route[0]).toEqual({ x: 1, y: 7 });
    expect(route.at(-1)).toEqual({ x: 8, y: 2 });
    expect(route).toHaveLength(13);
    for (let index = 1; index < route.length; index += 1) {
      const distance = Math.abs(route[index].x - route[index - 1].x) + Math.abs(route[index].y - route[index - 1].y);
      expect(distance).toBe(1);
    }
  });

  it("routes through aisles and stops next to the target shelf", () => {
    const obstacles = [
      { x: 4, y: 2, width: 2, height: 4 },
      { x: 8, y: 2, width: 2, height: 4 },
      { x: 4, y: 7, width: 4, height: 1 },
    ];
    const { route, destination } = routeToShelf(
      { x: 0, y: 7 },
      { x: 4, y: 3, width: 1, height: 1 },
      { width: 12, height: 8, obstacles },
    );
    const blocked = new Set(obstacles.flatMap((rect) => Array.from({ length: rect.width * rect.height }, (_, index) => `${rect.x + index % rect.width},${rect.y + Math.floor(index / rect.width)}`)));

    expect(route[0]).toEqual({ x: 0, y: 7 });
    expect(destination).toEqual({ x: 3, y: 3 });
    expect(route.every((point) => !blocked.has(`${point.x},${point.y}`))).toBe(true);
    for (let index = 1; index < route.length; index += 1) {
      expect(Math.abs(route[index].x - route[index - 1].x) + Math.abs(route[index].y - route[index - 1].y)).toBe(1);
    }
  });
});
