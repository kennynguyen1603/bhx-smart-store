import { describe, expect, it } from "vitest";
import {
  storeCreateSchema, storeEditSchema, inventorySchema, productCreateSchema, productEditSchema,
  supplierCreateSchema, supplierEditSchema, lotCreateSchema, lotEditSchema,
  zoneCreateSchema, zoneEditSchema, shelfCreateSchema, shelfEditSchema,
  eslCreateSchema, eslEditSchema, fefoRuleCreateSchema, fefoRuleEditSchema,
  userCreateSchema, userEditSchema,
} from "@/components/admin/admin-form-schemas";
import type { ZodType } from "zod";

const inventory = { onShelf: 5, backroom: 10, capacity: 20, lowThreshold: 4 };
const lot = { storeId: "store-2", productId: "product-2", supplierId: "supplier-2", batchCode: "LOT-1", origin: "Việt Nam", receivedAt: "2026-11-16T00:00:00Z", expiryDate: "2026-11-20", quantity: 20 };
const user = { email: "staff@bhx.vn", name: "Nhân viên", role: "STAFF", password: "password123", storeIds: ["store-2"] };

// Missing validation would allow malformed API payloads or lose field-level Vietnamese feedback.
function fieldError(schema: ZodType, data: unknown, field: string, message: string) {
  const result = schema.safeParse(data);
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: field.split(".").map((part) => /^\d+$/.test(part) ? Number(part) : part), message }));
}

describe("Admin Vietnamese form validation", () => {
  it.each([0, -1, 1.5, NaN])("rejects invalid inventory capacity %s", (capacity) => {
    fieldError(inventorySchema, { ...inventory, capacity }, "capacity", "Sức chứa phải là số nguyên dương");
  });
  it.each([20, 21])("rejects inventory threshold %s at/above capacity", (lowThreshold) => {
    fieldError(inventorySchema, { ...inventory, lowThreshold }, "lowThreshold", "Ngưỡng cảnh báo phải nhỏ hơn sức chứa");
  });
  it.each(["onShelf", "backroom", "lowThreshold"])("rejects negative %s", (field) => {
    fieldError(inventorySchema, { ...inventory, [field]: -1 }, field, "Số lượng phải là số nguyên không âm");
  });
  it.each(["", "invalid", "2026-02-30"])("rejects invalid lot expiry %s", (expiryDate) => {
    fieldError(lotCreateSchema, { ...lot, expiryDate }, "expiryDate", "Hạn sử dụng không hợp lệ");
  });
  it.each([0, -1, 1.5])("requires positive integer lot creation quantity %s", (quantity) => {
    fieldError(lotCreateSchema, { ...lot, quantity }, "quantity", "Số lượng phải là số nguyên dương");
  });
  it("allows a sold-out lot edit but rejects negative quantity and invalid expiry", () => {
    expect(lotEditSchema.safeParse({ quantity: 0, expiryDate: "2026-11-20", origin: "Việt Nam" }).success).toBe(true);
    fieldError(lotEditSchema, { quantity: -1, expiryDate: "bad", origin: "Việt Nam" }, "quantity", "Số lượng phải là số nguyên không âm");
    fieldError(lotEditSchema, { quantity: 1, expiryDate: "bad", origin: "Việt Nam" }, "expiryDate", "Hạn sử dụng không hợp lệ");
  });
  it.each(["red", "#fff", "#12345g"])("rejects invalid hex color %s", (color) => {
    fieldError(zoneEditSchema, { name: "Rau củ", color, x: 0, y: 0, width: 3, height: 1 }, "color", "Màu phải có định dạng #RRGGBB");
  });
  it.each([-1, 101, 1.5])("rejects FEFO percent %s", (discountPercent) => {
    fieldError(fefoRuleCreateSchema, { storeId: "store-2", daysRemaining: 3, discountPercent, quarantine: false }, "discountPercent", "Phần trăm giảm phải là số nguyên từ 0 đến 100");
  });
  it.each([userCreateSchema, userEditSchema])("requires at least one store for create/edit user", (schema) => {
    fieldError(schema, { ...user, storeIds: [] }, "storeIds", "Chọn ít nhất một cửa hàng");
    fieldError(schema, { ...user, storeIds: [""] }, "storeIds.0", "Chọn cửa hàng");
  });
  it("requires a password only at user creation and omits an empty edit password", () => {
    expect(userCreateSchema.safeParse({ ...user, password: "" }).success).toBe(false);
    expect(userEditSchema.parse({ ...user, password: "" }).password).toBeUndefined();
    expect(userEditSchema.safeParse({ name: "Nhân viên", role: "MANAGER", storeIds: ["store-2"] }).success).toBe(true);
  });
  it.each([
    [storeCreateSchema, { code: "BHX02", name: "BHX Quận 2", address: "123 Đường số 2" }],
    [storeEditSchema, { name: "BHX Quận 2", address: "123 Đường số 2", mapWidth: 12, mapHeight: 8 }],
    [inventorySchema, inventory],
    [productCreateSchema, { sku: "MILK", barcode: "123456", name: "Sữa tươi", category: "Sữa", unit: "Hộp", basePriceVnd: 20000 }],
    [productEditSchema, { name: "Sữa tươi", category: "Sữa", unit: "Hộp", basePriceVnd: 20000, emoji: "🥛" }],
    [supplierCreateSchema, { code: "SUP02", name: "Nhà cung cấp", country: "Việt Nam" }],
    [supplierEditSchema, { name: "Nhà cung cấp", country: "Việt Nam", certificate: null }],
    [lotCreateSchema, lot],
    [zoneCreateSchema, { storeId: "store-2", name: "Rau củ", color: "#dff3e7", x: 0, y: 0, width: 3, height: 1 }],
    [shelfCreateSchema, { storeId: "store-2", code: "K2", label: "Kệ 2" }],
    [shelfEditSchema, { label: "Kệ 2", zoneId: "zone-2", x: 0, y: 1, width: 1, height: 2 }],
    [eslCreateSchema, { code: "ESL02", storeId: "store-2", shelfId: "shelf-2", productId: "product-2" }],
    [eslEditSchema, { shelfId: "shelf-2", productId: "product-2", ledOn: true }],
    [fefoRuleEditSchema, { daysRemaining: 3, discountPercent: 100, quarantine: true, active: false }],
    [userCreateSchema, user],
  ] as const)("accepts valid dedicated form payload %#", (schema, data) => {
    expect(schema.safeParse(data).success).toBe(true);
  });
  it("sends the exact shelf map defaults", () => {
    expect(shelfCreateSchema.parse({ storeId: "store-2", code: "K2", label: "Kệ 2" })).toEqual({ storeId: "store-2", code: "K2", label: "Kệ 2", x: 0, y: 1, width: 1, height: 2 });
  });
  it("strips immutable identifiers and create-only references from edits", () => {
    expect(lotEditSchema.parse(lot)).toEqual({ quantity: 20, expiryDate: "2026-11-20", origin: "Việt Nam" });
    expect(eslEditSchema.parse({ code: "ESL02", storeId: "store-1", shelfId: "shelf-2", productId: "product-2" })).toEqual({ shelfId: "shelf-2", productId: "product-2" });
    expect(fefoRuleCreateSchema.parse({ storeId: "store-2", daysRemaining: 0, discountPercent: 0, active: false })).toEqual({ storeId: "store-2", daysRemaining: 0, discountPercent: 0, quarantine: false });
  });
});
