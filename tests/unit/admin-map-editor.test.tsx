// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminMapEditor, type AdminMapStore } from "@/components/admin/admin-map-editor";
import type { ApiMutationResult } from "@/components/admin/admin-types";

const store: AdminMapStore = {
  id: "store", mapWidth: 8, mapHeight: 6,
  shelves: [
    { id: "a", code: "A-01", label: "Kệ A", x: 1, y: 1, width: 2, height: 2, esls: [{ ledOn: true }] },
    { id: "b", code: "B-01", label: "Kệ B", x: 4, y: 2, width: 2, height: 3, esls: [] },
  ],
};
let root: Root;
let host: HTMLDivElement;
let onMove: ReturnType<typeof vi.fn<(id: string, x: number, y: number) => Promise<ApiMutationResult>>>;
let capture: ReturnType<typeof vi.fn>;
let release: ReturnType<typeof vi.fn>;
let captured: Set<number>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  onMove = vi.fn(async () => ({ ok: true, data: null }));
  captured = new Set();
  capture = vi.fn((id: number) => { captured.add(id); });
  release = vi.fn((id: number) => { captured.delete(id); });
  vi.spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(capture);
  vi.spyOn(HTMLElement.prototype, "releasePointerCapture").mockImplementation(release);
  vi.spyOn(HTMLElement.prototype, "hasPointerCapture").mockImplementation((id) => captured.has(id));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 100, top: 200, width: 800, height: 600, right: 900, bottom: 800, x: 100, y: 200, toJSON: () => ({}) });
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render(canEdit = true, value = store) {
  await act(async () => root.render(<AdminMapEditor store={value} canEdit={canEdit} onMove={onMove} />));
}
function shelf() { return host.querySelector<HTMLButtonElement>('button[aria-label="Kệ A-01"]')!; }
function cell(x: number, y: number) { return host.querySelector<HTMLButtonElement>(`button[aria-label="Ô ${x + 1}, ${y + 1}"]`)!; }
async function click(node: HTMLElement) { await act(async () => node.click()); }
async function pointer(type: string, x: number, y: number, id = 7) {
  await act(async () => shelf().dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: "touch", button: 0, clientX: x, clientY: y })));
}
function position(x: string, y: string) {
  expect(shelf().style.left).toBe(x); expect(shelf().style.top).toBe(y);
}
function deferred() {
  let resolve!: (value: ApiMutationResult) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ApiMutationResult>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("AdminMapEditor", () => {
  it.each([
    [250, 350, 8], [350, 350, 8], [250, 450, 8], [375, 475, 8],
    [250, 350, -8], [350, 350, -8], [250, 450, -8], [375, 475, -8],
  ])("preserves the grab offset from %s,%s with threshold step %s through preview and release", async (x, y, step) => {
    await render();
    await pointer("pointerdown", x, y);
    await pointer("pointermove", x + step, y + step);
    position("12.5%", `${1 / 6 * 100}%`);
    expect(onMove).not.toHaveBeenCalled();
    await pointer("pointermove", x + 100, y + 200);
    position("25%", "50%");
    // Release at a different cell from the last preview.
    await pointer("pointerup", x + 100, y + 300);
    position("25%", `${4 / 6 * 100}%`);
    expect(onMove).toHaveBeenCalledExactlyOnceWith("a", 2, 4);
  });
  it("uses the scrolled grid rectangle when preserving a multi-cell grab offset", async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ left: -44, top: 200, width: 528, height: 300, right: 484, bottom: 500, x: -44, y: 200, toJSON: () => ({}) });
    await render(true, { ...store, mapWidth: 12 });
    await pointer("pointerdown", 66, 275);
    await pointer("pointermove", 110, 425);
    position(`${2 / 12 * 100}%`, `${4 / 6 * 100}%`);
    await pointer("pointerup", 110, 425);
    expect(onMove).toHaveBeenCalledExactlyOnceWith("a", 2, 4);
  });
  it.each([{ columns: 8, minimum: "352px" }, { columns: 12, minimum: "528px" }])("keeps $columns-column placement targets at least 44px in a scroll container", async ({ columns, minimum }) => {
    await render(true, { ...store, mapWidth: columns });
    const stylesheet = document.createElement("style");
    stylesheet.textContent = readFileSync("src/app/globals.css", "utf8");
    document.head.append(stylesheet);
    try {
      const grid = host.querySelector<HTMLElement>('[aria-label="Sơ đồ vị trí kệ"]')!;
      const scroller = grid.parentElement!;
      expect(getComputedStyle(grid).minWidth).toBe(minimum);
      expect(grid.style.gridTemplateColumns).toBe(`repeat(${columns},minmax(44px,1fr))`);
      expect(getComputedStyle(scroller).overflowX).toBe("auto");
      expect(getComputedStyle(scroller).maxWidth).toBe("100%");
      expect(Number.parseFloat(getComputedStyle(scroller).minWidth)).toBe(0);
      for (const node of [cell(0, 0), shelf()]) {
        expect(getComputedStyle(node).minWidth).toBe("44px");
        expect(getComputedStyle(node).minHeight).toBe("44px");
      }
      expect(getComputedStyle(shelf()).touchAction).toBe("none");
      for (const node of [document.body, host.firstElementChild!, scroller, grid, cell(0, 0)]) {
        expect(getComputedStyle(node).touchAction).not.toBe("none");
      }
    } finally { stylesheet.remove(); }
  });
  it("captures a touch pointer, previews a snapped rectangle, and persists once on release", async () => {
    await render();
    await pointer("pointerdown", 250, 350);
    expect(capture).toHaveBeenCalledWith(7);
    await pointer("pointermove", 350, 650);
    position("25%", `${4 / 6 * 100}%`);
    expect(onMove).not.toHaveBeenCalled();
    await pointer("pointerup", 350, 650);
    await pointer("pointerup", 350, 650);
    // Browsers follow pointerup with click; this must not select the shelf again.
    await act(async () => shelf().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(onMove).toHaveBeenCalledExactlyOnceWith("a", 2, 4);
    expect(release).toHaveBeenCalledWith(7);
    expect(shelf().getAttribute("aria-pressed")).toBe("false");
  });
  it("keeps a small pointer movement as a tap and supports tap-select/tap-place", async () => {
    await render();
    await pointer("pointerdown", 250, 350); await pointer("pointermove", 252, 351); await pointer("pointerup", 252, 351);
    await click(shelf());
    expect(shelf().getAttribute("aria-pressed")).toBe("true");
    expect(shelf().getAttribute("aria-describedby")).toBeTruthy();
    expect(onMove).not.toHaveBeenCalled();
    await click(cell(2, 4));
    expect(onMove).toHaveBeenCalledExactlyOnceWith("a", 2, 4);
  });
  it.each([[1, 1], [4, 2], [3, 1], [7, 0], [0, 5]])("does not write unchanged, occupied, overlapping or clipped target %s,%s", async (x, y) => {
    await render(); await click(shelf()); await click(cell(x, y));
    expect(onMove).not.toHaveBeenCalled(); position("12.5%", `${1 / 6 * 100}%`);
  });
  it("rejects a drag released outside the map", async () => {
    await render(); await pointer("pointerdown", 250, 350); await pointer("pointermove", 50, 350); await pointer("pointerup", 50, 350);
    expect(onMove).not.toHaveBeenCalled(); position("12.5%", `${1 / 6 * 100}%`);
    expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });
  it("cancels selection on a second tap or Escape", async () => {
    await render(); await click(shelf()); await click(shelf()); await click(cell(2, 4));
    expect(onMove).not.toHaveBeenCalled();
    await click(shelf());
    await act(async () => shelf().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await click(cell(2, 4)); expect(onMove).not.toHaveBeenCalled();
    expect(shelf().getAttribute("aria-pressed")).toBe("false");
  });
  it.each(["pointercancel", "lostpointercapture"])("cancels a drag on %s without writing", async (type) => {
    await render(); await pointer("pointerdown", 250, 350); await pointer("pointermove", 350, 650); await pointer(type, 350, 650); await pointer("pointerup", 350, 650);
    expect(onMove).not.toHaveBeenCalled(); position("12.5%", `${1 / 6 * 100}%`);
  });
  it.each(["pointercancel", "lostpointercapture"])("keeps keyboard activation after %s", async (type) => {
    await render(); await pointer("pointerdown", 250, 350); await pointer("pointermove", 350, 650); await pointer(type, 350, 650);
    await click(shelf());
    expect(shelf().getAttribute("aria-pressed")).toBe("true");
    expect(onMove).not.toHaveBeenCalled();
  });
  it.each([false, true])("suppresses the residual pointer click after lost capture (drag=%s), then accepts keyboard activation", async (drag) => {
    await render(); await pointer("pointerdown", 250, 350);
    if (drag) await pointer("pointermove", 260, 360);
    captured.clear(); await pointer("lostpointercapture", 260, 360);
    await act(async () => shelf().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(shelf().getAttribute("aria-pressed")).toBe("false");
    await click(shelf());
    expect(shelf().getAttribute("aria-pressed")).toBe("true");
    expect(onMove).not.toHaveBeenCalled();
  });
  it("does not consume keyboard activation or disarm a later residual pointer click after lost capture", async () => {
    await render(); await pointer("pointerdown", 250, 350); await pointer("pointermove", 260, 360);
    captured.clear(); await pointer("lostpointercapture", 260, 360);
    await click(shelf());
    expect(shelf().getAttribute("aria-pressed")).toBe("true");
    await act(async () => shelf().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(shelf().getAttribute("aria-pressed")).toBe("true");
    expect(onMove).not.toHaveBeenCalled();
  });
  it("rejects an occupied target reached through the overlaid shelf handle", async () => {
    await render(); await click(shelf());
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="Kệ B-01"]')!);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Vị trí này đã có kệ khác.");
    expect(onMove).not.toHaveBeenCalled();
  });
  it("does not release capture again after the browser has already lost it", async () => {
    await render(); await pointer("pointerdown", 250, 350); await pointer("pointermove", 350, 650);
    captured.clear();
    await pointer("lostpointercapture", 350, 650);
    expect(release).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled(); position("12.5%", `${1 / 6 * 100}%`);
  });
  it("ignores other pointers during a captured gesture", async () => {
    await render(); await pointer("pointerdown", 250, 350); await pointer("pointermove", 350, 650, 8); await pointer("pointerup", 350, 650, 8);
    expect(onMove).not.toHaveBeenCalled();
    await pointer("pointermove", 350, 650); await pointer("pointerup", 350, 650);
    expect(onMove).toHaveBeenCalledExactlyOnceWith("a", 2, 4);
  });
  it("prevents non-Admin moves by either interaction", async () => {
    await render(false); await click(shelf()); await click(cell(2, 4));
    await pointer("pointerdown", 250, 350); await pointer("pointermove", 350, 650); await pointer("pointerup", 350, 650);
    expect(onMove).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled();
  });
  it("shows the optimistic target and ignores duplicate moves until persistence settles", async () => {
    const pending = deferred(); onMove.mockReturnValue(pending.promise);
    await render();
    await act(async () => { shelf().click(); cell(2, 4).click(); cell(0, 4).click(); });
    position("25%", `${4 / 6 * 100}%`);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Đang lưu");
    await click(shelf()); await click(cell(0, 4));
    expect(onMove).toHaveBeenCalledExactlyOnceWith("a", 2, 4);
    await act(async () => pending.resolve({ ok: true, data: null }));
    position("25%", `${4 / 6 * 100}%`);
    // The last confirmed local position is now a no-op, even before overview refresh.
    await click(shelf()); await click(cell(2, 4)); expect(onMove).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("rolls back a failed move with inline feedback (throw=%s)", async (throws) => {
    const pending = deferred(); onMove.mockReturnValue(pending.promise);
    await render(); await click(shelf()); await click(cell(2, 4)); position("25%", `${4 / 6 * 100}%`);
    await act(async () => {
      if (throws) pending.reject(new Error("Network connection closed"));
      else pending.resolve({ ok: false, message: "Không thể lưu vị trí kệ." });
    });
    position("12.5%", `${1 / 6 * 100}%`);
    expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    if (!throws) expect(host.querySelector('[role="alert"]')?.textContent).toContain("Không thể lưu vị trí kệ.");
    else expect(host.querySelector('[role="alert"]')?.textContent).toBe("Không thể lưu vị trí kệ. Vui lòng thử lại.");
    onMove.mockResolvedValue({ ok: true, data: null });
    await click(shelf()); await click(cell(2, 4)); expect(onMove).toHaveBeenCalledTimes(2);
  });
  it("resets selection and optimistic positions when switching stores", async () => {
    await render(); await click(shelf()); await click(cell(2, 4)); await click(shelf());
    await render(true, { ...store, id: "other" }); await click(cell(0, 4));
    position("12.5%", `${1 / 6 * 100}%`); expect(onMove).toHaveBeenCalledTimes(1);
  });
  it("trusts refreshed server positions even when they later return to the original coordinates", async () => {
    await render(); await click(shelf()); await click(cell(2, 4));
    await render(true, { ...store, shelves: store.shelves.map((item) => item.id === "a" ? { ...item, x: 2, y: 4 } : item) });
    position("25%", `${4 / 6 * 100}%`);
    await render(true, { ...store, shelves: store.shelves.map((item) => ({ ...item })) });
    position("12.5%", `${1 / 6 * 100}%`);
  });
});
