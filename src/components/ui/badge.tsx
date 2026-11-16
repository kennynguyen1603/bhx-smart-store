import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva("ui-badge", {
  variants: {
    variant: {
      default: "ui-badge-default",
      secondary: "ui-badge-secondary",
      destructive: "ui-badge-destructive",
      outline: "ui-badge-outline",
      success: "ui-badge-success",
    },
  },
  defaultVariants: { variant: "default" },
});
export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;
export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean };
export function Badge({ className, variant = "default", asChild = false, ...props }: BadgeProps) {
  const Component = asChild ? Slot : "span";
  return <Component data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />;
}
