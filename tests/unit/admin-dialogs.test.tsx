// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminEntityDialog } from "@/components/admin/admin-entity-dialog";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { Toaster } from "@/components/ui/sonner";

let root: Root;
let host: HTMLDivElement;
let opener: HTMLButtonElement;
let fallback: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  opener = document.createElement("button"); opener.textContent = "Mở";
  fallback = document.createElement("button"); fallback.textContent = "Danh sách";
  document.body.append(opener, fallback, host);
  opener.focus();
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); opener.remove(); fallback.remove();
  vi.unstubAllGlobals();
});
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button, [role=alertdialog] button")];
const button = (text: string) => buttons().find((item) => item.textContent === text)!;
async function dismiss() {
  // Radix arms its document outside-pointer listener on the next timer turn.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  await act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    document.querySelector(".ui-dialog-overlay, .ui-alert-dialog-overlay")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    document.querySelector<HTMLElement>(".ui-dialog-overlay, .ui-alert-dialog-overlay")?.click();
  });
}

// Removing pending guards would permit duplicate writes or dismissal before the write finishes.
describe.each(["entity", "confirm"] as const)("Admin %s dialog", (kind) => {
  async function renderDialog(props: { pending?: boolean; onSubmit?: () => Promise<boolean>; onOpenChange?: (open: boolean) => void } = {}) {
    const shared = { open: true, title: "Sửa cửa hàng", description: "Thông tin cửa hàng", openerRef: { current: opener }, fallbackFocusRef: { current: fallback }, onOpenChange: vi.fn(), onSubmit: async () => true, ...props };
    await act(async () => root.render(<><Toaster />{kind === "entity"
      ? <AdminEntityDialog {...shared}><input aria-label="Tên" defaultValue="BHX Quận 2" /></AdminEntityDialog>
      : <AdminConfirmDialog {...shared} confirmLabel="Xóa" />}</>));
    return shared;
  }
  it("disables submit/cancel and ignores Escape/outside dismissal while externally pending", async () => {
    const props = await renderDialog({ pending: true });
    expect(buttons().length).toBeGreaterThanOrEqual(2);
    expect(buttons().every((item) => item.disabled)).toBe(true);
    await dismiss();
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(document.querySelector("[role=dialog], [role=alertdialog]")).not.toBeNull();
  });
  it("locks synchronously against duplicate submit until success then closes once", async () => {
    let resolve!: (value: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    const props = await renderDialog({ onSubmit });
    await act(async () => {
      if (kind === "entity") {
        const form = document.querySelector("form")!;
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      } else { button("Xóa").click(); button("Xóa").click(); }
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(buttons().every((item) => item.disabled)).toBe(true);
    await dismiss();
    expect(props.onOpenChange).not.toHaveBeenCalled();
    await act(async () => resolve(true));
    expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });
  it.each(["false", "throw"])("keeps values and allows retry after %s failure", async (failure) => {
    const onSubmit = vi.fn(async () => { if (failure === "throw") throw new Error("Máy chủ đang bận"); return false; });
    const props = await renderDialog({ onSubmit });
    await act(async () => button(kind === "entity" ? "Lưu" : "Xóa").click());
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(button("Hủy").disabled).toBe(false);
    if (kind === "entity") expect(document.querySelector<HTMLInputElement>("input")?.value).toBe("BHX Quận 2");
    if (failure === "throw") expect(document.body.textContent).toContain("Máy chủ đang bận");
    await act(async () => button(kind === "entity" ? "Lưu" : "Xóa").click());
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
  it("dismisses an idle dialog with Escape", async () => {
    const props = await renderDialog();
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });
  if (kind === "entity") it("dismisses an idle entity dialog from the backdrop", async () => {
    const props = await renderDialog();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    await act(async () => {
      document.querySelector(".ui-dialog-overlay")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
      document.querySelector<HTMLElement>(".ui-dialog-overlay")!.click();
    });
    expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("allows idle cancel", async () => {
    const props = await renderDialog();
    await act(async () => button("Hủy").click());
    expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });
  it.each([true, false])("restores focus after close (opener connected: %s)", async (connected) => {
    await renderDialog();
    if (!connected) opener.remove();
    await act(async () => root.render(null));
    // Radix schedules focus restoration after releasing the focus trap.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(document.activeElement).toBe(connected ? opener : fallback);
  });
});
