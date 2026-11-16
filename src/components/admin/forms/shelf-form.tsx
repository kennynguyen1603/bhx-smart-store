"use client";
import type { z } from "zod";
import { shelfCreateSchema, shelfEditSchema } from "../admin-form-schemas";
import { CoreForm, CoreInput, CoreReadOnly, ReferenceReadOnly, type CoreFormProps } from "./core-form";
import { GeometryFields, ReferenceSelect, type ReferenceOption } from "./reference-fields";
type Schema = typeof shelfCreateSchema | typeof shelfEditSchema;
export function ShelfForm({ descriptor, stores, zones, ...props }: CoreFormProps<"shelf"> & { stores: ReferenceOption[]; zones: ReferenceOption[] }) {
  const edit = descriptor.mode === "edit";
  return <CoreForm<z.input<Schema>, z.output<Schema>> {...props} schema={edit ? shelfEditSchema : shelfCreateSchema} defaultValues={{ code: "", label: "", zoneId: null, x: 0, y: 1, width: 1, height: 2, ...descriptor.defaultValues }} title={edit ? "Sửa kệ" : "Thêm kệ"} description="Chọn khu vực cho kệ. Kệ mới bắt đầu tại X=0, Y=1, rộng 1, cao 2.">
    <ReferenceReadOnly label="Cửa hàng" options={stores} value={edit ? descriptor.readOnlyValues?.storeId ?? "" : descriptor.defaultValues.storeId ?? ""} />
    {edit ? <CoreReadOnly label="Mã kệ" value={descriptor.readOnlyValues?.code ?? ""} /> : <CoreInput name="code" label="Mã kệ" />}
    <CoreInput name="label" label="Tên kệ" /><ReferenceSelect name="zoneId" label="Khu vực" options={zones} optional />{edit && <GeometryFields />}
  </CoreForm>;
}
