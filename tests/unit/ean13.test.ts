// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BinaryBitmap, EAN13Reader, HybridBinarizer, RGBLuminanceSource } from "@zxing/library";
import { describe, expect, it } from "vitest";
import { ean13CheckDigit, encodeEan13Modules, isValidEan13 } from "@/lib/ean13";
import { Ean13Barcode } from "@/components/ean13-barcode";

const demoCodes = [
  "8934673574211", "8934563138165", "8934673103220", "2900014825737",
  "8934868179078", "8938502520165", "2900012345671", "2900019876543",
  "8935054700014", "3073781164992", "8936036024050", "8936136160054",
  "8934868106876", "8935001700234",
];

describe("EAN-13 validation", () => {
  it.each(demoCodes)("validates corrected demo code %s", (code) => {
    expect(isValidEan13(code)).toBe(true);
    expect(ean13CheckDigit(code.slice(0, 12))).toBe(code[12]);
  });

  it("seeds exactly the corrected codes without changing their first twelve digits", () => {
    const seed = readFileSync("prisma/seed.ts", "utf8");
    expect([...seed.matchAll(/barcode: "(\d+)"/g)].map((match) => match[1])).toEqual(demoCodes);
  });

  it.each(["", "893467357421", "89346735742111", "893467357421x", "8934673574213", " 8934673574211"])("rejects invalid input %j", (code) => {
    expect(isValidEan13(code)).toBe(false);
    expect(() => encodeEan13Modules(code)).toThrow();
  });

  it.each(["", "12345678901", "1234567890123", "12345678901x"])("rejects invalid check-digit input %j", (value) => {
    expect(() => ean13CheckDigit(value)).toThrow();
  });
});

it("encodes the known 4006381333931 fixture including exact guards and parity", () => {
  const bits = encodeEan13Modules("4006381333931").map(Number).join("");
  expect(bits).toHaveLength(95);
  expect(bits.slice(0, 3)).toBe("101");
  expect(bits.slice(45, 50)).toBe("01010");
  expect(bits.slice(92)).toBe("101");
  expect(bits).toBe("101" + "0001101" + "0100111" + "0101111" + "0111101" + "0001001" + "0110011" + "01010" + "1000010" + "1000010" + "1000010" + "1110100" + "1000010" + "1100110" + "101");
});

it("preserves exact digits in the SVG accessible name and optional visible text", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(Ean13Barcode, { value: demoCodes[0], height: 72 }));
  const svg = host.querySelector("svg")!;
  expect(svg.getAttribute("role")).toBe("img");
  expect(svg.getAttribute("aria-label")).toContain(demoCodes[0]);
  expect(svg.querySelector("text")?.textContent).toBe(demoCodes[0]);
  expect(svg.getAttribute("viewBox")).toBeTruthy();
  expect(host.querySelector("canvas")).toBeNull();
  host.innerHTML = renderToStaticMarkup(createElement(Ean13Barcode, { value: demoCodes[0], showText: false }));
  expect(host.querySelector("text")).toBeNull();
  expect(host.querySelector("svg")?.getAttribute("aria-label")).toContain(demoCodes[0]);
});

// Rasterize the actual SVG rectangles, including its quiet zones, then decode
// with the same installed ZXing library used by the camera scanner.
it.each([...demoCodes, "0000000000000", "1000000000009", "2000000000008", "3000000000007", "4000000000006", "5000000000005", "6000000000004", "7000000000003", "8000000000002", "9000000000001"])("decodes rendered SVG %s back to the exact digits", (value) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(Ean13Barcode, { value, showText: false }));
  const svg = host.querySelector("svg")!;
  const [, , viewWidth, viewHeight] = svg.getAttribute("viewBox")!.split(" ").map(Number);
  const scale = 3;
  const width = viewWidth * scale;
  const height = viewHeight * scale;
  const pixels = new Int32Array(width * height).fill(0xffffff);
  for (const rect of svg.querySelectorAll("rect")) {
    if (rect.getAttribute("fill") !== "#000") continue;
    const [x, y, w, h] = ["x", "y", "width", "height"].map((attr) => Number(rect.getAttribute(attr)) * scale);
    for (let row = y; row < y + h; row++) pixels.fill(0, row * width + x, row * width + x + w);
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, height)));
  expect(new EAN13Reader().decode(bitmap).getText()).toBe(value);
});
