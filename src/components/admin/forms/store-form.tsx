"use client";
import type { z } from "zod";
import { storeCreateSchema, storeEditSchema } from "../admin-form-schemas";
import { CoreActive, CoreForm, CoreInput, CoreReadOnly, type CoreFormProps } from "./core-form";

type StoreSchema = typeof storeCreateSchema | typeof storeEditSchema;

export function StoreForm({ descriptor, ...props }: CoreFormProps<"store">) {
  const edit = descriptor.mode === "edit";
  const defaultValues = { code: "", name: "", address: "", mapWidth: 12, mapHeight: 8, ...descriptor.defaultValues };
  return <CoreForm<z.input<StoreSchema>, z.output<StoreSchema>> {...props} schema={edit ? storeEditSchema : storeCreateSchema}
    defaultValues={defaultValues}
    title={edit ? "Sửa cửa hàng" : "Thêm cửa hàng"} description="Cập nhật thông tin cửa hàng và kích thước bản đồ.">
    {edit ? <CoreReadOnly label="Mã cửa hàng" value={descriptor.readOnlyValues?.code ?? ""} /> : <CoreInput name="code" label="Mã cửa hàng" />}
    <CoreInput name="name" label="Tên cửa hàng" /><CoreInput name="address" label="Địa chỉ" />
    <CoreInput name="mapWidth" label="Chiều rộng bản đồ" numeric /><CoreInput name="mapHeight" label="Chiều cao bản đồ" numeric />
    {edit && <CoreActive />}
  </CoreForm>;
}
