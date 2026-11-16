"use client";
import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AdminDialogProps } from "./admin-types";
import { useAdminDialogState } from "./admin-dialog-state";

export type AdminEntityDialogProps = AdminDialogProps & { children: ReactNode; submitLabel?: string };
export function AdminEntityDialog({ children, submitLabel = "Lưu", ...props }: AdminEntityDialogProps) {
  const state = useAdminDialogState(props);
  return <Dialog open={props.open} onOpenChange={state.changeOpen}>
    <DialogContent className="admin-dialog-content" showCloseButton={false} onOpenAutoFocus={state.captureFocus} onCloseAutoFocus={state.restoreFocus} onEscapeKeyDown={state.preventPendingDismiss} onInteractOutside={state.preventPendingDismiss}>
      <DialogHeader><DialogTitle>{props.title}</DialogTitle><DialogDescription>{props.description}</DialogDescription></DialogHeader>
      <form className="admin-dialog-form" aria-busy={state.busy} onSubmit={(event) => { event.preventDefault(); void state.submit(); }}>
        <fieldset className="admin-dialog-body" disabled={state.busy}>{children}</fieldset>
        <DialogFooter>
          <Button variant="outline" disabled={state.busy} onClick={() => state.changeOpen(false)}>Hủy</Button>
          <Button type="submit" disabled={state.busy}>{state.busy ? <><LoaderCircle className="ui-spinner" size={16} aria-hidden="true" />Đang xử lý…</> : submitLabel}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
