"use client";
import type { z } from "zod";
import { productCreateSchema, productEditSchema } from "../admin-form-schemas";
import { CoreForm, CoreInput, CoreReadOnly, type CoreFormProps } from "./core-form";

type ProductSchema = typeof productCreateSchema | typeof productEditSchema;

export function ProductForm({ descriptor, ...props }: CoreFormProps<"product">) {
  const edit = descriptor.mode === "edit";
  const defaultValues = { sku: "", barcode: "", name: "", category: "", unit: "Sản phẩm", basePriceVnd: 10000, emoji: "📦", ...descriptor.defaultValues };
  return <CoreForm<z.input<ProductSchema>, z.output<ProductSchema>> {...props} schema={edit ? productEditSchema : productCreateSchema}
    defaultValues={defaultValues}
    title={edit ? "Sửa sản phẩm" : "Thêm sản phẩm"} description="Cập nhật thông tin và giá bán sản phẩm.">
    {edit ? <><CoreReadOnly label="SKU" value={descriptor.readOnlyValues?.sku ?? ""} /><CoreReadOnly label="Mã vạch" value={descriptor.readOnlyValues?.barcode ?? ""} /></>
      : <><CoreInput name="sku" label="SKU" /><CoreInput name="barcode" label="Mã vạch" /></>}
    <CoreInput name="name" label="Tên sản phẩm" /><CoreInput name="category" label="Danh mục" />
    <CoreInput name="unit" label="Đơn vị" /><CoreInput name="basePriceVnd" label="Giá bán" numeric /><CoreInput name="emoji" label="Biểu tượng" />
  </CoreForm>;
}
