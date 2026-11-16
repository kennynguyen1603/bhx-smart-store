import QRCode from "qrcode";
import { TaskStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

export type EslTaskBadge = "RESTOCK" | "FEFO" | "QUARANTINE";
export type QrEncoder = (code: string, options: { errorCorrectionLevel: "M"; width: number; margin: number }) => Promise<string>;
export type LabelStoreOption = { id: string; code: string; name: string };
export type EslLabelRecord = {
  id: string;
  code: string;
  store: LabelStoreOption;
  shelf: { id: string; code: string; label: string };
  product: { id: string; name: string };
  badges: EslTaskBadge[];
  dataUrl: string;
  error: string;
};

const ACTIVE_STATUSES: TaskStatus[] = [TaskStatus.OPEN, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED];
const BADGE_ORDER: EslTaskBadge[] = ["RESTOCK", "FEFO", "QUARANTINE"];

export function activeTaskBadges(tasks: Array<{ type: EslTaskBadge; status: TaskStatus }>): EslTaskBadge[] {
  const active = new Set(tasks.filter((task) => ACTIVE_STATUSES.includes(task.status)).map((task) => task.type));
  return BADGE_ORDER.filter((type) => active.has(type));
}

export async function encodeEslLabelQr(
  code: string,
  encoder: QrEncoder = (value, options) => QRCode.toDataURL(value, options),
): Promise<{ dataUrl: string; error: string }> {
  try {
    return { dataUrl: await encoder(code, { errorCorrectionLevel: "M", width: 320, margin: 2 }), error: "" };
  } catch {
    return { dataUrl: "", error: "Không thể tạo mã QR lúc này. Hãy dùng mã ESL bên dưới để nhập thủ công." };
  }
}

function assignmentKey(value: { storeId: string; shelfId: string; productId: string }): string {
  return JSON.stringify([value.storeId, value.shelfId, value.productId]);
}

export async function loadEslLabels(storeId?: string): Promise<{
  stores: LabelStoreOption[];
  selectedStoreId: string | null;
  labels: EslLabelRecord[];
}> {
  const stores = await prisma.store.findMany({
    where: { active: true },
    select: { id: true, code: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const store = stores.find((option) => option.id === storeId) ?? stores[0];
  if (!store) return { stores, selectedStoreId: null, labels: [] };

  const esls = await prisma.eSL.findMany({
    where: { storeId: store.id },
    orderBy: { code: "asc" },
    select: {
      id: true, code: true, storeId: true, shelfId: true, productId: true,
      shelf: { select: { id: true, code: true, label: true } },
      product: { select: { id: true, name: true } },
    },
  });
  if (!esls.length) return { stores, selectedStoreId: store.id, labels: [] };

  const tasks = await prisma.task.findMany({
    where: {
      storeId: store.id,
      status: { in: ACTIVE_STATUSES },
      OR: esls.map(({ shelfId, productId }) => ({ shelfId, productId })),
    },
    select: { storeId: true, shelfId: true, productId: true, type: true, status: true },
  });
  const tasksByAssignment = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const key = assignmentKey(task);
    const matching = tasksByAssignment.get(key) ?? [];
    matching.push(task);
    tasksByAssignment.set(key, matching);
  }
  const labels = await Promise.all(esls.map(async (esl): Promise<EslLabelRecord> => ({
    id: esl.id,
    code: esl.code,
    store,
    shelf: esl.shelf,
    product: esl.product,
    badges: activeTaskBadges(tasksByAssignment.get(assignmentKey(esl)) ?? []),
    ...await encodeEslLabelQr(esl.code),
  })));
  return { stores, selectedStoreId: store.id, labels };
}
