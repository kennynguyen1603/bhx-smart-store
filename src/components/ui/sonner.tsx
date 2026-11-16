"use client";
import { Toaster as Sonner, type ToasterProps } from "sonner";

export { toast } from "sonner";
export function Toaster(props: ToasterProps) {
  return <Sonner {...props} className="ui-toaster" position="top-right" richColors closeButton toastOptions={{ ...props.toastOptions, closeButtonAriaLabel: "Đóng thông báo" }} />;
}
