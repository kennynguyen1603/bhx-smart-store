"use client";
import type { z } from "zod";
import { lotCreateSchema, lotEditSchema } from "../admin-form-schemas";
import { CoreForm, CoreInput, CoreReadOnly, ReferenceReadOnly, type CoreFormProps } from "./core-form";
import { ReferenceSelect, type ReferenceOption } from "./reference-fields";
type Schema = typeof lotCreateSchema | typeof lotEditSchema;
export function LotForm({ descriptor, stores, products, suppliers, ...props }: CoreFormProps<"lot"> & { stores: ReferenceOption[]; products: ReferenceOption[]; suppliers: ReferenceOption[] }) {
  const edit = descriptor.mode === "edit";
  return <CoreForm<z.input<Schema>, z.output<Schema>> {...props} schema={edit ? lotEditSchema : lotCreateSchema}
    defaultValues={{ batchCode: "", productId: "", supplierId: "", origin: "", receivedAt: new Date().toISOString().slice(0, 10), expiryDate: "", quantity: 20, ...descriptor.defaultValues }}
    title={edit ? "Sửa lô hàng" : "Thêm lô hàng"} description="Chọn đúng sản phẩm và nhà cung cấp; kiểm tra ngày nhận và hạn sử dụng.">
    {edit ? <><ReferenceReadOnly label="Cửa hàng" options={stores} value={descriptor.readOnlyValues?.storeId ?? ""} /><CoreReadOnly label="Mã lô" value={descriptor.readOnlyValues?.batchCode ?? ""} /><ReferenceReadOnly label="Sản phẩm" options={products} value={descriptor.readOnlyValues?.productId ?? ""} /><ReferenceReadOnly label="Nhà cung cấp" options={suppliers} value={descriptor.readOnlyValues?.supplierId ?? ""} /><CoreReadOnly label="Ngày nhận" value={descriptor.readOnlyValues?.receivedAt ?? ""} /></>
      : <><ReferenceReadOnly label="Cửa hàng" options={stores} value={descriptor.defaultValues.storeId ?? ""} /><CoreInput name="batchCode" label="Mã lô" /><ReferenceSelect name="productId" label="Sản phẩm" options={products} /><ReferenceSelect name="supplierId" label="Nhà cung cấp" options={suppliers} /><CoreInput name="receivedAt" label="Ngày nhận" /></>}
    <CoreInput name="origin" label="Xuất xứ" /><CoreInput name="expiryDate" label="Hạn sử dụng" /><CoreInput name="quantity" label="Số lượng" numeric />
  </CoreForm>;
}
