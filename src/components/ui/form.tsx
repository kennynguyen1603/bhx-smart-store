"use client";
import { createContext, useContext, useId, type ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { Controller, FormProvider, useFormContext, useFormState, type ControllerProps, type FieldPath, type FieldValues } from "react-hook-form";
import { cn } from "@/lib/utils";
import { Label } from "./label";

export const Form = FormProvider;
const FieldContext = createContext<{ name: string } | null>(null);
const ItemContext = createContext<{ id: string } | null>(null);
export function FormField<TValues extends FieldValues, TName extends FieldPath<TValues>>({ ...props }: ControllerProps<TValues, TName>) {
  return <FieldContext.Provider value={{ name: props.name }}><Controller {...props} /></FieldContext.Provider>;
}
export function useFormField() {
  const field = useContext(FieldContext);
  const item = useContext(ItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: field?.name });
  if (!field || !item) throw new Error("Trường biểu mẫu phải nằm trong FormField và FormItem");
  return { name: field.name, formItemId: `${item.id}-control`, formDescriptionId: `${item.id}-description`, formMessageId: `${item.id}-message`, ...getFieldState(field.name, formState) };
}
export function FormItem({ className, ...props }: ComponentProps<"div">) {
  const id = useId();
  return <ItemContext.Provider value={{ id }}><div className={cn("ui-form-item", className)} {...props} /></ItemContext.Provider>;
}
export function FormLabel({ className, ...props }: ComponentProps<typeof Label>) {
  const { error, formItemId } = useFormField();
  return <Label className={cn(error && "ui-form-label-error", className)} htmlFor={formItemId} {...props} />;
}
export function FormControl(props: ComponentProps<typeof Slot>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  return <Slot id={formItemId} aria-describedby={error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId} aria-invalid={!!error} {...props} />;
}
export function FormDescription({ className, ...props }: ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();
  return <p id={formDescriptionId} className={cn("ui-form-description", className)} {...props} />;
}
export function FormMessage({ className, children, ...props }: ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error.message ?? "") : children;
  return body ? <p id={formMessageId} role="alert" className={cn("ui-form-message", className)} {...props}>{body}</p> : null;
}
