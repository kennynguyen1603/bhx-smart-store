"use client";
import { useId, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFormContext, type DefaultValues, type FieldValues } from "react-hook-form";
import type { z } from "zod";
import { AdminEntityDialog } from "../admin-entity-dialog";
import type { AdminDialogProps, ApiMutationResult } from "../admin-types";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export type CoreFormProps<Kind extends string> = {
  descriptor: Extract<import("../admin-types").AdminDialogDescriptor, { kind: Kind }>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: unknown) => Promise<ApiMutationResult>;
};

/** Shared field rendering and submit plumbing; each resource owns its schema and fields. */
export function CoreForm<Input extends FieldValues, Output extends FieldValues>({ schema, defaultValues, onSubmit, children, ...dialog }: {
  schema: z.ZodType<Output, Input>;
  defaultValues: DefaultValues<Input>;
  onSubmit: (values: Output) => Promise<ApiMutationResult>;
  children: ReactNode;
} & Pick<AdminDialogProps, "title" | "description" | "onOpenChange">) {
  const form = useForm<Input, unknown, Output>({ resolver: zodResolver(schema), defaultValues });
  return <Form {...form}><AdminEntityDialog {...dialog} open onSubmit={async () => {
    let result: Awaited<ReturnType<AdminDialogProps["onSubmit"]>> = { ok: false, error: "Vui lòng kiểm tra các trường không hợp lệ." };
    await form.handleSubmit(async (values) => {
      const response = await onSubmit(values);
      result = response.ok ? true : { ok: false, error: response.message };
    })();
    return result;
  }}>{children}</AdminEntityDialog></Form>;
}

export function CoreInput({ name, label, numeric = false, type = "text" }: { name: string; label: string; numeric?: boolean; type?: "text" | "password" }) {
  const { control } = useFormContext();
  return <FormField control={control} name={name} render={({ field }) => <FormItem>
    <FormLabel>{label}</FormLabel><FormControl><Input {...field} type={numeric ? "number" : type} step={numeric ? 1 : undefined}
      value={Number.isNaN(field.value) ? "" : field.value ?? ""}
      onChange={(event) => field.onChange(numeric ? event.target.valueAsNumber : event.target.value)} /></FormControl><FormMessage />
  </FormItem>} />;
}
export function CoreReadOnly({ label, value }: { label: string; value: string }) {
  const id = useId();
  return <div className="ui-form-item"><Label htmlFor={id}>{label}</Label><Input id={id} value={value} readOnly /></div>;
}
export function CoreActive() {
  const { control } = useFormContext();
  return <FormField control={control} name="active" render={({ field }) => <FormItem><FormLabel>Đang hoạt động</FormLabel>
    <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormMessage />
  </FormItem>} />;
}
