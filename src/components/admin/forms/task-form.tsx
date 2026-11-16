"use client";
import { useEffect, useRef } from "react";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useFormContext } from "react-hook-form";
import { taskCreateSchema } from "../admin-form-schemas";
import { CoreForm, CoreInput, ReferenceReadOnly, type CoreFormProps } from "./core-form";
import { ReferenceSelect, type ReferenceOption } from "./reference-fields";

export type TaskReferences = {
  products: ReferenceOption[];
  shelves: (ReferenceOption & { productIds: string[] })[];
  lots: (ReferenceOption & { productId: string })[];
  assignees: ReferenceOption[];
};
function TaskFields({ references }: { references: TaskReferences }) {
  const { watch, setValue } = useFormContext();
  const productId = watch("productId");
  const previousProduct = useRef(productId);
  useEffect(() => {
    if (previousProduct.current !== productId) {
      setValue("shelfId", ""); setValue("lotId", undefined);
      previousProduct.current = productId;
    }
  }, [productId, setValue]);
  return <>
    <ReferenceSelect name="type" label="Loại nhiệm vụ" options={[{ id: "RESTOCK", name: "Bổ sung hàng" }, { id: "FEFO", name: "FEFO" }, { id: "QUARANTINE", name: "Cách ly" }]} />
    <ReferenceSelect name="productId" label="Sản phẩm" options={references.products} />
    <ReferenceSelect name="shelfId" label="Kệ" options={references.shelves.filter(shelf => shelf.productIds.includes(productId))} />
    <ReferenceSelect name="lotId" label="Lô hàng" options={references.lots.filter(lot => lot.productId === productId)} optional omitEmpty emptyLabel="Tự chọn lô phù hợp" />
    <ReferenceSelect name="assigneeId" label="Người nhận" options={references.assignees} optional omitEmpty emptyLabel="Chưa phân công" />
    <ReferenceSelect name="priority" label="Độ ưu tiên" options={[{ id: "NORMAL", name: "Bình thường" }, { id: "MEDIUM", name: "Trung bình" }, { id: "HIGH", name: "Cao" }]} />
    <TaskDueAt />
    <CoreInput name="note" label="Ghi chú" />
    <p className="muted">FEFO và cách ly tự chọn lô phù hợp nếu để trống. Nhiệm vụ bổ sung hàng không gắn lô.</p>
  </>;
}
function TaskDueAt() {
  const { control } = useFormContext();
  return <FormField control={control} name="dueAt" render={({ field }) => {
    const date = field.value ? new Date(field.value) : null;
    const local = date ? new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
    return <FormItem><FormLabel>Hạn hoàn thành</FormLabel><FormControl><Input type="datetime-local" ref={field.ref} onBlur={field.onBlur} value={local} onChange={event => field.onChange(event.target.value ? new Date(event.target.value).toISOString() : undefined)} /></FormControl><FormMessage /></FormItem>;
  }} />;
}
export function TaskForm({ descriptor, stores, references, ...props }: CoreFormProps<"task"> & { stores: ReferenceOption[]; references: TaskReferences }) {
  return <CoreForm {...props} schema={taskCreateSchema} defaultValues={{ productId: "", shelfId: "", ...descriptor.defaultValues }} title="Giao nhiệm vụ" description="Chọn sản phẩm, kệ và nhân viên tại cửa hàng. Nhân viên sẽ nhận thông báo sau khi giao việc.">
    <ReferenceReadOnly label="Cửa hàng" value={descriptor.defaultValues.storeId || ""} options={stores} />
    <TaskFields references={references} />
  </CoreForm>;
}
