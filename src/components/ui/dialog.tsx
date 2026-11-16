"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;
export function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay className={cn("ui-dialog-overlay", className)} {...props} />;
}
export function DialogContent({ className, children, showCloseButton = true, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  return <DialogPortal><DialogOverlay /><DialogPrimitive.Content className={cn("ui-dialog-content", className)} {...props}>
    {children}
    {showCloseButton && <DialogClose asChild><Button variant="ghost" size="icon" className="ui-dialog-close" aria-label="Đóng"><X size={18} /></Button></DialogClose>}
  </DialogPrimitive.Content></DialogPortal>;
}
export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("ui-dialog-header", className)} {...props} />;
}
export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("ui-dialog-footer", className)} {...props} />;
}
export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("ui-dialog-title", className)} {...props} />;
}
export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("ui-dialog-description", className)} {...props} />;
}
