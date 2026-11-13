import { describe, expect, it } from "vitest";
import { availabilityLabel, availabilityOf, gridRoute } from "@/lib/kiosk";

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
});
