"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva("ui-button", {
  variants: {
    variant: { default: "ui-button-primary", destructive: "ui-button-destructive", outline: "ui-button-outline", secondary: "ui-button-secondary", ghost: "ui-button-ghost", link: "ui-button-link" },
    size: { default: "ui-button-default", sm: "ui-button-sm", lg: "ui-button-lg", icon: "ui-button-icon" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };
export function Button({ className, variant, size, asChild = false, type = "button", ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
