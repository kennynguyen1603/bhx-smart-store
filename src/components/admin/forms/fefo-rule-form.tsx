"use client";
import type { z } from "zod";
import { fefoRuleCreateSchema, fefoRuleEditSchema } from "../admin-form-schemas";
import { CoreActive, CoreForm, CoreInput, CoreReadOnly, type CoreFormProps } from "./core-form";
import { ReferenceToggle } from "./reference-fields";
type Schema = typeof fefoRuleCreateSchema | typeof fefoRuleEditSchema;
export function FefoRuleForm({ descriptor, ...props }: CoreFormProps<"fefo-rule">) {
  const edit = descriptor.mode === "edit";
  return <CoreForm<z.input<Schema>, z.output<Schema>> {...props} schema={edit ? fefoRuleEditSchema : fefoRuleCreateSchema} defaultValues={{ daysRemaining: 3, discountPercent: 20, quarantine: false, ...descriptor.defaultValues }} title={edit ? "Sửa quy tắc FEFO" : "Thêm quy tắc FEFO"} description={edit ? "Cập nhật giảm giá, cách ly và trạng thái quy tắc." : "Quy tắc mới được kích hoạt tự động."}>
    {edit && <CoreReadOnly label="ID" value={descriptor.id} />}<CoreReadOnly label="Cửa hàng" value={edit ? descriptor.readOnlyValues?.storeId ?? "" : descriptor.defaultValues.storeId ?? ""} />
    <CoreInput name="daysRemaining" label="Số ngày còn lại" numeric /><CoreInput name="discountPercent" label="Phần trăm giảm" numeric /><ReferenceToggle name="quarantine" label="Cách ly" />{edit && <CoreActive />}
  </CoreForm>;
}
