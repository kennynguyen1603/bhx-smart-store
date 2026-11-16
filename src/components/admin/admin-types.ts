import type { RefObject } from "react";
import type { z } from "zod";
import type * as schemas from "./admin-form-schemas";

type Forms = {
  store: [typeof schemas.storeCreateSchema, typeof schemas.storeEditSchema];
  product: [typeof schemas.productCreateSchema, typeof schemas.productEditSchema];
  supplier: [typeof schemas.supplierCreateSchema, typeof schemas.supplierEditSchema];
  lot: [typeof schemas.lotCreateSchema, typeof schemas.lotEditSchema];
  zone: [typeof schemas.zoneCreateSchema, typeof schemas.zoneEditSchema];
  shelf: [typeof schemas.shelfCreateSchema, typeof schemas.shelfEditSchema];
  esl: [typeof schemas.eslCreateSchema, typeof schemas.eslEditSchema];
  "fefo-rule": [typeof schemas.fefoRuleCreateSchema, typeof schemas.fefoRuleEditSchema];
  user: [typeof schemas.userCreateSchema, typeof schemas.userEditSchema];
};
type ImmutableFields = {
  store: { code: string };
  product: { sku: string; barcode: string };
  supplier: { code: string };
  lot: { storeId: string; productId: string; supplierId: string; batchCode: string; receivedAt: string };
  zone: { storeId: string };
  shelf: { storeId: string; code: string };
  esl: { storeId: string; code: string };
  "fefo-rule": { storeId: string };
  user: { email: string };
};
export type AdminEntityKind = keyof Forms | "inventory" | "task";
export type AdminDialogDescriptor = {
  [Kind in keyof Forms]:
    | { kind: Kind; mode: "create"; defaultValues: Partial<z.input<Forms[Kind][0]>> }
    | { kind: Kind; mode: "edit"; id: string; defaultValues: z.input<Forms[Kind][1]>; readOnlyValues?: Kind extends keyof ImmutableFields ? ImmutableFields[Kind] : never }
}[keyof Forms] | { kind: "inventory"; mode: "edit"; id: string; defaultValues: schemas.InventoryValues } | { kind: "task"; mode: "create"; defaultValues: Partial<z.input<typeof schemas.taskCreateSchema>> };

export type AdminConfirmDescriptor = {
  kind: Exclude<AdminEntityKind, "inventory" | "task">;
  id: string;
  action: "hide" | "deactivate" | "close" | "detach" | "delete" | "lock";
  title: string;
  description: string;
  confirmLabel: string;
};

/** A confirmed write succeeds independently of any subsequent overview refresh. */
export type AdminSubmitResult = boolean | { ok: true } | { ok: false; error?: string };
export type ApiMutationResult = { ok: true; data: unknown } | { ok: false; message: string };
export type AdminDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onSubmit: () => Promise<AdminSubmitResult>;
  pending?: boolean;
  openerRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
};
