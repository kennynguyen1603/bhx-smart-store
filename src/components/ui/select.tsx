"use client";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;
export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return <SelectPrimitive.Trigger className={cn("ui-select-trigger", className)} {...props}>{children}<SelectPrimitive.Icon asChild><ChevronDown size={16} /></SelectPrimitive.Icon></SelectPrimitive.Trigger>;
}
export function SelectScrollUpButton({ className, ...props }: ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return <SelectPrimitive.ScrollUpButton className={cn("ui-select-scroll", className)} {...props}><ChevronUp size={16} /></SelectPrimitive.ScrollUpButton>;
}
export function SelectScrollDownButton({ className, ...props }: ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return <SelectPrimitive.ScrollDownButton className={cn("ui-select-scroll", className)} {...props}><ChevronDown size={16} /></SelectPrimitive.ScrollDownButton>;
}
export function SelectContent({ className, children, position = "popper", ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  return <SelectPrimitive.Portal><SelectPrimitive.Content className={cn("ui-select-content", className)} position={position} {...props}><SelectScrollUpButton /><SelectPrimitive.Viewport className="ui-select-viewport">{children}</SelectPrimitive.Viewport><SelectScrollDownButton /></SelectPrimitive.Content></SelectPrimitive.Portal>;
}
export function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label className={cn("ui-select-label", className)} {...props} />;
}
export function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item className={cn("ui-select-item", className)} {...props}><SelectPrimitive.ItemIndicator className="ui-select-indicator"><Check size={16} /></SelectPrimitive.ItemIndicator><SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText></SelectPrimitive.Item>;
}
export function SelectSeparator({ className, ...props }: ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn("ui-select-separator", className)} {...props} />;
}
