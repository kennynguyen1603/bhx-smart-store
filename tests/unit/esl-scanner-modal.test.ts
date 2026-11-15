// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { EslScannerModal, type TaskSummary } from "@/components/esl-scanner-modal";

// Camera and QR rendering are independent of the lookup lifecycle under test.
vi.mock("@/components/barcode-scanner", () => ({ BarcodeScanner: () => null }));
vi.mock("@/components/esl-qr-demo", () => ({ EslQrDemo: () => null }));

type PendingLookup = {
  signal: AbortSignal | null | undefined;
  resolve(response: Response): void;
  reject(error: Error): void;
};

const task: TaskSummary = {
  id: "task-old", type: "FEFO", status: "OPEN", priority: "NORMAL",
  title: "Old lookup task", note: null, createdAt: "2026-11-15T00:00:00Z", completedAt: null,
  assignee: null, product: { id: "product-1", name: "Milk", emoji: "🥛", basePriceVnd: 10_000 },
  shelf: { id: "shelf-1", code: "T-01", label: "Shelf 1", esls: [{ code: "ESL-OLD" }] },
  lot: null, inventory: null,
};

function response(code: string, tasks: TaskSummary[] = []) {
  return new Response(JSON.stringify({
    esl: { code, storeId: "store-1", shelfId: "shelf-1", productId: "product-1", product: { name: `Product ${code}` }, shelf: { label: "Shelf 1" } },
    inventory: null,
    tasks,
  }), { headers: { "Content-Type": "application/json" } });
}

describe("ESL scanner lookup cancellation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let pending: PendingLookup[];
  let onSelectTask: Mock<(task: TaskSummary) => void>;
  let onClose: Mock<() => void>;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    pending = [];
    // Deliberately allow responses after abort to exercise the generation guard.
    vi.stubGlobal("fetch", vi.fn((_url: string, options?: RequestInit) => new Promise<Response>((resolve, reject) => {
      pending.push({ signal: options?.signal, resolve, reject });
    })));
    onSelectTask = vi.fn();
    onClose = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(EslScannerModal, { storeId: "store-1", onSelectTask, onClose })));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function lookup(code: string) {
    const input = container.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, code);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  it.each(["success", "failure"])("aborts a superseded lookup and ignores its late %s", async (outcome) => {
    await lookup("ESL-OLD");
    await lookup("ESL-CURRENT");
    expect(pending).toHaveLength(2);
    expect(pending[0].signal).toBeInstanceOf(AbortSignal);
    expect(pending[0].signal?.aborted).toBe(true);
    expect(pending[1].signal?.aborted).toBe(false);

    await act(async () => pending[1].resolve(response("ESL-CURRENT")));
    await act(async () => {
      if (outcome === "success") pending[0].resolve(response("ESL-OLD", [task]));
      else pending[0].reject(new DOMException("Aborted", "AbortError"));
    });

    expect(container.querySelector(".esl-lookup-result")?.textContent).toContain("ESL-CURRENT");
    expect(container.querySelector("input")?.value).toBe("ESL-CURRENT");
    expect(container.querySelector(".alert-box")).toBeNull();
    expect(container.querySelector("form button")?.textContent).toBe("Tra cứu");
    expect(onSelectTask).not.toHaveBeenCalled();
  });

  it.each(["button", "backdrop", "unmount"])("aborts the active lookup on %s and ignores its late response", async (close) => {
    await lookup("ESL-OLD");
    expect(pending).toHaveLength(1);

    await act(async () => {
      if (close === "unmount") root.unmount();
      else if (close === "button") container.querySelector<HTMLButtonElement>(".modal-close")!.click();
      else container.querySelector(".modal-backdrop")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(pending[0].signal).toBeInstanceOf(AbortSignal);
    expect(pending[0].signal?.aborted).toBe(true);
    if (close !== "unmount") expect(onClose).toHaveBeenCalledOnce();
    await act(async () => pending[0].resolve(response("ESL-OLD", [task])));
    expect(onSelectTask).not.toHaveBeenCalled();
    expect(container.querySelector(".esl-lookup-result")).toBeNull();
    expect(container.querySelector(".alert-box")).toBeNull();
  });
});
