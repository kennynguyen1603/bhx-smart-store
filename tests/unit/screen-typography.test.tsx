// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { KioskApp } from "@/components/kiosk-app";

// Only camera hardware/decoding and API I/O are replaced; components and CSS are real.
vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    async decodeFromConstraints() { return { stop() {} }; }
  },
}));
const stylesheet = readFileSync("src/app/globals.css", "utf8");
const category = "Sữa & đồ lạnh";
const product = {
  id: "milk", sku: "MILK", barcode: "893000000001", name: "Sữa tươi Vinamilk 100% 1L", category,
  priceVnd: 27000, originalPriceVnd: 30000, markdownPercent: 10, emoji: "🥛",
  availability: "AVAILABLE", availabilityLabel: "Còn hàng",
  shelf: { id: "shelf", code: "L-02", label: "Kệ sữa", zone: "Đồ lạnh" },
};
let root: Root;
let host: HTMLDivElement;
let style: HTMLStyleElement;
const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("MediaStream", class {});
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    url === "/api/kiosk/bootstrap"
      ? { stores: [{ id: "store", code: "DEMO", name: "BHX Demo", address: "123 Demo" }], categories: [category] }
      : { products: [product] },
  ))));
  style = document.createElement("style");
  style.textContent = stylesheet;
  document.head.append(style);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); style.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (mediaDevicesDescriptor) Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});

function font(selector: string) {
  const element = host.querySelector(selector);
  expect(element, selector).not.toBeNull();
  return parseFloat(getComputedStyle(element!).fontSize);
}
function target(selector: string) {
  const elements = Array.from(host.querySelectorAll(selector));
  expect(elements.length, selector).toBeGreaterThan(0);
  for (const element of elements) {
    expect.soft(parseFloat(getComputedStyle(element).fontSize), `${selector} font`).toBeGreaterThanOrEqual(14);
    expect.soft(parseFloat(getComputedStyle(element).minHeight), `${selector} height`).toBeGreaterThanOrEqual(44);
  }
}

describe.each([320, 390, 1280])("screen typography at %ipx", (width) => {
  beforeEach(() => (window as unknown as Window).happyDOM.setViewport({ width, height: 900 }));

  it("keeps Kiosk category, search, and navigation controls readable and touchable", async () => {
    await act(async () => root.render(<KioskApp />));
    target(".category-grid button");
    expect.soft(font(".eyebrow"), "kiosk eyebrow").toBeGreaterThanOrEqual(12);
    target(".kiosk-search .button");
    expect.soft(font(".kiosk-search input")).toBeGreaterThanOrEqual(14);
    target(".kiosk-actions .button,.kiosk-actions select");
    for (const selector of [".kiosk-main > div:last-child", ".kiosk-page > div:last-of-type", ".kiosk-page .logo small"]) {
      expect.soft(font(selector), selector).toBeGreaterThanOrEqual(12);
    }
  });

  it("keeps product names/locations readable and secondary metadata at least 12px", async () => {
    await act(async () => root.render(<KioskApp />));
    await act(async () => host.querySelector<HTMLButtonElement>(".category-grid button")!.click());
    expect.soft(font(".product-card strong"), "product name").toBeGreaterThanOrEqual(14);
    expect.soft(font(".product-location"), "product location").toBeGreaterThanOrEqual(14);

    for (const selector of [".product-card small", ".original-price", ".discount-badge", ".availability"]) {
      expect.soft(font(selector), selector).toBeGreaterThanOrEqual(12);
    }
  });

  it("keeps product detail help and map route instructions readable", async () => {
    await act(async () => root.render(<KioskApp />));
    await act(async () => host.querySelector<HTMLButtonElement>(".category-grid button")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".product-card")!.click());
    expect.soft(font(".detail-help strong")).toBeGreaterThanOrEqual(14);
    expect.soft(font(".detail-help small")).toBeGreaterThanOrEqual(12);
    expect.soft(font(".detail-location-card strong")).toBeGreaterThanOrEqual(14);
  });

  it("keeps the active scanner instruction readable without enlarging map annotations", async () => {
    await act(async () => root.render(<BarcodeScanner onDetected={() => {}} />));
    for (const selector of [".scan-heading strong", ".scanner-placeholder strong"]) expect.soft(font(selector), selector).toBeGreaterThanOrEqual(14);
    for (const selector of [".scan-heading small", ".scanner-placeholder small", ".scan-status"]) expect.soft(font(selector), selector).toBeGreaterThanOrEqual(12);
    await act(async () => host.querySelector<HTMLButtonElement>(".scan-toggle")!.click());
    expect.soft(font(".scanner-loading strong"), "camera loading instruction").toBeGreaterThanOrEqual(14);
    await act(async () => host.querySelector("video")!.dispatchEvent(new Event("playing")));
    expect.soft(font(".scanner-frame span"), "active camera instruction").toBeGreaterThanOrEqual(14);
    target(".scan-toggle");
    const map = document.createElement("div");
    map.innerHTML = '<span class="map-shelf"><strong>L-02</strong></span><span class="map-facility">QUẦY THANH TOÁN</span>';
    host.append(map);
    expect(font(".map-shelf strong")).toBeLessThan(11);
    expect(font(".map-facility")).toBeLessThan(11);
    map.remove();
  });
});

it("preserves the physical print QR and card dimensions", async () => {
  const print = new Window({ settings: { device: { mediaType: "print" } } });
  print.document.body.innerHTML = `<style>${stylesheet}</style><main class="esl-label-page"><section class="esl-label-sheet"><article class="esl-label-card"><div class="esl-label-qr"></div></article></section></main>`;
  const qr = print.getComputedStyle(print.document.querySelector(".esl-label-qr")!);
  const barcode = print.document.createElement("main");
  barcode.className = "barcode-sheet-page";
  barcode.innerHTML = '<section class="barcode-sheet"><article class="barcode-card"><svg></svg></article></section>';
  print.document.body.append(barcode);
  const barcodeStyle = (selector: string) => print.getComputedStyle(print.document.querySelector(selector)!);
  expect(parseFloat(barcodeStyle(".barcode-sheet-page").width)).toBeCloseTo(190 * 96 / 25.4, 0);
  expect(parseFloat(barcodeStyle(".barcode-card").minHeight)).toBeCloseTo(64 * 96 / 25.4, 0);
  expect(parseFloat(barcodeStyle(".barcode-card svg").width)).toBeCloseTo(60 * 96 / 25.4, 0);
  expect(barcodeStyle(".barcode-card").breakInside).toBe("avoid");
  const card = print.getComputedStyle(print.document.querySelector(".esl-label-card")!);
  // happy-dom rounds physical-unit conversion; Chromium is checked separately.
  expect(parseFloat(qr.width)).toBeCloseTo(58 * 96 / 25.4, 0);
  expect(parseFloat(qr.height)).toBeCloseTo(58 * 96 / 25.4, 0);
  expect(parseFloat(card.minHeight)).toBeCloseTo(130 * 96 / 25.4, 0);
  await print.happyDOM.close();
});
