import {
  IntegrationStatus,
  IntegrationType,
  LotStatus,
  MovementType,
  Prisma,
  Role,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "@/generated/prisma/client";
import { ApiError } from "@/lib/api-auth";
import type { SaleEventInput, SupplierLotInput, WmsInventoryInput } from "@/lib/contracts";
import { prisma } from "@/lib/db";
import { sendPushToStore, sendPushToUsers } from "@/lib/push";
import { daysUntilStoreDate } from "@/lib/store-calendar";
import { assertTaskClaimable } from "@/lib/task-access";
import { createAssignmentNotifications, createOutcomeNotifications } from "@/lib/task-notifications";

const ACTIVE_TASKS: TaskStatus[] = [TaskStatus.OPEN, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED];
const STARTABLE_TASKS: TaskStatus[] = [TaskStatus.OPEN, TaskStatus.BLOCKED];
const RESTOCKABLE_TASKS: TaskStatus[] = [TaskStatus.OPEN, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED];
const FEFO_TASKS: TaskType[] = [TaskType.FEFO, TaskType.QUARANTINE];
const FEFO_COMPLETABLE_TASKS: TaskStatus[] = [TaskStatus.OPEN, TaskStatus.IN_PROGRESS];

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function ensureTaskExecution(user: { role: Role }) {
  if (user.role !== Role.STAFF && user.role !== Role.ADMIN) {
    throw new ApiError(403, "Bạn không có quyền thực hiện thao tác này", "FORBIDDEN");
  }
}

async function claimStaffTaskForCompletion(
  tx: Prisma.TransactionClient,
  taskId: string,
  user: { id: string; role: Role },
  allowedStatuses: TaskStatus[],
) {
  if (user.role !== Role.STAFF) return;
  const claimed = await tx.task.updateMany({
    where: {
      id: taskId,
      status: { in: allowedStatuses },
      OR: [{ assigneeId: null }, { assigneeId: user.id }],
    },
    data: { assigneeId: user.id },
  });
  if (claimed.count === 1) return;
  const current = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
  assertTaskClaimable(current, user);
  throw new ApiError(409, "Nhiệm vụ đã kết thúc", "INVALID_TASK_STATE");
}

async function existingIntegration(externalEventId: string) {
  return prisma.integrationEvent.findUnique({ where: { externalEventId } });
}

export async function processSaleEvent(input: SaleEventInput) {
  const duplicate = await existingIntegration(input.externalEventId);
  if (duplicate) return { duplicate: true, ...(duplicate.result as object) };

  const outcome = await prisma.$transaction(async (tx) => {
    let push: { storeId: string; taskId: string; title: string; body: string } | null = null;
    const store = await tx.store.findUnique({ where: { code: input.storeCode } });
    const product = await tx.product.findUnique({ where: { sku: input.productSku } });
    if (!store || !product) throw new ApiError(404, "Không tìm thấy cửa hàng hoặc sản phẩm", "REFERENCE_NOT_FOUND");
    const shelf = await tx.shelf.findUnique({ where: { storeId_code: { storeId: store.id, code: input.shelfCode } } });
    if (!shelf) throw new ApiError(404, "Không tìm thấy kệ hàng", "SHELF_NOT_FOUND");

    await tx.integrationEvent.create({
      data: { externalEventId: input.externalEventId, storeId: store.id, type: IntegrationType.POS, status: IntegrationStatus.RECEIVED, payload: json(input) },
    });
    const inventory = await tx.inventory.findUnique({
      where: { storeId_shelfId_productId: { storeId: store.id, shelfId: shelf.id, productId: product.id } },
    });
    if (!inventory) throw new ApiError(404, "Sản phẩm chưa được gắn với kệ", "INVENTORY_NOT_FOUND");

    const afterShelf = Math.max(0, inventory.onShelf - input.quantity);
    const updated = await tx.inventory.update({
      where: { id: inventory.id },
      data: { onShelf: afterShelf, version: { increment: 1 } },
    });
    await tx.saleEvent.create({
      data: { externalEventId: input.externalEventId, storeId: store.id, shelfId: shelf.id, productId: product.id, quantity: input.quantity, priceVnd: input.priceVnd, occurredAt: input.occurredAt },
    });
    await tx.stockMovement.create({
      data: { inventoryId: inventory.id, type: MovementType.SALE, deltaShelf: -Math.min(input.quantity, inventory.onShelf), deltaBackroom: 0, beforeShelf: inventory.onShelf, afterShelf, note: `POS ${input.externalEventId}` },
    });

    let task = await tx.task.findFirst({
      where: { storeId: store.id, productId: product.id, shelfId: shelf.id, type: TaskType.RESTOCK, status: { in: ACTIVE_TASKS } },
    });
    let taskCreated = false;
    if (afterShelf <= inventory.lowThreshold) {
      const priority = afterShelf <= Math.floor(inventory.lowThreshold / 2) ? TaskPriority.HIGH : TaskPriority.MEDIUM;
      if (!task) {
        task = await tx.task.create({
          data: {
            storeId: store.id,
            productId: product.id,
            shelfId: shelf.id,
            type: TaskType.RESTOCK,
            status: TaskStatus.OPEN,
            priority,
            title: `Bổ sung ${product.name}`,
            note: `Tồn kệ còn ${afterShelf}/${inventory.capacity} · POS vừa ghi nhận dưới ngưỡng`,
          },
        });
        taskCreated = true;
        await tx.taskEvent.create({ data: { taskId: task.id, type: "CREATED" } });
        await createAssignmentNotifications(tx, task);
      } else if (priority === TaskPriority.HIGH && task.priority !== TaskPriority.HIGH) {
        task = await tx.task.update({ where: { id: task.id }, data: { priority, note: `Tồn kệ tiếp tục giảm, còn ${afterShelf}/${inventory.capacity}` } });
        await tx.taskEvent.create({ data: { taskId: task.id, type: "UPDATED", note: task.note } });
      }
      await tx.eSL.updateMany({ where: { storeId: store.id, shelfId: shelf.id, productId: product.id }, data: { ledOn: true } });
      if (taskCreated && task) push = { storeId: store.id, taskId: task.id, title: "Kệ hàng sắp hết", body: `${product.name} · ${shelf.label}` };
    }

    const response = { inventory: { id: updated.id, onShelf: updated.onShelf, version: updated.version }, task, taskCreated };
    await tx.integrationEvent.update({ where: { externalEventId: input.externalEventId }, data: { status: IntegrationStatus.PROCESSED, result: json(response), processedAt: new Date() } });
    return { response, push };
  });

  if (outcome.push) {
    await sendPushToStore(outcome.push.storeId, {
      title: outcome.push.title,
      body: outcome.push.body,
      url: `/staff?storeId=${outcome.push.storeId}&task=${outcome.push.taskId}`,
      tag: outcome.push.taskId,
    });
  }
  return { duplicate: false, ...outcome.response };
}

export async function processWmsInventory(input: WmsInventoryInput) {
  const duplicate = await existingIntegration(input.externalEventId);
  if (duplicate) return { duplicate: true, ...(duplicate.result as object) };
  return prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { code: input.storeCode } });
    const product = await tx.product.findUnique({ where: { sku: input.productSku } });
    if (!store || !product) throw new ApiError(404, "Không tìm thấy cửa hàng hoặc sản phẩm", "REFERENCE_NOT_FOUND");
    const shelf = await tx.shelf.findUnique({ where: { storeId_code: { storeId: store.id, code: input.shelfCode } } });
    if (!shelf) throw new ApiError(404, "Không tìm thấy kệ", "SHELF_NOT_FOUND");
    const inventory = await tx.inventory.findUnique({ where: { storeId_shelfId_productId: { storeId: store.id, shelfId: shelf.id, productId: product.id } } });
    if (!inventory) throw new ApiError(404, "Không tìm thấy tồn kho", "INVENTORY_NOT_FOUND");
    await tx.integrationEvent.create({ data: { externalEventId: input.externalEventId, storeId: store.id, type: IntegrationType.WMS, payload: json(input) } });
    const nextShelf = input.onShelf ?? inventory.onShelf;
    const updated = await tx.inventory.update({ where: { id: inventory.id }, data: { backroom: input.backroom, onShelf: nextShelf, version: { increment: 1 } } });
    await tx.stockMovement.create({ data: { inventoryId: inventory.id, type: MovementType.WMS_SYNC, deltaShelf: nextShelf - inventory.onShelf, deltaBackroom: input.backroom - inventory.backroom, beforeShelf: inventory.onShelf, afterShelf: nextShelf, note: `WMS ${input.externalEventId}` } });
    const response = { inventory: { id: updated.id, onShelf: updated.onShelf, backroom: updated.backroom, version: updated.version } };
    await tx.integrationEvent.update({ where: { externalEventId: input.externalEventId }, data: { status: IntegrationStatus.PROCESSED, result: json(response), processedAt: new Date() } });
    return { duplicate: false, ...response };
  });
}

export async function processSupplierLot(input: SupplierLotInput) {
  const duplicate = await existingIntegration(input.externalEventId);
  if (duplicate) return { duplicate: true, ...(duplicate.result as object) };
  return prisma.$transaction(async (tx) => {
    const [store, product, supplier] = await Promise.all([
      tx.store.findUnique({ where: { code: input.storeCode } }),
      tx.product.findUnique({ where: { sku: input.productSku } }),
      tx.supplier.findUnique({ where: { code: input.supplierCode } }),
    ]);
    if (!store || !product || !supplier) throw new ApiError(404, "Thiếu cửa hàng, sản phẩm hoặc nhà cung cấp", "REFERENCE_NOT_FOUND");
    await tx.integrationEvent.create({ data: { externalEventId: input.externalEventId, storeId: store.id, type: IntegrationType.SUPPLIER, payload: json(input) } });
    const lot = await tx.lot.upsert({
      where: { storeId_productId_batchCode: { storeId: store.id, productId: product.id, batchCode: input.batchCode } },
      update: { supplierId: supplier.id, origin: input.origin, quantity: input.quantity, receivedAt: input.receivedAt, expiryDate: input.expiryDate, status: LotStatus.AVAILABLE },
      create: { storeId: store.id, productId: product.id, supplierId: supplier.id, batchCode: input.batchCode, origin: input.origin, quantity: input.quantity, receivedAt: input.receivedAt, expiryDate: input.expiryDate },
    });
    const response = { lot: { id: lot.id, batchCode: lot.batchCode, expiryDate: lot.expiryDate.toISOString() } };
    await tx.integrationEvent.update({ where: { externalEventId: input.externalEventId }, data: { status: IntegrationStatus.PROCESSED, result: json(response), processedAt: new Date() } });
    return { duplicate: false, ...response };
  });
}

export async function startTask(taskId: string, user: { id: string; role: Role; storeIds: string[] }, clientMutationId: string) {
  ensureTaskExecution(user);
  const receipt = await prisma.mutationReceipt.findUnique({ where: { clientMutationId } });
  if (receipt) return receipt.response as object;
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) throw new ApiError(404, "Không tìm thấy nhiệm vụ", "TASK_NOT_FOUND");
    if (user.role !== Role.ADMIN && !user.storeIds.includes(task.storeId)) throw new ApiError(403, "Nhiệm vụ thuộc cửa hàng khác", "STORE_FORBIDDEN");
    const startedAt = new Date();
    if (user.role === Role.STAFF) {
      const claimed = await tx.task.updateMany({
        where: {
          id: taskId,
          status: { in: STARTABLE_TASKS },
          OR: [{ assigneeId: null }, { assigneeId: user.id }],
        },
        data: { status: TaskStatus.IN_PROGRESS, assigneeId: user.id, startedAt },
      });
      if (claimed.count !== 1) {
        const current = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
        assertTaskClaimable(current, user);
        throw new ApiError(409, "Nhiệm vụ không thể bắt đầu", "INVALID_TASK_STATE");
      }
    } else {
      assertTaskClaimable(task, user);
      if (!STARTABLE_TASKS.includes(task.status)) throw new ApiError(409, "Nhiệm vụ không thể bắt đầu", "INVALID_TASK_STATE");
      await tx.task.update({ where: { id: taskId }, data: { status: TaskStatus.IN_PROGRESS, assigneeId: user.id, startedAt } });
    }
    const updated = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    await tx.taskEvent.create({ data: { taskId, actorId: user.id, type: "STARTED" } });
    const response = { task: { id: updated.id, status: updated.status, startedAt: updated.startedAt?.toISOString() } };
    await tx.mutationReceipt.create({ data: { clientMutationId, userId: user.id, action: "TASK_START", response: json(response) } });
    return response;
  });
}

export async function completeRestock(
  taskId: string,
  user: { id: string; role: Role; storeIds: string[] },
  input: { quantity: number; expectedVersion: number; clientMutationId: string },
) {
  ensureTaskExecution(user);
  const receipt = await prisma.mutationReceipt.findUnique({ where: { clientMutationId: input.clientMutationId } });
  if (receipt) return receipt.response as object;
  const outcome = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task || task.type !== TaskType.RESTOCK) throw new ApiError(404, "Không tìm thấy nhiệm vụ bổ sung", "TASK_NOT_FOUND");
    if (user.role !== Role.ADMIN && !user.storeIds.includes(task.storeId)) throw new ApiError(403, "Nhiệm vụ thuộc cửa hàng khác", "STORE_FORBIDDEN");
    await claimStaffTaskForCompletion(tx, task.id, user, RESTOCKABLE_TASKS);
    if (user.role !== Role.STAFF) {
      assertTaskClaimable(task, user);
      if (!RESTOCKABLE_TASKS.includes(task.status)) throw new ApiError(409, "Nhiệm vụ đã kết thúc", "INVALID_TASK_STATE");
    }
    const inventory = await tx.inventory.findUniqueOrThrow({ where: { storeId_shelfId_productId: { storeId: task.storeId, shelfId: task.shelfId, productId: task.productId } } });
    if (inventory.version !== input.expectedVersion) {
      throw new ApiError(409, "Tồn kệ vừa được người khác cập nhật. Hãy kiểm đếm lại.", "VERSION_CONFLICT", { currentVersion: inventory.version, onShelf: inventory.onShelf, backroom: inventory.backroom });
    }
    const movable = Math.min(input.quantity, inventory.backroom, Math.max(0, inventory.capacity - inventory.onShelf));
    if (movable <= 0 || movable !== input.quantity) throw new ApiError(422, "Số lượng vượt sức chứa hoặc tồn kho sau", "INVALID_QUANTITY", { maxQuantity: movable });
    const afterShelf = inventory.onShelf + movable;
    const afterBackroom = inventory.backroom - movable;
    const blocked = afterShelf <= inventory.lowThreshold;
    const nextStatus = blocked ? TaskStatus.BLOCKED : TaskStatus.COMPLETED;
    const inventoryUpdate = await tx.inventory.updateMany({
      where: { id: inventory.id, version: input.expectedVersion },
      data: { onShelf: afterShelf, backroom: afterBackroom, version: { increment: 1 } },
    });
    if (inventoryUpdate.count !== 1) {
      const current = await tx.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
      throw new ApiError(409, "Tồn kệ vừa được người khác cập nhật. Hãy kiểm đếm lại.", "VERSION_CONFLICT", { currentVersion: current.version, onShelf: current.onShelf, backroom: current.backroom });
    }
    const updatedInventory = await tx.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
    const updatedTask = await tx.task.update({ where: { id: task.id }, data: { status: nextStatus, assigneeId: user.id, completedAt: blocked ? null : new Date(), note: blocked ? `Đã bổ sung ${movable}, nhưng tồn kệ vẫn dưới ngưỡng` : `Đã bổ sung ${movable} sản phẩm` } });
    await tx.stockMovement.create({ data: { inventoryId: inventory.id, taskId: task.id, actorId: user.id, clientMutationId: input.clientMutationId, type: MovementType.RESTOCK, deltaShelf: movable, deltaBackroom: -movable, beforeShelf: inventory.onShelf, afterShelf, note: updatedTask.note } });
    await tx.taskEvent.create({ data: { taskId: task.id, actorId: user.id, type: blocked ? "BLOCKED" : "COMPLETED", note: updatedTask.note } });
    await tx.eSL.updateMany({ where: { storeId: task.storeId, shelfId: task.shelfId, productId: task.productId }, data: { ledOn: blocked } });
    const recipients = await createOutcomeNotifications(tx, updatedTask, blocked ? "BLOCKED" : "COMPLETED");
    await tx.auditLog.create({ data: { actorId: user.id, storeId: task.storeId, action: "RESTOCK", entityType: "Inventory", entityId: inventory.id, before: json({ onShelf: inventory.onShelf, backroom: inventory.backroom, version: inventory.version }), after: json({ onShelf: afterShelf, backroom: afterBackroom, version: updatedInventory.version }) } });
    const response = { task: { id: updatedTask.id, status: updatedTask.status, note: updatedTask.note }, inventory: { id: updatedInventory.id, onShelf: updatedInventory.onShelf, backroom: updatedInventory.backroom, version: updatedInventory.version } };
    await tx.mutationReceipt.create({ data: { clientMutationId: input.clientMutationId, userId: user.id, action: "RESTOCK", response: json(response) } });
    return { response, recipients, task: updatedTask };
  });
  await sendOutcomePush(outcome.recipients, outcome.task);
  return outcome.response;
}

async function sendOutcomePush(recipients: string[], task: { id: string; storeId: string; title: string; note: string | null; status: TaskStatus }) {
  await sendPushToUsers(recipients, {
    title: task.status === TaskStatus.BLOCKED ? "Nhiệm vụ bị chặn" : "Nhiệm vụ hoàn thành",
    body: `${task.title} · ${task.note || "Đã cập nhật nhiệm vụ"}`,
    url: `/admin?storeId=${task.storeId}&task=${task.id}`,
    tag: task.id,
  }).catch((error) => console.error("Task outcome push failed", error));
}

function daysRemaining(expiryDate: Date, now = new Date()) {
  const expiry = Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.ceil((expiry - today) / 86_400_000);
}

export async function runFefoEngine(now = new Date()) {
  const stores = await prisma.store.findMany({ where: { active: true }, include: { fefoRules: { where: { active: true }, orderBy: { daysRemaining: "asc" } } } });
  let created = 0;
  for (const store of stores) {
    const maxDays = Math.max(...store.fefoRules.map((rule) => rule.daysRemaining), 0);
    const end = new Date(now);
    // expiryDate is a date-only column: bound candidates by the store's day.
    end.setUTCDate(end.getUTCDate() + maxDays - daysUntilStoreDate(now, now, store.timeZone));
    end.setUTCHours(0, 0, 0, 0);
    const lots = await prisma.lot.findMany({ where: { storeId: store.id, quantity: { gt: 0 }, status: { in: [LotStatus.AVAILABLE, LotStatus.MARKED_DOWN] }, expiryDate: { lte: end } }, include: { product: true } });
    for (const lot of lots) {
      const days = daysUntilStoreDate(lot.expiryDate, now, store.timeZone);
      const rule = store.fefoRules.find((item) => days <= item.daysRemaining);
      if (!rule) continue;
      const type = rule.quarantine || days <= 0 ? TaskType.QUARANTINE : TaskType.FEFO;
      if (type === TaskType.FEFO && (lot.markdownPercent ?? 0) >= rule.discountPercent) continue;
      const active = await prisma.task.findFirst({ where: { lotId: lot.id, type, status: { in: ACTIVE_TASKS } } });
      if (active) continue;
      const inventory = await prisma.inventory.findFirst({ where: { storeId: store.id, productId: lot.productId } });
      if (!inventory) continue;
      const task = await prisma.$transaction(async (tx) => {
        const saved = await tx.task.create({ data: { storeId: store.id, productId: lot.productId, shelfId: inventory.shelfId, lotId: lot.id, type, status: TaskStatus.OPEN, priority: days <= 1 ? TaskPriority.HIGH : TaskPriority.MEDIUM, title: type === TaskType.QUARANTINE ? `Cách ly ${lot.product.name}` : `Dán nhãn FEFO ${lot.product.name}`, note: type === TaskType.QUARANTINE ? `Lô ${lot.batchCode} đã hết hạn` : `Lô ${lot.batchCode} còn ${days} ngày · Giảm ${rule.discountPercent}%`, dueAt: now } });
        await tx.taskEvent.create({ data: { taskId: saved.id, type: "CREATED" } });
        await createAssignmentNotifications(tx, saved);
        await tx.eSL.updateMany({ where: { storeId: store.id, productId: lot.productId, shelfId: inventory.shelfId }, data: { ledOn: true } });
        return saved;
      });
      created += 1;
      await sendPushToStore(store.id, { title: task.title, body: task.note || "Nhiệm vụ FEFO mới", url: `/staff?storeId=${store.id}&task=${task.id}`, tag: task.id });
    }
  }
  return { created, ranAt: now.toISOString() };
}

export async function completeFefoTask(taskId: string, user: { id: string; role: Role; storeIds: string[] }, clientMutationId: string) {
  ensureTaskExecution(user);
  const receipt = await prisma.mutationReceipt.findUnique({ where: { clientMutationId } });
  if (receipt) return receipt.response as object;
  const outcome = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId }, include: { lot: true, product: true, store: { select: { timeZone: true } } } });
    if (!task?.lot || !FEFO_TASKS.includes(task.type)) throw new ApiError(404, "Không tìm thấy nhiệm vụ FEFO", "TASK_NOT_FOUND");
    if (user.role !== Role.ADMIN && !user.storeIds.includes(task.storeId)) throw new ApiError(403, "Nhiệm vụ thuộc cửa hàng khác", "STORE_FORBIDDEN");
    assertTaskClaimable(task, user);
    if (!FEFO_COMPLETABLE_TASKS.includes(task.status)) throw new ApiError(409, "Nhiệm vụ đã kết thúc", "INVALID_TASK_STATE");
    const now = new Date();
    const days = daysUntilStoreDate(task.lot.expiryDate, now, task.store.timeZone);
    const rule = await tx.fefoRule.findFirst({ where: { storeId: task.storeId, active: true, daysRemaining: { gte: days } }, orderBy: { daysRemaining: "asc" } });
    const quarantine = task.type === TaskType.QUARANTINE || days <= 0 || rule?.quarantine === true;
    const lotId = task.lot.id;
    const cancelSuperseded = async (discountPercent: number) => {
      // Keep the current lot sellable through cancellation without changing its data.
      // The task row is claimed first on every path to preserve lock ordering.
      await tx.$queryRaw`SELECT id FROM "Lot" WHERE id = ${lotId} FOR UPDATE`;
      const currentLot = await tx.lot.findUniqueOrThrow({ where: { id: lotId } });
      if ((currentLot.status !== LotStatus.AVAILABLE && currentLot.status !== LotStatus.MARKED_DOWN) || currentLot.quantity <= 0) {
        throw new ApiError(409, "Lô không còn đủ điều kiện bán để giảm giá", "LOT_NOT_SELLABLE");
      }
      const markdownPercent = currentLot.markdownPercent ?? 0;
      if (markdownPercent < discountPercent) return null;
      const note = `Không cần xử lý: lô đã giảm ${markdownPercent}%, bằng hoặc cao hơn quy tắc ${discountPercent}%.`;
      const cancelled = await tx.task.updateMany({
        where: {
          id: task.id,
          status: { in: FEFO_COMPLETABLE_TASKS },
          ...(user.role === Role.STAFF ? { OR: [{ assigneeId: null }, { assigneeId: user.id }] } : {}),
        },
        data: { status: TaskStatus.CANCELLED, assigneeId: user.id, completedAt: null, note },
      });
      if (cancelled.count !== 1) {
        const current = await tx.task.findUniqueOrThrow({ where: { id: task.id } });
        assertTaskClaimable(current, user);
        throw new ApiError(409, "Nhiệm vụ đã kết thúc", "INVALID_TASK_STATE");
      }
      const updatedTask = await tx.task.findUniqueOrThrow({ where: { id: task.id } });
      await tx.taskEvent.create({ data: { taskId: task.id, actorId: user.id, type: "CANCELLED", note } });
      // Serialize this read/write with task creators that turn the same ESL on.
      await tx.$queryRaw`SELECT id FROM "ESL" WHERE "storeId" = ${task.storeId} AND "productId" = ${task.productId} AND "shelfId" = ${task.shelfId} FOR UPDATE`;
      const activeSibling = await tx.task.findFirst({ where: { storeId: task.storeId, productId: task.productId, shelfId: task.shelfId, status: { in: ACTIVE_TASKS } }, select: { id: true } });
      await tx.eSL.updateMany({ where: { storeId: task.storeId, productId: task.productId, shelfId: task.shelfId }, data: { ledOn: activeSibling !== null } });
      await tx.auditLog.create({ data: { actorId: user.id, storeId: task.storeId, action: "FEFO_TASK_SUPERSEDED", entityType: "Task", entityId: task.id, before: json({ status: task.status, assigneeId: task.assigneeId, note: task.note }), after: json({ status: updatedTask.status, assigneeId: updatedTask.assigneeId, note }) } });
      const response = { resolution: "ALREADY_APPLIED" as const, task: { id: updatedTask.id, status: updatedTask.status, note }, lot: { id: currentLot.id, status: currentLot.status, markdownPercent: currentLot.markdownPercent, markdownPriceVnd: currentLot.markdownPriceVnd } };
      await tx.mutationReceipt.create({ data: { clientMutationId, userId: user.id, action: "FEFO_COMPLETE", response: json(response) } });
      return { response, recipients: [] as string[], task: updatedTask };
    };
    if (!quarantine) {
      if (!rule) throw new ApiError(422, "Không có quy tắc FEFO phù hợp", "FEFO_RULE_NOT_FOUND");
      if ((task.lot.status !== LotStatus.AVAILABLE && task.lot.status !== LotStatus.MARKED_DOWN) || task.lot.quantity <= 0) {
        throw new ApiError(409, "Lô không còn đủ điều kiện bán để giảm giá", "LOT_NOT_SELLABLE");
      }
    }
    const claimed = await tx.task.updateMany({
      where: {
        id: task.id,
        status: { in: FEFO_COMPLETABLE_TASKS },
        ...(user.role === Role.STAFF ? { OR: [{ assigneeId: null }, { assigneeId: user.id }] } : {}),
      },
      // Hold the task claim while deciding whether the lot needs an upgrade.
      data: { assigneeId: user.id },
    });
    if (claimed.count !== 1) {
      const current = await tx.task.findUniqueOrThrow({ where: { id: task.id } });
      assertTaskClaimable(current, user);
      throw new ApiError(409, "Nhiệm vụ đã kết thúc", "INVALID_TASK_STATE");
    }
    if (!quarantine && rule && (task.lot.markdownPercent ?? 0) >= rule.discountPercent) {
      const superseded = await cancelSuperseded(rule.discountPercent);
      if (superseded) return superseded;
    }
    let lot;
    if (quarantine) {
      lot = await tx.lot.update({ where: { id: task.lot.id }, data: { status: LotStatus.QUARANTINED } });
    } else {
      // The rule was validated before claiming the task; discounts replace the current price.
      if (!rule) throw new ApiError(422, "Không có quy tắc FEFO phù hợp", "FEFO_RULE_NOT_FOUND");
      const markdownPriceVnd = Math.round((task.product.basePriceVnd * (100 - rule.discountPercent)) / 100);
      // Different tasks can target one lot; recheck sellability and discount atomically.
      const upgraded = await tx.lot.updateMany({
        where: {
          id: task.lot.id,
          status: { in: [LotStatus.AVAILABLE, LotStatus.MARKED_DOWN] },
          quantity: { gt: 0 },
          OR: [{ markdownPercent: null }, { markdownPercent: { lt: rule.discountPercent } }],
        },
        data: { status: LotStatus.MARKED_DOWN, markdownPercent: rule.discountPercent, markdownPriceVnd },
      });
      if (upgraded.count !== 1) {
        const currentLot = await tx.lot.findUniqueOrThrow({ where: { id: task.lot.id } });
        if ((currentLot.status !== LotStatus.AVAILABLE && currentLot.status !== LotStatus.MARKED_DOWN) || currentLot.quantity <= 0) {
          throw new ApiError(409, "Lô không còn đủ điều kiện bán để giảm giá", "LOT_NOT_SELLABLE");
        }
        if ((currentLot.markdownPercent ?? 0) >= rule.discountPercent) {
          const superseded = await cancelSuperseded(rule.discountPercent);
          if (superseded) return superseded;
        }
        throw new ApiError(409, "Lô đã có mức giảm giá bằng hoặc cao hơn quy tắc hiện tại", "MARKDOWN_NOT_UPGRADABLE");
      }
      lot = await tx.lot.findUniqueOrThrow({ where: { id: task.lot.id } });
      await tx.markdown.create({ data: { lotId: lot.id, discountPercent: rule.discountPercent, originalPriceVnd: task.product.basePriceVnd, markdownPriceVnd } });
    }
    const updatedTask = await tx.task.update({ where: { id: task.id }, data: { status: TaskStatus.COMPLETED, completedAt: new Date(), note: quarantine ? `Đã cách ly lô ${lot.batchCode}` : `Đã dán nhãn giảm ${lot.markdownPercent}% cho lô ${lot.batchCode}` } });
    await tx.taskEvent.create({ data: { taskId: task.id, actorId: user.id, type: "COMPLETED", note: updatedTask.note } });
    await tx.eSL.updateMany({ where: { storeId: task.storeId, productId: task.productId, shelfId: task.shelfId }, data: { ledOn: false } });
    const recipients = await createOutcomeNotifications(tx, updatedTask, "COMPLETED");
    await tx.auditLog.create({ data: { actorId: user.id, storeId: task.storeId, action: quarantine ? "LOT_QUARANTINE" : "FEFO_MARKDOWN", entityType: "Lot", entityId: lot.id, before: json(task.lot), after: json(lot) } });
    const response = { task: { id: updatedTask.id, status: updatedTask.status, note: updatedTask.note }, lot: { id: lot.id, status: lot.status, markdownPercent: lot.markdownPercent, markdownPriceVnd: lot.markdownPriceVnd } };
    await tx.mutationReceipt.create({ data: { clientMutationId, userId: user.id, action: "FEFO_COMPLETE", response: json(response) } });
    return { response, recipients, task: updatedTask };
  });
  if (outcome.task.status === TaskStatus.COMPLETED) await sendOutcomePush(outcome.recipients, outcome.task);
  return outcome.response;
}

export { daysRemaining };
