"use client";
import type { z } from "zod";
import { supplierCreateSchema, supplierEditSchema } from "../admin-form-schemas";
import { CoreActive, CoreForm, CoreInput, CoreReadOnly, type CoreFormProps } from "./core-form";

type SupplierSchema = typeof supplierCreateSchema | typeof supplierEditSchema;

export function SupplierForm({ descriptor, onSubmit, ...props }: CoreFormProps<"supplier">) {
  const edit = descriptor.mode === "edit";
  const defaultValues = { code: "", name: "", country: "Việt Nam", ...descriptor.defaultValues, certificate: descriptor.defaultValues.certificate ?? "" };
  return <CoreForm<z.input<SupplierSchema>, z.output<SupplierSchema>> {...props} schema={edit ? supplierEditSchema : supplierCreateSchema}
    defaultValues={defaultValues}
    onSubmit={(values) => onSubmit({ ...values, certificate: values.certificate || null })}
    title={edit ? "Sửa nhà cung cấp" : "Thêm nhà cung cấp"} description="Cập nhật thông tin và chứng nhận nhà cung cấp.">
    {edit ? <CoreReadOnly label="Mã nhà cung cấp" value={descriptor.readOnlyValues?.code ?? ""} /> : <CoreInput name="code" label="Mã nhà cung cấp" />}
    <CoreInput name="name" label="Tên nhà cung cấp" /><CoreInput name="country" label="Quốc gia" /><CoreInput name="certificate" label="Chứng nhận" />
    {edit && <CoreActive />}
  </CoreForm>;
}
