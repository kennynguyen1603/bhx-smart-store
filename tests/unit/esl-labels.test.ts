// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import QRCode from "qrcode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskStatus } from "@/generated/prisma/enums";
import { activeTaskBadges, encodeEslLabelQr, loadEslLabels } from "@/lib/esl-labels";

// Only the database I/O boundary is replaced; mapping and QR encoding run for real.
const db = vi.hoisted(() => ({ store: { findMany: vi.fn() }, eSL: { findMany: vi.fn() }, task: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: db }));

const stores = [{ id: "store-a", code: "A", name: "An Bình" }, { id: "store-b", code: "B", name: "Bình An" }];
const assignment = {
  id: "esl-1", code: "ESL-A-01", storeId: "store-a", shelfId: "shelf-a", productId: "product-a",
  shelf: { id: "shelf-a", code: "A-01", label: "Kệ sữa" }, product: { id: "product-a", name: "Sữa tươi" },
};
const task = { storeId: "store-a", shelfId: "shelf-a", productId: "product-a", type: "RESTOCK", status: "OPEN" };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  db.store.findMany.mockResolvedValue(stores);
  db.eSL.findMany.mockResolvedValue([assignment]);
  db.task.findMany.mockResolvedValue([]);
});

describe("activeTaskBadges", () => {
  it.each([TaskStatus.OPEN, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED])("includes %s tasks", (status) => {
    expect(activeTaskBadges([{ type: "FEFO", status }])).toEqual(["FEFO"]);
  });

  it.each([TaskStatus.COMPLETED, TaskStatus.CANCELLED])("excludes %s tasks", (status) => {
    expect(activeTaskBadges([{ type: "RESTOCK", status }])).toEqual([]);
  });

  it("deduplicates active types in RESTOCK, FEFO, QUARANTINE order", () => {
    expect(activeTaskBadges([
      { type: "QUARANTINE", status: "BLOCKED" },
      { type: "FEFO", status: "IN_PROGRESS" },
      { type: "RESTOCK", status: "OPEN" },
      { type: "FEFO", status: "OPEN" },
      { type: "QUARANTINE", status: "COMPLETED" },
    ])).toEqual(["RESTOCK", "FEFO", "QUARANTINE"]);
  });

  it("returns an empty badge list for the no-task presentation", () => {
    expect(activeTaskBadges([])).toEqual([]);
  });
});

describe("encodeEslLabelQr", () => {
  it("passes the raw code unchanged with M error correction", async () => {
    const encoder = vi.fn().mockResolvedValue("data:image/png;base64,UVI=");
    expect(await encodeEslLabelQr("  ESL-NT-Q5-L-02  ", encoder)).toEqual({ dataUrl: "data:image/png;base64,UVI=", error: "" });
    expect(encoder).toHaveBeenCalledExactlyOnceWith("  ESL-NT-Q5-L-02  ", { errorCorrectionLevel: "M", width: 320, margin: 2 });
  });

  it.each(["reject", "throw"])("contains an encoder %s with a manual-code instruction", async (failure) => {
    const encoder = () => {
      if (failure === "throw") throw new Error("private encoder details");
      return Promise.reject(new Error("private encoder details"));
    };
    expect(await encodeEslLabelQr("ESL-FAIL", encoder)).toEqual({
      dataUrl: "",
      error: "Không thể tạo mã QR lúc này. Hãy dùng mã ESL bên dưới để nhập thủ công.",
    });
  });

  it("generates a PNG with the default server encoder", async () => {
    const result = await encodeEslLabelQr("ESL-NT-Q5-L-02");
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.error).toBe("");
  });
});

describe("loadEslLabels", () => {
  it.each([undefined, "missing", "inactive-store"])("defaults %s to the first active store ordered by name", async (storeId) => {
    const result = await loadEslLabels(storeId);
    expect(db.store.findMany).toHaveBeenCalledWith({
      where: { active: true }, select: { id: true, code: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    expect(result.stores).toEqual(stores);
    expect(result.selectedStoreId).toBe("store-a");
    expect(result.labels[0]).toMatchObject({ code: "ESL-A-01", store: stores[0], shelf: assignment.shelf, product: assignment.product, badges: [], error: "" });
    expect(result.labels[0].dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(db.eSL.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { storeId: "store-a" }, orderBy: { code: "asc" } }));
  });

  it("selects a requested active store without aggregating stores", async () => {
    db.eSL.findMany.mockResolvedValue([{ ...assignment, storeId: "store-b" }]);
    const result = await loadEslLabels("store-b");
    expect(result.selectedStoreId).toBe("store-b");
    expect(result.labels[0].store).toEqual(stores[1]);
    expect(db.eSL.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { storeId: "store-b" } }));
  });

  it("returns a null selection and no labels without active stores", async () => {
    db.store.findMany.mockResolvedValue([]);
    expect(await loadEslLabels("inactive-store")).toEqual({ stores: [], selectedStoreId: null, labels: [] });
    expect(db.eSL.findMany).not.toHaveBeenCalled();
    expect(db.task.findMany).not.toHaveBeenCalled();
  });

  it("keeps a selected store with no assignments and skips the task query", async () => {
    db.eSL.findMany.mockResolvedValue([]);
    expect(await loadEslLabels()).toEqual({ stores, selectedStoreId: "store-a", labels: [] });
    expect(db.task.findMany).not.toHaveBeenCalled();
  });

  it("matches all three tuple fields and queries only active matching tasks", async () => {
    db.eSL.findMany.mockResolvedValue([assignment, { ...assignment, id: "esl-2", code: "ESL-A-02", shelfId: "shelf-b", shelf: { id: "shelf-b", code: "A-02", label: "Kệ khác" } }]);
    db.task.findMany.mockResolvedValue([
      task, { ...task, type: "FEFO", status: "BLOCKED" }, { ...task, type: "RESTOCK", status: "IN_PROGRESS" },
      { ...task, type: "QUARANTINE", storeId: "store-b" },
      { ...task, type: "QUARANTINE", shelfId: "shelf-b" },
      { ...task, type: "QUARANTINE", productId: "product-b" },
      { ...task, type: "QUARANTINE", status: "COMPLETED" },
      { ...task, type: "QUARANTINE", status: "CANCELLED" },
    ]);
    const result = await loadEslLabels();
    expect(result.labels.map((label) => label.badges)).toEqual([["RESTOCK", "FEFO"], ["QUARANTINE"]]);
    expect(db.task.findMany).toHaveBeenCalledWith({
      where: {
        storeId: "store-a", status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] },
        OR: [{ shelfId: "shelf-a", productId: "product-a" }, { shelfId: "shelf-b", productId: "product-a" }],
      },
      select: { storeId: true, shelfId: true, productId: true, type: true, status: true },
    });
  });

  it("preserves every assignment and manual code when one QR fails", async () => {
    db.eSL.findMany.mockResolvedValue([assignment, { ...assignment, id: "esl-2", code: "ESL-FAIL" }, { ...assignment, id: "esl-3", code: "ESL-A-03" }]);
    const realEncode = QRCode.toDataURL;
    vi.spyOn(QRCode, "toDataURL").mockImplementation((code, options) => {
      if (code === "ESL-FAIL") return Promise.reject(new Error("private encoder details"));
      return realEncode(code as string, options);
    });
    const result = await loadEslLabels();
    expect(result.labels.map((label) => label.code)).toEqual(["ESL-A-01", "ESL-FAIL", "ESL-A-03"]);
    expect(result.labels[0].dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.labels[2].dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.labels[1]).toMatchObject({
      code: "ESL-FAIL", store: stores[0], shelf: assignment.shelf, product: assignment.product, dataUrl: "",
      error: "Không thể tạo mã QR lúc này. Hãy dùng mã ESL bên dưới để nhập thủ công.",
    });
  });
});
async function renderPage(storeId?: string | string[]) {
  const { default: Page } = await import("@/app/demo/esl-labels/page");
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ storeId }) }));
  return container;
}

describe("public ESL label page", () => {
  it("renders a GET store filter, selected store, label count, and A4 control", async () => {
    db.eSL.findMany.mockResolvedValue([{ ...assignment, storeId: "store-b" }]);
    const page = await renderPage("store-b");
    expect(page.querySelector("h1")?.textContent).toContain("Nhãn ESL");
    expect(page.querySelector("form")?.getAttribute("method")?.toLowerCase()).toBe("get");
    expect(page.querySelector("select")?.name).toBe("storeId");
    expect(page.querySelector("select")?.value).toBe("store-b");
    expect(page.querySelector(".esl-label-count")?.textContent).toBe("1 nhãn");
    expect(page.querySelector(".esl-label-toolbar")?.textContent).toContain("In A4");
    expect(page.querySelector(".esl-label-card")?.textContent).toContain("Bình An");
  });

  it("renders QR, manual code, product, shelf, and the neutral no-active-task text", async () => {
    db.task.findMany.mockResolvedValue([{ ...task, status: "COMPLETED" }, { ...task, status: "CANCELLED" }]);
    const page = await renderPage();
    const card = page.querySelector(".esl-label-card")!;
    expect(card.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(card.querySelector("img")?.alt).toContain("ESL-A-01");
    expect(card.querySelector(".esl-label-code")?.textContent).toBe("ESL-A-01");
    for (const text of ["Sữa tươi", "A-01", "Kệ sữa", "An Bình", "Không có nhiệm vụ"]) expect(card.textContent).toContain(text);
    expect(card.querySelectorAll(".esl-label-badge")).toHaveLength(0);
  });

  it("renders distinct active badges in the required order", async () => {
    db.task.findMany.mockResolvedValue([{ ...task, type: "QUARANTINE", status: "BLOCKED" }, { ...task, type: "FEFO", status: "IN_PROGRESS" }, task, task]);
    const page = await renderPage();
    expect(Array.from(page.querySelectorAll(".esl-label-badge"), (badge) => badge.textContent)).toEqual(["RESTOCK", "FEFO", "QUARANTINE"]);
    expect(page.textContent).not.toContain("Không có nhiệm vụ");
  });

  it("renders a printable manual-code card alongside successful QR cards", async () => {
    db.eSL.findMany.mockResolvedValue([assignment, { ...assignment, id: "esl-2", code: "ESL-FAIL" }]);
    const realEncode = QRCode.toDataURL;
    vi.spyOn(QRCode, "toDataURL").mockImplementation((code, options) => code === "ESL-FAIL" ? Promise.reject(new Error("encoder failed")) : realEncode(code as string, options));
    const page = await renderPage();
    const cards = page.querySelectorAll(".esl-label-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector("img")).not.toBeNull();
    expect(cards[1].querySelector("img")).toBeNull();
    expect(cards[1].querySelector(".esl-label-code")?.textContent).toBe("ESL-FAIL");
    expect(cards[1].textContent).toContain("nhập thủ công");
    expect(cards[1].querySelector(".screen-only")).toBeNull();
  });

  it.each(["no stores", "no assignments"])("explains Admin setup when there are %s", async (empty) => {
    if (empty === "no stores") db.store.findMany.mockResolvedValue([]);
    else db.eSL.findMany.mockResolvedValue([]);
    const page = await renderPage();
    expect(page.querySelectorAll(".esl-label-card")).toHaveLength(0);
    const message = page.querySelector(".esl-label-empty")?.textContent;
    for (const text of ["Admin", "cửa hàng", "kệ", "sản phẩm", "ESL"]) expect(message).toContain(text);
    expect(page.querySelector<HTMLButtonElement>(".esl-label-print-button")?.disabled).toBe(true);
  });

  it("groups cards into sheets of at most four, preserving order", async () => {
    db.eSL.findMany.mockResolvedValue(Array.from({ length: 9 }, (_, i) => ({ ...assignment, id: `esl-${i}`, code: `ESL-${i}` })));
    const page = await renderPage();
    const sheets = page.querySelectorAll(".esl-label-sheet");
    expect(Array.from(sheets, (sheet) => sheet.querySelectorAll(".esl-label-card").length)).toEqual([4, 4, 1]);
    expect(Array.from(page.querySelectorAll(".esl-label-code"), (code) => code.textContent)).toEqual(["ESL-0", "ESL-1", "ESL-2", "ESL-3", "ESL-4", "ESL-5", "ESL-6", "ESL-7", "ESL-8"]);
  });

  it("treats repeated storeId parameters as invalid and uses the default store", async () => {
    const page = await renderPage(["store-b", "store-a"]);
    expect(page.querySelector("select")?.value).toBe("store-a");
  });

  it("calls window.print from the client print button", async () => {
    const { EslLabelPrintButton } = await import("@/components/esl-label-print-button");
    const print = vi.fn();
    vi.stubGlobal("print", print);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(EslLabelPrintButton)));
      expect(container.querySelector("button")?.textContent).toBe("In A4");
      await act(async () => container.querySelector("button")!.click());
      expect(print).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
