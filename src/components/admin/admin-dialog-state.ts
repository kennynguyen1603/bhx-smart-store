"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/sonner";
import type { AdminDialogProps } from "./admin-types";

/** Shared pending and focus behavior for both Admin shells. */
export function useAdminDialogState({ pending = false, onSubmit, onOpenChange, openerRef, fallbackFocusRef }: AdminDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  const capturedOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const busy = pending || submitting;
  function changeOpen(open: boolean) {
    if (!pending && !locked.current) onOpenChange(open);
  }
  async function submit() {
    if (pending || locked.current) return;
    locked.current = true;
    setSubmitting(true);
    try {
      const result = await onSubmit();
      if (!mounted.current) return;
      if (result === true || (typeof result === "object" && result.ok)) onOpenChange(false);
      else toast.error(typeof result === "object" && !result.ok && result.error ? result.error : "Không thể lưu thay đổi. Vui lòng thử lại.");
    } catch (error) {
      const transportFailure = error instanceof TypeError && /failed to fetch|fetch failed|load failed|networkerror|network request failed/i.test(error.message);
      if (mounted.current) toast.error(transportFailure
        ? "Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại."
        : error instanceof Error ? error.message : "Có lỗi xảy ra. Vui lòng thử lại.");
    } finally {
      locked.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }
  function captureFocus() {
    capturedOpener.current = openerRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }
  function restoreFocus(event: Event) {
    event.preventDefault();
    const opener = openerRef?.current ?? capturedOpener.current;
    const fallback = fallbackFocusRef?.current ?? document.querySelector<HTMLElement>("[data-admin-dialog-fallback]");
    // Body is also active when nothing can take focus, so it cannot prove restoration.
    if (opener?.isConnected && opener !== document.body && !opener.matches(":disabled")) {
      opener.focus();
      if (document.activeElement === opener) return;
    }
    if (fallback?.isConnected) fallback.focus();
  }
  function preventPendingDismiss(event: Event) {
    if (pending || locked.current) event.preventDefault();
  }
  return { busy, submit, changeOpen, captureFocus, restoreFocus, preventPendingDismiss };
}
