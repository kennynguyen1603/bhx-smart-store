"use client";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogPortal = AlertDialogPrimitive.Portal;
export function AlertDialogOverlay({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return <AlertDialogPrimitive.Overlay className={cn("ui-alert-dialog-overlay", className)} {...props} />;
}
export function AlertDialogContent({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return <AlertDialogPortal><AlertDialogOverlay /><AlertDialogPrimitive.Content className={cn("ui-alert-dialog-content", className)} {...props} /></AlertDialogPortal>;
}
export function AlertDialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("ui-dialog-header", className)} {...props} />;
}
export function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("ui-dialog-footer", className)} {...props} />;
}
export function AlertDialogTitle({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return <AlertDialogPrimitive.Title className={cn("ui-dialog-title", className)} {...props} />;
}
export function AlertDialogDescription({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return <AlertDialogPrimitive.Description className={cn("ui-dialog-description", className)} {...props} />;
}
export function AlertDialogAction({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return <AlertDialogPrimitive.Action className={cn(buttonVariants({ variant: "destructive" }), className)} {...props} />;
}
export function AlertDialogCancel({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return <AlertDialogPrimitive.Cancel className={cn(buttonVariants({ variant: "outline" }), className)} {...props} />;
}
