import { hash } from "bcryptjs";
import { Role } from "@/generated/prisma/client";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/api-auth";
import { inventoryAdminSchema, productAdminSchema } from "@/lib/contracts";
import { prisma } from "@/lib/db";
import { normalizeSearch } from "@/lib/normalize";
import { z } from "zod";

const storeSchema = z.object({ code: z.string().min(2), name: z.string().min(2), address: z.string().min(5), mapWidth: z.number().int().min(6).max(30).default(12), mapHeight: z.number().int().min(4).max(20).default(8) });
const supplierSchema = z.object({ code: z.string().min(2), name: z.string().min(2), country: z.string().min(2), certificate: z.string().optional().nullable() });
const userSchema = z.object({ email: z.string().email(), name: z.string().min(2), role: z.nativeEnum(Role), password: z.string().min(8), storeIds: z.array(z.string()).min(1) });
const lotSchema = z.object({ storeId: z.string(), productId: z.string(), supplierId: z.string(), batchCode: z.string().min(2), origin: z.string().min(2), receivedAt: z.coerce.date(), expiryDate: z.coerce.date(), quantity: z.number().int().positive() });
const shelfSchema = z.object({ storeId: z.string(), zoneId: z.string().optional().nullable(), code: z.string().min(1), label: z.string().min(2), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive().default(1), height: z.number().int().positive().default(1) });
const zoneSchema = z.object({ storeId: z.string(), name: z.string().min(2), color: z.string().regex(/^#[0-9a-f]{6}$/i), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() });
const eslSchema = z.object({ code: z.string().min(3), storeId: z.string(), shelfId: z.string(), productId: z.string() });
const ruleSchema = z.object({ storeId: z.string(), daysRemaining: z.number().int().nonnegative(), discountPercent: z.number().int().min(0).max(100), quarantine: z.boolean().default(false) });

export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  try {
    const user = await requireUser([Role.MANAGER, Role.ADMIN]);
    const { resource } = await context.params;
    const storeId = new URL(request.url).searchParams.get("storeId") || user.defaultStoreId || undefined;
    if (storeId && user.role !== Role.ADMIN && !user.storeIds.includes(storeId)) throw new ApiError(403, "Không có quyền tại cửa hàng", "STORE_FORBIDDEN");
    switch (resource) {
      case "stores": return Response.json(await prisma.store.findMany({ where: { id: { in: user.role === Role.ADMIN ? undefined : user.storeIds } }, orderBy: { name: "asc" } }));
      case "products": return Response.json(await prisma.product.findMany({ orderBy: { name: "asc" } }));
      case "suppliers": return Response.json(await prisma.supplier.findMany({ orderBy: { name: "asc" } }));
      case "lots": return Response.json(await prisma.lot.findMany({ where: storeId ? { storeId } : {}, include: { product: true, supplier: true }, orderBy: { expiryDate: "asc" } }));
      case "inventories": return Response.json(await prisma.inventory.findMany({ where: storeId ? { storeId } : {}, include: { product: true, shelf: true }, orderBy: { updatedAt: "desc" } }));
      case "zones": return Response.json(await prisma.zone.findMany({ where: storeId ? { storeId } : {}, orderBy: { name: "asc" } }));
      case "shelves": return Response.json(await prisma.shelf.findMany({ where: storeId ? { storeId } : {}, include: { zone: true, esls: true }, orderBy: { code: "asc" } }));
      case "esls": return Response.json(await prisma.eSL.findMany({ where: storeId ? { storeId } : {}, include: { product: true, shelf: true }, orderBy: { code: "asc" } }));
      case "fefo-rules": return Response.json(await prisma.fefoRule.findMany({ where: storeId ? { storeId } : {}, orderBy: { daysRemaining: "asc" } }));
      default: throw new ApiError(404, "Tài nguyên không tồn tại", "RESOURCE_NOT_FOUND");
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ resource: string }> }) {
  try {
    await requireUser([Role.ADMIN]);
    const { resource } = await context.params;
    const raw = await request.json();
    switch (resource) {
      case "stores": return Response.json(await prisma.store.create({ data: storeSchema.parse(raw) }), { status: 201 });
      case "products": {
        const data = productAdminSchema.parse(raw);
        return Response.json(await prisma.product.create({ data: { ...data, searchText: normalizeSearch(`${data.name} ${data.category} ${data.barcode} ${data.sku}`) } }), { status: 201 });
      }
      case "suppliers": return Response.json(await prisma.supplier.create({ data: supplierSchema.parse(raw) }), { status: 201 });
      case "lots": return Response.json(await prisma.lot.create({ data: lotSchema.parse(raw) }), { status: 201 });
      case "shelves": return Response.json(await prisma.shelf.create({ data: shelfSchema.parse(raw) }), { status: 201 });
      case "zones": return Response.json(await prisma.zone.create({ data: zoneSchema.parse(raw) }), { status: 201 });
      case "esls": return Response.json(await prisma.eSL.create({ data: eslSchema.parse(raw) }), { status: 201 });
      case "fefo-rules": return Response.json(await prisma.fefoRule.create({ data: ruleSchema.parse(raw) }), { status: 201 });
      case "users": {
        const data = userSchema.parse(raw);
        const passwordHash = await hash(data.password, 12);
        const created = await prisma.user.create({ data: { email: data.email.toLowerCase(), name: data.name, role: data.role, passwordHash, userStores: { create: data.storeIds.map((storeId, index) => ({ storeId, isDefault: index === 0 })) } }, select: { id: true, email: true, name: true, role: true, active: true } });
        return Response.json(created, { status: 201 });
      }
      case "inventories": {
        const data = inventoryAdminSchema.extend({ storeId: z.string(), shelfId: z.string(), productId: z.string() }).parse(raw);
        return Response.json(await prisma.inventory.create({ data }), { status: 201 });
      }
      default: throw new ApiError(404, "Tài nguyên không tồn tại", "RESOURCE_NOT_FOUND");
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
