import { z } from "zod";

export const saleEventSchema = z.object({
  externalEventId: z.string().min(3).max(120),
  storeCode: z.string().min(2).max(32),
  shelfCode: z.string().min(1).max(32),
  productSku: z.string().min(1).max(64),
  quantity: z.number().int().positive().max(1000),
  priceVnd: z.number().int().nonnegative(),
  occurredAt: z.coerce.date(),
});

export const wmsInventorySchema = z.object({
  externalEventId: z.string().min(3).max(120),
  storeCode: z.string().min(2).max(32),
  shelfCode: z.string().min(1).max(32),
  productSku: z.string().min(1).max(64),
  backroom: z.number().int().nonnegative(),
  onShelf: z.number().int().nonnegative().optional(),
});

export const supplierLotSchema = z.object({
  externalEventId: z.string().min(3).max(120),
  storeCode: z.string().min(2).max(32),
  productSku: z.string().min(1).max(64),
  supplierCode: z.string().min(1).max(64),
  batchCode: z.string().min(1).max(80),
  origin: z.string().min(2).max(120),
  quantity: z.number().int().positive(),
  receivedAt: z.coerce.date(),
  expiryDate: z.coerce.date(),
});

export const restockSchema = z.object({
  quantity: z.number().int().positive().max(1000),
  expectedVersion: z.number().int().positive(),
  clientMutationId: z.string().uuid(),
});

export const taskMutationSchema = z.object({
  clientMutationId: z.string().uuid(),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export const productAdminSchema = z.object({
  sku: z.string().min(2).max(64),
  barcode: z.string().min(6).max(64),
  name: z.string().min(2).max(180),
  category: z.string().min(2).max(80),
  unit: z.string().min(1).max(24),
  basePriceVnd: z.number().int().positive(),
  emoji: z.string().min(1).max(8).default("📦"),
});

export const inventoryAdminSchema = z.object({
  onShelf: z.number().int().nonnegative(),
  backroom: z.number().int().nonnegative(),
  capacity: z.number().int().positive(),
  lowThreshold: z.number().int().nonnegative(),
}).refine((data) => data.lowThreshold < data.capacity, {
  message: "Ngưỡng cảnh báo phải nhỏ hơn sức chứa",
  path: ["lowThreshold"],
});

export type SaleEventInput = z.infer<typeof saleEventSchema>;
export type WmsInventoryInput = z.infer<typeof wmsInventorySchema>;
export type SupplierLotInput = z.infer<typeof supplierLotSchema>;
