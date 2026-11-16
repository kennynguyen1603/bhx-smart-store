"use client";
import { inventorySchema } from "../admin-form-schemas";
import { CoreForm, CoreInput, type CoreFormProps } from "./core-form";

export function InventoryForm({ descriptor, ...props }: CoreFormProps<"inventory">) {
  return <CoreForm {...props} schema={inventorySchema} defaultValues={descriptor.defaultValues}
    title="Sửa tồn kho" description="Cập nhật số lượng trên kệ, kho sau, sức chứa và ngưỡng cảnh báo.">
    <CoreInput name="onShelf" label="Số lượng trên kệ" numeric /><CoreInput name="backroom" label="Số lượng kho sau" numeric />
    <CoreInput name="capacity" label="Sức chứa kệ" numeric /><CoreInput name="lowThreshold" label="Ngưỡng cảnh báo" numeric />
  </CoreForm>;
}
