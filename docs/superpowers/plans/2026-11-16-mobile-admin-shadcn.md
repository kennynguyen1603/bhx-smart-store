# Mobile Reliability and Shadcn Admin Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Staff/Manager mobile controls reliable and replace every native Admin CRUD prompt/confirmation with validated, pending-safe shadcn dialogs.

**Architecture:** Add source-owned shadcn/Radix primitives styled with existing BHX tokens, then move Admin CRUD into focused form modules driven by one typed dialog descriptor. Keep APIs and authorization stable, except for the confirmed inventory partial-schema parser fix. Mobile Staff/Manager and integration pending behavior remain separate tasks with focused E2E coverage.

**Tech Stack:** Next.js 16, React 19, TypeScript, Radix UI, React Hook Form, Zod, Sonner, Vitest/Happy DOM, Playwright, Prisma/PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-11-16-mobile-admin-shadcn-design.md`

## Global Constraints

- No `prompt()`, `confirm()`, or browser `alert()` may remain in Admin CRUD.
- Preserve current API routes, payload contracts, role authorization, custom CSS, and Kiosk/task modal behavior.
- All labels, validation messages, pending text, and errors are Vietnamese.
- Dialogs close only after confirmed mutation success; a refresh failure must not retry a committed write.
- Unsupported edit fields are read-only and edits initialize from persisted references, never the first available option.
- All interactive mobile controls are nonshrinking and at least 44×44px at 320px, 390px, and 760px.
- Existing FEFO simulation remains global and must be labeled accurately.
- Every production change follows RED → GREEN TDD and each task ends with a focused commit.

## Review Focus

- Mutation succeeds but overview refresh fails: dialog closes once, toast distinguishes stale refresh, no duplicate POST/PUT.
- Dialog submission is double-clicked or Escape/backdrop is used while pending: only one request and dialog remains until resolved.
- Edit records have non-first references or multiple memberships/ESLs: current values and default membership remain intact.
- Mobile width is 320px with notification count, reload, and logout present: no overlap and notification receives the click.
- Push or integration request rejects/hangs: pending clears, retry is possible, and no false success appears.

---

### Task 1: Shadcn UI foundation and Admin form contracts

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/utils.ts`
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/label.tsx`
- Create: `src/components/ui/dialog.tsx`
- Create: `src/components/ui/alert-dialog.tsx`
- Create: `src/components/ui/select.tsx`
- Create: `src/components/ui/checkbox.tsx`
- Create: `src/components/ui/form.tsx`
- Create: `src/components/ui/sonner.tsx`
- Create: `src/components/admin/admin-types.ts`
- Create: `src/components/admin/admin-form-schemas.ts`
- Create: `src/components/admin/admin-entity-dialog.tsx`
- Create: `src/components/admin/admin-confirm-dialog.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/unit/admin-form-schemas.test.ts`
- Test: `tests/unit/admin-dialogs.test.tsx`

**Interfaces:**
- Produces: `AdminDialogDescriptor`, `AdminConfirmDescriptor`, dedicated Zod schemas, `AdminEntityDialog`, `AdminConfirmDialog`, and shadcn UI primitives used by Tasks 2–5.
- Dependency versions: install official Radix primitives needed by generated components, `react-hook-form`, `@hookform/resolvers`, `sonner`, `class-variance-authority`, `clsx`, and `tailwind-merge`; do not add a global Tailwind reset.

- [ ] **Step 1: Write failing schema and dialog tests**

Assert Vietnamese field errors for invalid inventory capacity/threshold, invalid lot expiry/quantity, invalid hex color, invalid FEFO percent, and user without store. Assert a pending entity/confirm dialog disables submit/cancel and ignores dismissal.

- [ ] **Step 2: Run focused tests and observe RED**

Run: `npm test -- tests/unit/admin-form-schemas.test.ts tests/unit/admin-dialogs.test.tsx`

Expected: FAIL because modules/components do not exist.

- [ ] **Step 3: Install dependencies and add source-owned shadcn primitives**

Use Radix accessibility behavior and `cn(...inputs: ClassValue[]): string`. Scope visual CSS under `.admin-dialog-*`/`.ui-*`; retain current global modal rules unchanged.

- [ ] **Step 4: Define form schemas and dialog descriptors**

Create schemas for store, inventory, product, supplier, lot, zone, shelf, ESL, FEFO rule, and user create/edit. Export inferred value types. Dialog shells accept async submit callbacks, pending state, server error display via Sonner, and opener focus fallback.

- [ ] **Step 5: Run focused tests and static checks**

Run: `npm test -- tests/unit/admin-form-schemas.test.ts tests/unit/admin-dialogs.test.tsx && npm run typecheck`

Expected: all focused tests and typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/utils.ts src/components/ui src/components/admin src/app/globals.css tests/unit/admin-form-schemas.test.ts tests/unit/admin-dialogs.test.tsx
git commit -m "feat: add shadcn admin form foundation"
```

### Task 2: Inventory API fix and core Admin dialogs

**Files:**
- Modify: `src/lib/contracts.ts`
- Modify: `src/app/api/admin/[resource]/[id]/route.ts`
- Create: `src/components/admin/forms/store-form.tsx`
- Create: `src/components/admin/forms/inventory-form.tsx`
- Create: `src/components/admin/forms/product-form.tsx`
- Create: `src/components/admin/forms/supplier-form.tsx`
- Modify: `src/components/admin-app.tsx`
- Test: `tests/integration/admin-resource-routes.test.ts`
- Test: `tests/unit/admin-core-forms.test.tsx`
- Test: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: Task 1 schemas, UI primitives, `AdminDialogDescriptor`, `AdminEntityDialog`.
- Produces: `ApiMutationResult = { ok: true; data: unknown } | { ok: false; message: string }`; core create/edit dialogs with immutable fields read-only.

- [ ] **Step 1: Write failing inventory route regression**

Test a partial inventory PUT updates valid quantities, increments version once, writes one audit, and rejects `onShelf > capacity` without mutation. Reproduce the current `.partial()` refinement exception before implementation.

- [ ] **Step 2: Write failing core-form tests/E2E**

Assert existing values populate Store, Inventory, Product, and Supplier dialogs; invalid values show Vietnamese messages; a simulated server failure preserves the form and a double submit sends one request. E2E must fail if a native `dialog` event fires.

- [ ] **Step 3: Run focused tests and observe RED**

Run: `npm test -- tests/integration/admin-resource-routes.test.ts tests/unit/admin-core-forms.test.tsx`

- [ ] **Step 4: Fix inventory parsing at the API boundary**

Export an unrefined inventory base object schema. For PUT, parse optional fields against the base partial, merge with persisted values, validate using the complete refined schema, then update only submitted fields plus version. Preserve authorization and audit behavior.

- [ ] **Step 5: Implement core forms and mutation result semantics**

Replace store/inventory/product/supplier native prompts and the old inline Product form. Separate write success from `load()` refresh result; close after write success, toast refresh failure separately, and never replay the write.

- [ ] **Step 6: Run focused verification**

Run: `npm test -- tests/integration/admin-resource-routes.test.ts tests/unit/admin-core-forms.test.tsx && npm run test:e2e -- --grep "Admin core forms"`

- [ ] **Step 7: Commit**

```bash
git add src/lib/contracts.ts 'src/app/api/admin/[resource]/[id]/route.ts' src/components/admin src/components/admin-app.tsx tests/integration/admin-resource-routes.test.ts tests/unit/admin-core-forms.test.tsx tests/e2e/smoke.spec.ts
git commit -m "feat: replace core admin edits with dialogs"
```

### Task 3: Remaining Admin CRUD and destructive confirmations

**Files:**
- Create: `src/components/admin/forms/lot-form.tsx`
- Create: `src/components/admin/forms/zone-form.tsx`
- Create: `src/components/admin/forms/shelf-form.tsx`
- Create: `src/components/admin/forms/esl-form.tsx`
- Create: `src/components/admin/forms/fefo-rule-form.tsx`
- Create: `src/components/admin/forms/user-form.tsx`
- Modify: `src/components/admin/admin-types.ts`
- Modify: `src/components/admin-app.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/unit/admin-reference-forms.test.tsx`
- Test: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: Task 1 dialogs/schemas and Task 2 `ApiMutationResult` mutation helper.
- Produces: zero native prompts/confirms; complete CRUD dialogs and confirmation descriptors for every Admin resource.

- [ ] **Step 1: Write failing reference-preservation tests**

Assert Lot, Shelf, ESL, FEFO, and User edit forms use persisted references, preserve multiple user stores/default store, render every ESL on a shelf, and keep immutable IDs/email/code read-only. Assert shelf creation sends `{x:0,y:1,width:1,height:2}`.

- [ ] **Step 2: Write failing destructive-action E2E**

Listen for native browser dialogs and fail if one appears. Open a destructive action, verify resource-specific Vietnamese copy, cancel without request, then confirm once with pending disabled state.

- [ ] **Step 3: Run focused tests and observe RED**

Run: `npm test -- tests/unit/admin-reference-forms.test.tsx`

- [ ] **Step 4: Implement remaining dedicated forms**

Add create/edit entry points for Lot, Zone, Shelf, ESL, FEFO, and User. Add missing Shelf/ESL edit buttons. FEFO create is active by default; edit exposes active. Do not expose API-unsupported mutations.

- [ ] **Step 5: Replace every destructive confirm**

Use one typed `AdminConfirmDialog` for product/store/user/supplier deactivation, lot closure, FEFO deletion, zone/shelf deletion, and ESL detachment. Prevent dismissal and duplicate confirmation while pending.

- [ ] **Step 6: Prove native dialogs are gone**

Run: `rg -n "\b(prompt|confirm|alert)\s*\(" src/components src/app`

Expected: no Admin CRUD matches.

- [ ] **Step 7: Run focused verification**

Run: `npm test -- tests/unit/admin-reference-forms.test.tsx && npm run test:e2e -- --grep "Admin reference forms|Admin destructive"`

- [ ] **Step 8: Commit**

```bash
git add src/components/admin src/components/admin-app.tsx src/app/globals.css tests/unit/admin-reference-forms.test.tsx tests/e2e/smoke.spec.ts
git commit -m "feat: complete shadcn admin CRUD migration"
```

### Task 4: Staff/Manager mobile notification and ESL reliability

**Files:**
- Modify: `src/components/staff-app.tsx`
- Modify: `src/components/esl-scanner-modal.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/unit/staff-push.test.tsx`
- Test: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: existing four-state Staff navigation and Task 1 Button/spinner conventions where useful.
- Produces: `enablePush(): Promise<void>` with support/status checks, bounded readiness wait, `pushPending` state, and deterministic ESL tab behavior shared by Staff/Manager.

- [ ] **Step 1: Write failing push lifecycle tests**

At 320px/390px/760px assert the notification control is 44×44px, non-overlapping, topmost at its center, and clickable. Mock unsupported browser, denied permission, service-worker timeout, subscription rejection, non-2xx POST, and success; pending must always clear and success must require an OK POST.

- [ ] **Step 2: Extend failing mobile ESL E2E**

For Staff and Manager, start on Tasks, click ESL, assert ESL active, Tasks inactive/unmounted, scanner visible, close returns Overview, and logout remains visible outside the scanner. Verify notification center point resolves to the notification button at all three widths.

- [ ] **Step 3: Run focused tests and observe RED**

Run: `npm test -- tests/unit/staff-push.test.tsx && npm run test:e2e -- --grep "mobile staff navbar|mobile notification"`

- [ ] **Step 4: Implement mobile/push fixes**

Use 44px nonshrinking header controls, wrapping header layout, explicit z-index, spinner/disabled state, checked subscription POST, and bounded readiness. Keep Manager oversight-only behavior and ESL request cancellation.

- [ ] **Step 5: Run focused verification**

Run the same focused unit/E2E command; expect all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/staff-app.tsx src/components/esl-scanner-modal.tsx src/app/globals.css tests/unit/staff-push.test.tsx tests/e2e/smoke.spec.ts
git commit -m "fix: stabilize mobile ESL and notification controls"
```

### Task 5: Integration pending UX and full regression

**Files:**
- Modify: `src/components/admin-app.tsx`
- Modify: `src/app/globals.css`
- Modify: `README.md`
- Test: `tests/unit/admin-integrations.test.tsx`
- Test: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: Task 2 mutation result semantics and Task 1 UI primitives/toasts.
- Produces: `integrationPending: null | "POS" | "WMS" | "SUPPLIER" | "FEFO"`; all simulator buttons pending-safe through write plus refresh.

- [ ] **Step 1: Write failing integration pending tests**

Delay each simulator response. Assert the active action shows spinner plus `Đang xử lý…`, all simulator actions are disabled, duplicate clicks send one request, and pending clears after success or failure. Assert FEFO copy states that it runs for all active stores.

- [ ] **Step 2: Run focused tests and observe RED**

Run: `npm test -- tests/unit/admin-integrations.test.tsx && npm run test:e2e -- --grep "integration loading"`

- [ ] **Step 3: Implement pending UX and documentation**

Keep pending through the refresh attempt; on write success plus refresh failure show separate success/stale-data feedback. Update README with the new dialog, mobile, and simulator behavior.

- [ ] **Step 4: Run full verification**

Run sequentially to avoid shared-database fixture races:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
git diff --check
```

Expected: zero lint errors, all Vitest/Playwright tests pass, typecheck/build succeed. The existing generated QR `<img>` advisory may remain documented.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin-app.tsx src/app/globals.css README.md tests/unit/admin-integrations.test.tsx tests/e2e/smoke.spec.ts
git commit -m "feat: show integration progress and verify admin UX"
```

## Plan self-review

- Spec coverage: every mobile, Admin CRUD, destructive confirmation, validation, pending, push, integration, refresh-failure, and API-parser requirement maps to Tasks 1–5.
- Type consistency: Tasks 2–5 consume descriptors/schemas from Task 1 and mutation result semantics from Task 2.
- Review Focus coverage: each of the five listed failure modes has an explicit test in its owning task.
- Proportion: plan specifies interfaces, assertions, commands, and rulings without transcribing component bodies.
