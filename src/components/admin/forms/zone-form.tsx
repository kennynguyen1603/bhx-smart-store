"use client";
import type { z } from "zod";
import { zoneCreateSchema, zoneEditSchema } from "../admin-form-schemas";
import { CoreForm, CoreInput, CoreReadOnly, type CoreFormProps } from "./core-form";
import { GeometryFields } from "./reference-fields";
type Schema = typeof zoneCreateSchema | typeof zoneEditSchema;
export function ZoneForm({ descriptor, ...props }: CoreFormProps<"zone">) {
  const edit = descriptor.mode === "edit";
  return <CoreForm<z.input<Schema>, z.output<Schema>> {...props} schema={edit ? zoneEditSchema : zoneCreateSchema} defaultValues={{ name: "", color: "#dff3e7", x: 0, y: 0, width: 3, height: 1, ...descriptor.defaultValues }} title={edit ? "Sửa khu vực" : "Thêm khu vực"} description="Cập nhật màu sắc, vị trí và kích thước khu vực.">
    {edit && <CoreReadOnly label="ID" value={descriptor.id} />}<CoreReadOnly label="Cửa hàng" value={edit ? descriptor.readOnlyValues?.storeId ?? "" : descriptor.defaultValues.storeId ?? ""} />
    <CoreInput name="name" label="Tên khu vực" /><CoreInput name="color" label="Màu" /><GeometryFields />
  </CoreForm>;
}
