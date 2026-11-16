"use client";
import { useFormContext } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { CoreInput } from "./core-form";

export type ReferenceOption = { id: string; name: string };
export function ReferenceSelect({ name, label, options, optional = false }: { name: string; label: string; options: ReferenceOption[]; optional?: boolean }) {
  const { control } = useFormContext();
  return <FormField control={control} name={name} render={({ field }) => {
    const available = options.some(option => option.id === field.value) || !field.value ? options : [...options, { id: field.value, name: `Tham chiếu hiện tại (${field.value})` }];
    return <FormItem><FormLabel>{label}</FormLabel><Select value={field.value || "__none__"} onValueChange={value => field.onChange(value === "__none__" ? (optional ? null : "") : value)}>
      <FormControl><SelectTrigger ref={field.ref} onBlur={field.onBlur}><SelectValue placeholder={`Chọn ${label.toLowerCase()}`} /></SelectTrigger></FormControl>
      <SelectContent>{optional ? <SelectItem value="__none__">Không thuộc khu vực</SelectItem> : <SelectItem value="__none__" disabled>Chọn {label.toLowerCase()}</SelectItem>}{available.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
    </Select><FormMessage /></FormItem>;
  }} />;
}
export function ReferenceToggle({ name, label }: { name: string; label: string }) {
  const { control } = useFormContext();
  return <FormField control={control} name={name} render={({ field }) => <FormItem><FormLabel>{label}</FormLabel><FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} ref={field.ref} onBlur={field.onBlur} /></FormControl><FormMessage /></FormItem>} />;
}
export function GeometryFields() {
  return <><CoreInput name="x" label="Vị trí X" numeric /><CoreInput name="y" label="Vị trí Y" numeric /><CoreInput name="width" label="Chiều rộng" numeric /><CoreInput name="height" label="Chiều cao" numeric /></>;
}
