import { z } from "zod";

const text = (label: string, min = 2, max?: number) => {
  const schema = z.string({ error: `${label} không hợp lệ` }).trim().min(min, `${label} phải có ít nhất ${min} ký tự`);
  return max ? schema.max(max, `${label} không được quá ${max} ký tự`) : schema;
};
const reference = (label: string) => z.string({ error: `Chọn ${label}` }).trim().min(1, `Chọn ${label}`);
const integer = (message: string, min: number, max?: number) => {
  const schema = z.number({ error: message }).int(message).min(min, message);
  return max === undefined ? schema : schema.max(max, message);
};
const quantity = () => integer("Số lượng phải là số nguyên không âm", 0);
const positiveQuantity = () => integer("Số lượng phải là số nguyên dương", 1);
const position = () => integer("Vị trí phải là số nguyên không âm", 0);
const dimension = () => integer("Kích thước phải là số nguyên dương", 1);
const geometry = { x: position(), y: position(), width: dimension(), height: dimension() };
const date = (label: string) => z.string({ error: `${label} không hợp lệ` }).refine((value) => {
  // Validate calendar days explicitly: Date.parse normalizes February 30 to March.
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10);
}, `${label} không hợp lệ`);
const active = z.boolean({ error: "Trạng thái không hợp lệ" });

const storeFields = {
  name: text("Tên cửa hàng"), address: text("Địa chỉ", 5),
  mapWidth: integer("Chiều rộng bản đồ phải từ 6 đến 30", 6, 30).default(12),
  mapHeight: integer("Chiều cao bản đồ phải từ 4 đến 20", 4, 20).default(8),
};
export const storeCreateSchema = z.object({ code: text("Mã cửa hàng"), ...storeFields });
export const storeEditSchema = z.object({ ...storeFields, active: active.optional() });
export const inventorySchema = z.object({
  onShelf: quantity(), backroom: quantity(),
  capacity: integer("Sức chứa phải là số nguyên dương", 1), lowThreshold: quantity(),
}).refine((value) => value.lowThreshold < value.capacity, {
  path: ["lowThreshold"], message: "Ngưỡng cảnh báo phải nhỏ hơn sức chứa",
}).refine((value) => value.onShelf <= value.capacity, {
  path: ["onShelf"], message: "Số lượng trên kệ không được vượt sức chứa",
});

const productFields = {
  name: text("Tên sản phẩm", 2, 180), category: text("Danh mục", 2, 80), unit: text("Đơn vị", 1, 24),
  basePriceVnd: integer("Giá bán phải là số nguyên dương", 1), emoji: text("Biểu tượng", 1, 8).default("📦"),
};
export const productCreateSchema = z.object({ sku: text("SKU", 2, 64), barcode: text("Mã vạch", 6, 64), ...productFields });
export const productEditSchema = z.object(productFields);
const supplierFields = { name: text("Tên nhà cung cấp"), country: text("Quốc gia"), certificate: z.string({ error: "Chứng nhận không hợp lệ" }).trim().nullable().optional() };
export const supplierCreateSchema = z.object({ code: text("Mã nhà cung cấp"), ...supplierFields });
export const supplierEditSchema = z.object({ ...supplierFields, active: active.optional() });
export const lotCreateSchema = z.object({
  storeId: reference("cửa hàng"), productId: reference("sản phẩm"), supplierId: reference("nhà cung cấp"),
  batchCode: text("Mã lô"), origin: text("Xuất xứ"), receivedAt: date("Ngày nhận"), expiryDate: date("Hạn sử dụng"), quantity: positiveQuantity(),
});
export const lotEditSchema = z.object({ origin: text("Xuất xứ"), expiryDate: date("Hạn sử dụng"), quantity: quantity() });
const zoneFields = { name: text("Tên khu vực"), color: z.string({ error: "Màu phải có định dạng #RRGGBB" }).regex(/^#[0-9a-f]{6}$/i, "Màu phải có định dạng #RRGGBB"), ...geometry };
export const zoneCreateSchema = z.object({ storeId: reference("cửa hàng"), ...zoneFields });
export const zoneEditSchema = z.object(zoneFields);
const shelfFields = { label: text("Tên kệ"), zoneId: reference("khu vực").nullable().optional() };
export const shelfCreateSchema = z.object({
  storeId: reference("cửa hàng"), code: text("Mã kệ", 1), ...shelfFields,
  x: position().default(0), y: position().default(1), width: dimension().default(1), height: dimension().default(2),
});
export const shelfEditSchema = z.object({ ...shelfFields, ...geometry });
const eslFields = { shelfId: reference("kệ"), productId: reference("sản phẩm") };
export const eslCreateSchema = z.object({ code: text("Mã ESL", 3), storeId: reference("cửa hàng"), ...eslFields });
export const eslEditSchema = z.object({ ...eslFields, ledOn: z.boolean({ error: "Trạng thái đèn không hợp lệ" }).optional() });
const ruleFields = {
  daysRemaining: integer("Số ngày còn lại phải là số nguyên không âm", 0),
  discountPercent: integer("Phần trăm giảm phải là số nguyên từ 0 đến 100", 0, 100),
  quarantine: z.boolean({ error: "Trạng thái cách ly không hợp lệ" }).default(false),
};
export const fefoRuleCreateSchema = z.object({ storeId: reference("cửa hàng"), ...ruleFields });
export const fefoRuleEditSchema = z.object({ ...ruleFields, active });
const password = z.string({ error: "Mật khẩu không hợp lệ" }).min(8, "Mật khẩu phải có ít nhất 8 ký tự");
const userFields = {
  name: text("Họ tên"), role: z.enum(["STAFF", "MANAGER", "ADMIN"], { error: "Chọn vai trò hợp lệ" }),
  // Order is significant: the API makes the first membership the default store.
  storeIds: z.array(reference("cửa hàng"), { error: "Chọn ít nhất một cửa hàng" }).min(1, "Chọn ít nhất một cửa hàng"),
};
export const userCreateSchema = z.object({ email: z.email("Email không hợp lệ"), password, ...userFields });
export const userEditSchema = z.object({
  ...userFields, active: active.optional(),
  password: z.union([password, z.literal("")]).optional().transform((value) => value || undefined),
});

export type StoreCreateValues = z.infer<typeof storeCreateSchema>;
export type StoreEditValues = z.infer<typeof storeEditSchema>;
export type InventoryValues = z.infer<typeof inventorySchema>;
export type ProductCreateValues = z.infer<typeof productCreateSchema>;
export type ProductEditValues = z.infer<typeof productEditSchema>;
export type SupplierCreateValues = z.infer<typeof supplierCreateSchema>;
export type SupplierEditValues = z.infer<typeof supplierEditSchema>;
export type LotCreateValues = z.infer<typeof lotCreateSchema>;
export type LotEditValues = z.infer<typeof lotEditSchema>;
export type ZoneCreateValues = z.infer<typeof zoneCreateSchema>;
export type ZoneEditValues = z.infer<typeof zoneEditSchema>;
export type ShelfCreateValues = z.infer<typeof shelfCreateSchema>;
export type ShelfEditValues = z.infer<typeof shelfEditSchema>;
export type EslCreateValues = z.infer<typeof eslCreateSchema>;
export type EslEditValues = z.infer<typeof eslEditSchema>;
export type FefoRuleCreateValues = z.infer<typeof fefoRuleCreateSchema>;
export type FefoRuleEditValues = z.infer<typeof fefoRuleEditSchema>;
export type UserCreateValues = z.infer<typeof userCreateSchema>;
export type UserEditValues = z.infer<typeof userEditSchema>;
