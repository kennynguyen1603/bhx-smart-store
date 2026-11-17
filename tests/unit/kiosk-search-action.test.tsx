// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KioskApp } from "@/components/kiosk-app";

const category = "Sữa & đồ lạnh";
let root: Root;
let host: HTMLDivElement;
let requests: URL[];
let resolveSearch: (response: Response) => void;

beforeEach(async () => {
  requests = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Only API I/O is stubbed; pending search responses expose the real loading state.
  vi.stubGlobal("fetch", (url: string) => {
    if (url === "/api/kiosk/bootstrap") return Promise.resolve(Response.json({
      stores: [{ id: "store", code: "DEMO", name: "BHX Demo", address: "123 Demo" }],
      categories: [category],
    }));
    const request = new URL(url, "http://localhost");
    if (request.pathname !== "/api/kiosk/products/search") throw new Error(`Unexpected request: ${url}`);
    requests.push(request);
    return new Promise<Response>((resolve) => { resolveSearch = resolve; });
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<KioskApp />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function searchButton() {
  return host.querySelector<HTMLButtonElement>(".kiosk-search button:not([type=button])")!;
}

async function typeQuery(value: string) {
  const input = host.querySelector<HTMLInputElement>(".kiosk-search input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

async function finishSearch() {
  await act(async () => resolveSearch(Response.json({ products: [] })));
}

// Catches an idle action that offers text search when the query has no usable text.
it("offers all products for empty or whitespace input and search for typed text", async () => {
  expect(searchButton().disabled).toBe(false);
  expect(searchButton().textContent).toBe("Xem tất cả sản phẩm");
  await typeQuery("  sua tuoi  ");
  expect(searchButton().textContent).toBe("Tìm kiếm");
  await typeQuery("");
  expect(searchButton().textContent).toBe("Xem tất cả sản phẩm");
  await typeQuery("   ");
  expect(searchButton().textContent).toBe("Xem tất cả sản phẩm");
});

// Catches forwarding raw input to the API or displaying it in the results heading.
it("trims submitted text and keeps the loading action while the request is pending", async () => {
  await typeQuery("  sua tuoi  ");
  await submit();
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get("storeCode")).toBe("DEMO");
  expect(requests[0].searchParams.get("q")).toBe("sua tuoi");
  expect(searchButton().textContent).toBe("Đang tìm…");
  expect(searchButton().disabled).toBe(true);
  await finishSearch();
  expect(host.querySelector("h2")!.textContent).toBe("Kết quả cho “sua tuoi”");
});

// Catches whitespace being treated as a query instead of browsing the store.
it("omits q for whitespace and shows all-store results", async () => {
  await typeQuery("   ");
  await submit();
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.has("q")).toBe(false);
  expect(requests[0].searchParams.get("storeCode")).toBe("DEMO");
  await finishSearch();
  expect(host.querySelector("h2")!.textContent).toBe("Sản phẩm trong cửa hàng");
});

it("preserves the category argument instead of the typed query", async () => {
  await typeQuery("sua tuoi");
  await act(async () => host.querySelector<HTMLButtonElement>(".category-grid button")!.click());
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get("category")).toBe("Sữa & đồ lạnh");
  expect(requests[0].searchParams.has("q")).toBe(false);
  expect(requests[0].searchParams.has("exact")).toBe(false);
  await finishSearch();
});

it("preserves one exact HID barcode request", async () => {
  const input = host.querySelector<HTMLInputElement>(".kiosk-search input")!;
  await act(async () => {
    for (const key of "893000000001") input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get("q")).toBe("893000000001");
  expect(requests[0].searchParams.get("exact")).toBe("1");
  expect(requests[0].searchParams.has("category")).toBe(false);
  await finishSearch();
});
