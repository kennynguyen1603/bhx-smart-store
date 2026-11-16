// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BarcodePage from "@/app/demo/barcodes/page";
import { BarcodePrintButton } from "@/components/barcode-print-button";

const db = vi.hoisted(() => ({ store: { findMany: vi.fn() }, inventory: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: db }));
const stores = [{ id: "a", name: "An Bình", code: "A" }, { id: "b", name: "Bình An", code: "B" }];
const inventory = { id: "inv", product: { id: "milk", name: "Sữa tươi", sku: "MILK-1L", barcode: "8934673574211" }, shelf: { code: "L-02", label: "Kệ sữa" } };
beforeEach(() => {
  db.store.findMany.mockResolvedValue(stores);
  db.inventory.findMany.mockResolvedValue([inventory]);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
async function render(storeId?: string | string[]) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(await BarcodePage({ searchParams: Promise.resolve({ storeId }) }));
  return host;
}

it.each([undefined, "missing", ["b", "a"]])("defaults invalid or missing store selection %j to the first active store", async (value) => {
  const host = await render(value);
  expect(db.store.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }));
  expect(db.inventory.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { storeId: "a", product: { active: true } } }));
  expect(host.querySelector("select")?.value).toBe("a");
});

it("renders active inventory products for the selected store with product and location metadata", async () => {
  const host = await render("b");
  expect(db.inventory.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { storeId: "b", product: { active: true } } }));
  const card = host.querySelector(".barcode-card")!;
  for (const text of ["Sữa tươi", "MILK-1L", "Bình An", "B", "L-02", "Kệ sữa", "8934673574211"]) expect(card.textContent).toContain(text);
  expect(card.querySelector('svg[role="img"]')?.getAttribute("aria-label")).toContain("8934673574211");
  expect(host.querySelector("form")?.getAttribute("action")).toBe("/demo/barcodes");
  expect(host.querySelector("select")?.getAttribute("name")).toBe("storeId");
});

it("paginates eight whole product labels per A4 sheet", async () => {
  db.inventory.findMany.mockResolvedValue(Array.from({ length: 14 }, (_, i) => ({ ...inventory, id: `inv-${i}` })));
  const host = await render();
  expect([...host.querySelectorAll(".barcode-sheet")].map((sheet) => sheet.querySelectorAll(".barcode-card").length)).toEqual([8, 6]);
});

it("shows an empty state and disables printing without inventory", async () => {
  db.inventory.findMany.mockResolvedValue([]);
  const host = await render();
  expect(host.querySelector(".barcode-empty")?.textContent).toContain("Chưa có");
  expect(host.querySelector<HTMLButtonElement>(".barcode-print-button")?.disabled).toBe(true);
});

it("does not query inventory when no active stores exist", async () => {
  db.store.findMany.mockResolvedValue([]);
  const host = await render();
  expect(db.inventory.findMany).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLSelectElement>("select")?.disabled).toBe(true);
});

it("keeps invalid inventory codes readable without publishing a false barcode", async () => {
  db.inventory.findMany.mockResolvedValue([{ ...inventory, product: { ...inventory.product, barcode: "invalid" } }]);
  const host = await render();
  expect(host.querySelector(".barcode-card")?.textContent).toContain("invalid");
  expect(host.querySelector(".barcode-error")?.textContent).toContain("EAN-13");
  expect(host.querySelector("svg")).toBeNull();
});

it("prints only when the enabled client print button is clicked", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const print = vi.fn();
  vi.stubGlobal("print", print);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<BarcodePrintButton />));
    await act(async () => host.querySelector("button")!.click());
    expect(print).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<BarcodePrintButton disabled />));
    await act(async () => host.querySelector("button")!.click());
    expect(print).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("uses A4 print dimensions and keeps labels whole without altering ESL dimensions", async () => {
  const sheet = new Window({ settings: { device: { mediaType: "print" } } });
  sheet.document.body.innerHTML = `<style>${readFileSync("src/app/globals.css", "utf8")}</style>${(await render()).innerHTML}<main class="esl-label-page"><article class="esl-label-card"><div class="esl-label-qr"></div></article></main>`;
  const style = (selector: string) => sheet.getComputedStyle(sheet.document.querySelector(selector)!);
  expect(parseFloat(style(".barcode-sheet-page").width)).toBeCloseTo(190 * 96 / 25.4, 0);
  expect(style(".barcode-card").breakInside).toBe("avoid");
  expect(style(".barcode-toolbar").display).toBe("none");
  expect(parseFloat(style(".esl-label-qr").width)).toBeCloseTo(58 * 96 / 25.4, 0);
  expect(parseFloat(style(".esl-label-card").minHeight)).toBeCloseTo(130 * 96 / 25.4, 0);
  await sheet.happyDOM.close();
});
