import { hash } from "bcryptjs";
import { Role } from "@/generated/prisma/client";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/api-auth";
import { inventoryAdminSchema, productAdminSchema } from "@/lib/contracts";
import { prisma } from "@/lib/db";
import { normalizeSearch } from "@/lib/normalize";
import { z } from "zod";

export async function PUT(request: Request, context: { params: Promise<{ resource: string; id: string }> }) {
  try {
    const user = await requireUser([Role.MANAGER, Role.ADMIN]);
    const { resource, id } = await context.params;
    const raw = await request.json();
    switch (resource) {
      case "stores": {
        if (user.role !== Role.ADMIN) throw new ApiError(403, "Chỉ Admin được sửa cửa hàng", "FORBIDDEN");
        const data = z.object({ code: z.string().min(2).optional(), name: z.string().min(2).optional(), address: z.string().min(5).optional(), mapWidth: z.number().int().min(6).max(30).optional(), mapHeight: z.number().int().min(4).max(20).optional(), active: z.boolean().optional() }).parse(raw);
        return Response.json(await prisma.store.update({ where: { id }, data }));
      }
      case "products": {
        if (user.role !== Role.ADMIN) throw new ApiError(403, "Chỉ Admin được sửa sản phẩm", "FORBIDDEN");
        const data = productAdminSchema.partial().parse(raw);
        const existing = await prisma.product.findUniqueOrThrow({ where: { id } });
        return Response.json(await prisma.product.update({ where: { id }, data: { ...data, searchText: normalizeSearch(`${data.name || existing.name} ${data.category || existing.category} ${data.barcode || existing.barcode} ${data.sku || existing.sku}`) } }));
      }
      case "inventories": {
        const existing = await prisma.inventory.findUniqueOrThrow({ where: { id } });
        if (user.role !== Role.ADMIN && !user.storeIds.includes(existing.storeId)) throw new ApiError(403, "Không có quyền tại cửa hàng", "STORE_FORBIDDEN");
        const data = inventoryAdminSchema.partial().parse(raw);
        const updated = await prisma.inventory.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
        await prisma.auditLog.create({ data: { actorId: user.id, storeId: existing.storeId, action: "INVENTORY_ADMIN_UPDATE", entityType: "Inventory", entityId: id, before: JSON.parse(JSON.stringify(existing)), after: JSON.parse(JSON.stringify(updated)) } });
        return Response.json(updated);
      }
      case "suppliers": {
        if (user.role !== Role.ADMIN) throw new ApiError(403, "Chỉ Admin được sửa nhà cung cấp", "FORBIDDEN");
        const data = z.object({ code: z.string().min(2).optional(), name: z.string().min(2).optional(), country: z.string().min(2).optional(), certificate: z.string().nullable().optional(), active: z.boolean().optional() }).parse(raw);
        return Response.json(await prisma.supplier.update({ where: { id }, data }));
      }
      case "users": {
        if (user.role !== Role.ADMIN) throw new ApiError(403, "Chỉ Admin được sửa người dùng", "FORBIDDEN");
        const data = z.object({ name: z.string().min(2).optional(), role: z.nativeEnum(Role).optional(), active: z.boolean().optional(), password: z.string().min(8).optional(), storeIds: z.array(z.string()).min(1).optional() }).parse(raw);
        const passwordHash = data.password ? await hash(data.password, 12) : undefined;
        return Response.json(await prisma.$transaction(async (tx) => {
          const updated = await tx.user.update({ where: { id }, data: { name: data.name, role: data.role, active: data.active, passwordHash } });
          if (data.storeIds) {
            await tx.userStore.deleteMany({ where: { userId: id } });
            await tx.userStore.createMany({ data: data.storeIds.map((storeId, index) => ({ userId: id, storeId, isDefault: index === 0 })) });
          }
          return { id: updated.id, email: updated.email, name: updated.name, role: updated.role, active: updated.active };
        }));
      }
      case "zones": {
        const zone = await prisma.zone.findUniqueOrThrow({ where: { id } });
        if (user.role !== Role.ADMIN && !user.storeIds.includes(zone.storeId)) throw new ApiError(403, "Không có quyền tại cửa hàng", "STORE_FORBIDDEN");
        const data = z.object({ name: z.string().min(2).optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), x: z.number().int().nonnegative().optional(), y: z.number().int().nonnegative().optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() }).parse(raw);
        return Response.json(await prisma.zone.update({ where: { id }, data }));
      }
      case "shelves": {
        const shelf = await prisma.shelf.findUniqueOrThrow({ where: { id } });
        if (user.role !== Role.ADMIN && !user.storeIds.includes(shelf.storeId)) throw new ApiError(403, "Không có quyền tại cửa hàng", "STORE_FORBIDDEN");
        const data = z.object({ label: z.string().min(2).optional(), zoneId: z.string().nullable().optional(), x: z.number().int().nonnegative().optional(), y: z.number().int().nonnegative().optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() }).parse(raw);
        return Response.json(await prisma.shelf.update({ where: { id }, data }));
      }
      case "esls": {
        const esl = await prisma.eSL.findUniqueOrThrow({ where: { id } });
        if (user.role !== Role.ADMIN && !user.storeIds.includes(esl.storeId)) throw new ApiError(403, "Không có quyền tại cửa hàng", "STORE_FORBIDDEN");
        const data = z.object({ shelfId: z.string().optional(), productId: z.string().optional(), ledOn: z.boolean().optional() }).parse(raw);
        return Response.json(await prisma.eSL.update({ where: { id }, data }));
      }
      case "fefo-rules": {
        const rule = await prisma.fefoRule.findUniqueOrThrow({ where: { id } });
        if (user.role !== Role.ADMIN && !user.storeIds.includes(rule.storeId)) throw new ApiError(403, "Không có quyền tại cửa hàng", "STORE_FORBIDDEN");
        const data = z.object({ daysRemaining: z.number().int().nonnegative().optional(), discountPercent: z.number().int().min(0).max(100).optional(), quarantine: z.boolean().optional(), active: z.boolean().optional() }).parse(raw);
        return Response.json(await prisma.fefoRule.update({ where: { id }, data }));
      }
      case "lots": {
        const lot = await prisma.lot.findUniqueOrThrow({ where: { id } });
        if (user.role !== Role.ADMIN && !user.storeIds.includes(lot.storeId)) throw new ApiError(403, "Không có quyền tại cửa hàng", "STORE_FORBIDDEN");
        const data = z.object({ quantity: z.number().int().nonnegative().optional(), expiryDate: z.coerce.date().optional(), origin: z.string().min(2).optional() }).parse(raw);
        return Response.json(await prisma.lot.update({ where: { id }, data }));
      }
      default: throw new ApiError(404, "Tài nguyên không tồn tại", "RESOURCE_NOT_FOUND");
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ resource: string; id: string }> }) {
  try {
    await requireUser([Role.ADMIN]);
    const { resource, id } = await context.params;
    switch (resource) {
      case "products": await prisma.product.update({ where: { id }, data: { active: false } }); break;
      case "stores": await prisma.store.update({ where: { id }, data: { active: false } }); break;
      case "users": await prisma.user.update({ where: { id }, data: { active: false } }); break;
      case "suppliers": await prisma.supplier.update({ where: { id }, data: { active: false } }); break;
      case "lots": await prisma.lot.update({ where: { id }, data: { quantity: 0, status: "SOLD_OUT" } }); break;
      case "fefo-rules": await prisma.fefoRule.delete({ where: { id } }); break;
      case "zones": await prisma.zone.delete({ where: { id } }); break;
      case "shelves": await prisma.shelf.delete({ where: { id } }); break;
      case "esls": await prisma.eSL.delete({ where: { id } }); break;
      default: throw new ApiError(404, "Tài nguyên không tồn tại hoặc không thể xoá", "RESOURCE_NOT_FOUND");
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
