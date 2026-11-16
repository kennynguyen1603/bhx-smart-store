import { describe, expect, it } from "vitest";
import { validateShelfPlacement, type ShelfRect } from "@/lib/shelf-layout";

const bounds = { width: 8, height: 6 };
const shelf: ShelfRect = { id: "a", x: 1, y: 1, width: 2, height: 2 };
const neighbor: ShelfRect = { id: "b", x: 4, y: 2, width: 2, height: 3 };

describe("validateShelfPlacement", () => {
  it("accepts a free rectangle", () => {
    expect(validateShelfPlacement({ ...shelf, x: 0, y: 4 }, [shelf, neighbor], bounds)).toEqual({ valid: true });
  });
  it.each([{ x: -1 }, { y: -1 }, { x: 7 }, { y: 5 }])("rejects a rectangle clipping the map: %j", (position) => {
    expect(validateShelfPlacement({ ...shelf, ...position }, [], bounds)).toEqual({ valid: false, reason: "out-of-bounds" });
  });
  it("accepts exact right and bottom boundaries", () => {
    expect(validateShelfPlacement({ ...shelf, x: 6, y: 4 }, [], bounds)).toEqual({ valid: true });
  });
  it.each([{ x: 2, y: 2 }, { x: 4, y: 0 }, { x: 6, y: 2 }, { x: 4, y: 5 }])("allows edge touching: %j", (position) => {
    expect(validateShelfPlacement({ ...shelf, ...position }, [neighbor], { width: 8, height: 8 })).toEqual({ valid: true });
  });
  it.each([{ x: 3, y: 1 }, { x: 5, y: 4 }, { x: 4, y: 3 }])("rejects true rectangle overlap: %j", (position) => {
    expect(validateShelfPlacement({ ...shelf, ...position }, [neighbor], bounds)).toEqual({ valid: false, reason: "occupied" });
  });
  it("excludes the moving shelf even when its old and new rectangles overlap", () => {
    expect(validateShelfPlacement({ ...shelf, x: 2 }, [shelf], bounds)).toEqual({ valid: true });
  });
  it("allows unchanged geometry after self exclusion", () => {
    expect(validateShelfPlacement(shelf, [shelf, neighbor], bounds)).toEqual({ valid: true });
  });
});
