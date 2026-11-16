"use client";
import { LoaderCircle } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { AdminDialogProps } from "./admin-types";
import { useAdminDialogState } from "./admin-dialog-state";

export type AdminConfirmDialogProps = AdminDialogProps & { confirmLabel?: string };
export function AdminConfirmDialog({ confirmLabel = "Xác nhận", ...props }: AdminConfirmDialogProps) {
  const state = useAdminDialogState(props);
  return <AlertDialog open={props.open} onOpenChange={state.changeOpen}>
    <AlertDialogContent className="admin-dialog-content" aria-busy={state.busy} onOpenAutoFocus={state.captureFocus} onCloseAutoFocus={state.restoreFocus} onEscapeKeyDown={state.preventPendingDismiss}>
      <AlertDialogHeader><AlertDialogTitle>{props.title}</AlertDialogTitle><AlertDialogDescription>{props.description}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={state.busy}>Hủy</AlertDialogCancel>
        <AlertDialogAction disabled={state.busy} onClick={(event) => { event.preventDefault(); void state.submit(); }}>{state.busy ? <><LoaderCircle className="ui-spinner" size={16} aria-hidden="true" />Đang xử lý…</> : confirmLabel}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
