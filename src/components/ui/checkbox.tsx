"use client";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, checked, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return <CheckboxPrimitive.Root checked={checked} className={cn("ui-checkbox", className)} {...props}><CheckboxPrimitive.Indicator className="ui-checkbox-indicator">{checked === "indeterminate" ? <Minus size={16} /> : <Check size={16} />}</CheckboxPrimitive.Indicator></CheckboxPrimitive.Root>;
}
