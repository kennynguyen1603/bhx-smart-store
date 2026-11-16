"use client";
import type { z } from "zod";
import { eslCreateSchema, eslEditSchema } from "../admin-form-schemas";
import { CoreForm, CoreInput, CoreReadOnly, ReferenceReadOnly, type CoreFormProps } from "./core-form";
import { ReferenceSelect, ReferenceToggle, type ReferenceOption } from "./reference-fields";
type Schema = typeof eslCreateSchema | typeof eslEditSchema;
export function EslForm({ descriptor, stores, shelves, products, ...props }: CoreFormProps<"esl"> & { stores: ReferenceOption[]; shelves: ReferenceOption[]; products: ReferenceOption[] }) {
  const edit = descriptor.mode === "edit";
  return <CoreForm<z.input<Schema>, z.output<Schema>> {...props} schema={edit ? eslEditSchema : eslCreateSchema} defaultValues={{ code: "", shelfId: "", productId: "", ...descriptor.defaultValues }} title={edit ? "Sửa ESL" : "Gắn ESL"} description="Chọn kệ và sản phẩm gắn với thiết bị ESL.">
    <ReferenceReadOnly label="Cửa hàng" options={stores} value={edit ? descriptor.readOnlyValues?.storeId ?? "" : descriptor.defaultValues.storeId ?? ""} />
    {edit ? <CoreReadOnly label="Mã ESL" value={descriptor.readOnlyValues?.code ?? ""} /> : <CoreInput name="code" label="Mã ESL" />}
    <ReferenceSelect name="shelfId" label="Kệ" options={shelves} /><ReferenceSelect name="productId" label="Sản phẩm" options={products} />{edit && <ReferenceToggle name="ledOn" label="Bật đèn LED" />}
  </CoreForm>;
}
