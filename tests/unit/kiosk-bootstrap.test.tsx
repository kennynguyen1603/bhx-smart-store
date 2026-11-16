// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { KioskApp } from "@/components/kiosk-app";

it("ignores a cleaned-up StrictMode bootstrap response after the customer selects another store", async () => {
  const pending: ((response: Response) => void)[] = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => pending.push(resolve)));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const payload = { stores: [
    { id: "first", code: "FIRST", name: "First Store", address: "First address" },
    { id: "second", code: "SECOND", name: "Second Store", address: "Second address" },
  ], categories: [] };
  try {
    await act(async () => root.render(<StrictMode><KioskApp /></StrictMode>));
    expect(pending).toHaveLength(2);
    await act(async () => pending[1](Response.json(payload)));
    const select = host.querySelector("select")!;
    await act(async () => {
      select.value = "SECOND";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(select.value).toBe("SECOND");
    await act(async () => pending[0](Response.json(payload)));
    expect(select.value).toBe("SECOND");
    expect(host.querySelector(".kiosk-location strong")!.textContent).toBe("Second Store");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
