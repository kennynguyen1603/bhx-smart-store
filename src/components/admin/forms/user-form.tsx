"use client";
import { useId } from "react";
import { useFormContext } from "react-hook-form";
import type { z } from "zod";
import { userCreateSchema, userEditSchema } from "../admin-form-schemas";
import { CoreActive, CoreForm, CoreInput, CoreReadOnly, type CoreFormProps } from "./core-form";
import { ReferenceSelect, type ReferenceOption } from "./reference-fields";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
type Schema = typeof userCreateSchema | typeof userEditSchema;
function MembershipChoice({ store, selected, toggle }: { store: ReferenceOption; selected: boolean; toggle: () => void }) {
  const id = useId();
  return <div className="admin-membership"><Label htmlFor={id}>{store.name}</Label><Checkbox id={id} checked={selected} onCheckedChange={toggle} /></div>;
}
function Memberships({ stores }: { stores: ReferenceOption[] }) {
  const membershipLabelId = useId();
  const defaultStoreId = useId();
  const { control, watch, setValue } = useFormContext();
  const ids: string[] = watch("storeIds") ?? [];
  return <><FormField control={control} name="storeIds" render={({ field }) => <FormItem><FormLabel id={membershipLabelId}>Cửa hàng được phân quyền</FormLabel><FormControl><div role="group" aria-labelledby={membershipLabelId} tabIndex={-1}>{stores.map(store => <MembershipChoice key={store.id} store={store} selected={ids.includes(store.id)} toggle={() => field.onChange(ids.includes(store.id) ? ids.filter(id => id !== store.id) : [...ids, store.id])} />)}</div></FormControl><FormMessage /></FormItem>} />
    <FormItem><Label htmlFor={defaultStoreId}>Cửa hàng mặc định</Label><DefaultStore id={defaultStoreId} stores={stores.filter(store => ids.includes(store.id))} ids={ids} onChange={id => setValue("storeIds", [id, ...ids.filter(item => item !== id)], { shouldDirty: true, shouldValidate: true })} /></FormItem></>;
}
function DefaultStore({ id, stores, ids, onChange }: { id: string; stores: ReferenceOption[]; ids: string[]; onChange: (id: string) => void }) {
  return <Select value={ids[0] || "__none__"} onValueChange={onChange}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent>{!ids.length && <SelectItem value="__none__" disabled>Chọn ít nhất một cửa hàng</SelectItem>}{stores.map(store => <SelectItem value={store.id} key={store.id}>{store.name}</SelectItem>)}</SelectContent></Select>;
}
export function UserForm({ descriptor, stores, ...props }: CoreFormProps<"user"> & { stores: ReferenceOption[] }) {
  const edit = descriptor.mode === "edit";
  const available = [...stores];
  for (const id of descriptor.defaultValues.storeIds ?? []) if (!available.some(store => store.id === id)) available.push({ id, name: "Không còn khả dụng" });
  return <CoreForm<z.input<Schema>, z.output<Schema>> {...props} schema={edit ? userEditSchema : userCreateSchema} defaultValues={{ name: "", email: "", password: "", role: "STAFF", storeIds: [], ...descriptor.defaultValues }} title={edit ? "Sửa người dùng" : "Tạo tài khoản"} description={edit ? "Chọn các cửa hàng được phân quyền và cửa hàng mặc định. Để trống mật khẩu mới để giữ mật khẩu hiện tại." : "Chọn các cửa hàng được phân quyền và cửa hàng mặc định. Mật khẩu bắt buộc và phải có ít nhất 8 ký tự."}>
    {edit ? <><CoreReadOnly label="Email" value={descriptor.readOnlyValues?.email ?? ""} /></> : <CoreInput name="email" label="Email" />}
    <CoreInput name="name" label="Họ tên" /><ReferenceSelect name="role" label="Vai trò" options={[{ id: "STAFF", name: "Nhân viên" }, { id: "MANAGER", name: "Quản lý" }, { id: "ADMIN", name: "Quản trị viên" }]} />
    <CoreInput name="password" label={edit ? "Mật khẩu mới" : "Mật khẩu"} type="password" /><Memberships stores={available} />{edit && <CoreActive />}
  </CoreForm>;
}
