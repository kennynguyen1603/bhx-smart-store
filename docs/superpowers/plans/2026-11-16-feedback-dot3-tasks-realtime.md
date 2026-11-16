# Feedback Dot 3 — Tasks, Realtime, and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make task interaction deliberate, let Admin/Manager assign and monitor work, and synchronize task/notification changes between staff and backoffice within about four seconds.

**Architecture:** Keep PostgreSQL as the source of truth. Add a validated task-command boundary, a cheap per-store change token polled only while visible, and shared notification/push primitives consumed by Staff and Admin. Task writes remain transactional; push delivery happens after commit and never controls write success.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma/PostgreSQL, Radix/shadcn components, Web Push, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-feedback-dot3-design.md`

**Execution dependency:** Run after `2026-11-16-feedback-dot3-kiosk-data.md` because both plans change `src/lib/business.ts`, `prisma/seed.ts`, and shared kiosk/task acceptance fixtures.

## Global Constraints

- Read the relevant guides in `node_modules/next/dist/docs/` before changing App Router or route-handler code.
- Use polling every 4,000ms, stop polling while `document.visibilityState !== "visible"`, and refresh immediately on focus/visibility return.
- Do not add WebSocket, SSE, Redis, Pusher, Ably, or another infrastructure service.
- Staff may see unassigned tasks and their own assignments only; Manager/Admin may see all tasks in authorized stores.
- Manager oversight remains read-only for task execution, but task details must be inspectable.
- Opening a task or ESL result must never mutate task state.
- Push failures must never roll back task/notification database writes.
- Reuse existing shadcn/Radix form, dialog, button, select, and Sonner foundations.

## Review Focus

- Two Staff claiming the same unassigned task must still produce one winner; pin this in Task 1 and retain existing business concurrency tests.
- A task completion committed while push delivery fails must remain completed with in-app notifications present; pin this in Task 2.
- A hidden tab must make no polling requests, and repeated focus/visibility events must not overlap refreshes; pin this in Task 4.
- Task creation must reject cross-store product/shelf/lot/assignee combinations without creating task, event, notification, or push; pin this in Task 2.
- Disabling push with a stale/missing browser subscription must be idempotent and keep in-app notifications usable; pin this in Task 5.

---

### Task 1: Deliberate task opening, status badges, and stable ESL results

**Files:**
- Create: `src/components/ui/badge.tsx`
- Modify: `src/components/staff-app.tsx`
- Modify: `src/components/esl-scanner-modal.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/unit/staff-task-interactions.test.tsx`
- Modify: `tests/unit/esl-scanner-modal.test.ts`
- Modify: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `TASK_STATUS_PRESENTATION: Record<TaskStatus, { label: string; variant: BadgeVariant }>` with labels `Mới`, `Đang làm`, `Bị chặn`, `Hoàn thành`, `Đã huỷ`.
- Preserves: existing `/api/staff/tasks/:id/start|restock|fefo` contracts.
- Changes: `EslScannerModal` always renders result+QR and one explicit `Mở nhiệm vụ` button per returned task.

- [ ] **Step 1: Write failing component tests**

  Click an `OPEN`/`BLOCKED` task row and assert zero mutation requests until `Bắt đầu` is clicked. Assert the explicit start sends one request, disables during pending, and changes the displayed state only after success. Assert Manager can open details but has no start/complete controls. Assert all five statuses render Vietnamese shadcn badges while priority remains visible.

- [ ] **Step 2: Extend ESL modal tests**

  For zero, one, and many active tasks, assert product data and QR stay visible. For exactly one task assert `onSelectTask` is not called by lookup and is called once only after `Mở nhiệm vụ`.

- [ ] **Step 3: Run focused tests and confirm RED**

  Run: `npx vitest run tests/unit/staff-task-interactions.test.tsx tests/unit/esl-scanner-modal.test.ts`

  Expected: current `openTask` and single-task ESL lookup mutate/navigate automatically.

- [ ] **Step 4: Separate view selection from task start**

  Make `openTask(task)` local-state only. Add `startSelectedTask(): Promise<void>` for Staff and show its button only for `OPEN`/`BLOCKED`. Permit Manager row clicks and keep the existing read-only modal guard. Use the source-owned `Badge` component for status and the existing badge/token colors for priority.

- [ ] **Step 5: Keep ESL lookup stable until user choice**

  Remove the `tasks.length === 1` callback. Render a task-choice section for every non-empty task array, with explicit buttons, and keep `<EslQrDemo>` mounted after successful lookup.

- [ ] **Step 6: Run focused and browser verification**

  Run: `npx vitest run tests/unit/staff-task-interactions.test.tsx tests/unit/esl-scanner-modal.test.ts && npm run test:e2e -- --grep "opening task|ESL lookup|status badge"`

  Expected: PASS.

- [ ] **Step 7: Commit**

  ```bash
  git add src/components/ui/badge.tsx src/components/staff-app.tsx src/components/esl-scanner-modal.tsx src/app/globals.css tests/unit/staff-task-interactions.test.tsx tests/unit/esl-scanner-modal.test.ts tests/e2e/smoke.spec.ts
  git commit -m "fix: make task starts explicit"
  ```

### Task 2: Task command API and two-way outcome notifications

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261116193000_feedback_dot3_notifications/migration.sql`
- Create: `src/lib/task-notifications.ts`
- Modify: `src/lib/push.ts`
- Modify: `src/lib/business.ts`
- Create: `src/app/api/admin/tasks/route.ts`
- Create: `tests/integration/admin-task-route.test.ts`
- Modify: `tests/integration/business.test.ts`
- Create: `tests/unit/task-notifications.test.ts`

**Interfaces:**
- Adds: `NotificationType.TASK_COMPLETED`.
- Produces: `AdminTaskInput` with `storeId`, `type`, `productId`, `shelfId`, optional `lotId`, optional `assigneeId`, `priority`, optional `dueAt`, optional `note`.
- Produces: `createAssignmentNotifications(tx, task, assigneeId?): Promise<string[]>` returning recipient user IDs.
- Produces: `createOutcomeNotifications(tx, task, outcome: "COMPLETED" | "BLOCKED"): Promise<string[]>` returning Manager/Admin recipients.
- Produces: `PushPayload = { title: string; body: string; url?: string; tag?: string }` and `PushDeliveryResult = { sent: number; skipped: boolean }`.
- Produces: `sendPushToUsers(userIds: string[], payload: PushPayload): Promise<PushDeliveryResult>`; preserves `sendPushToStore` as a wrapper for existing integration flows.
- Produces: `POST /api/admin/tasks` for `MANAGER | ADMIN`.

- [ ] **Step 1: Write failing task-command integration tests**

  Assert Admin and authorized Manager can create a task; Staff/anonymous cannot. Assert product+shelf inventory, optional lot, and optional Staff assignee all belong to `storeId`. Assert RESTOCK stores no lot. For FEFO/QUARANTINE without `lotId`, assert the server selects the earliest positive-quantity `AVAILABLE|MARKED_DOWN` lot for that product/store or returns `422 LOT_REQUIRED` when none exists.

- [ ] **Step 2: Write failing notification tests**

  Assigned creation notifies only that active Staff user; unassigned creation notifies all active Staff in the store. COMPLETED/BLOCKED notifies active Manager/Admin memberships and excludes the actor. A push rejection after commit does not alter the task or in-app notifications.

- [ ] **Step 3: Run tests and confirm RED**

  Run: `npx vitest run tests/integration/admin-task-route.test.ts tests/integration/business.test.ts tests/unit/task-notifications.test.ts`

  Expected: FAIL because task creation and `TASK_COMPLETED` do not exist.

- [ ] **Step 4: Add the enum migration and notification helpers**

  Generate the Prisma client after adding `TASK_COMPLETED`. Keep notification inserts inside the caller's transaction; return recipient IDs so delivery can occur after a successful commit.

- [ ] **Step 5: Implement validated task creation**

  Authorize the selected store, validate every reference inside one transaction, create an `OPEN` task plus `CREATED` event and assignment notifications, commit, then call `sendPushToUsers`. Return `{ task }` with product/shelf/lot/assignee display fields.

- [ ] **Step 6: Add completion/block notifications to business flows**

  In `completeRestock` and `completeFefoTask`, create outcome notifications transactionally. Deliver push after commit with task-specific URLs. Preserve mutation receipts, Staff claim races, and existing BLOCKED behavior without duplicate notifications.

- [ ] **Step 7: Run focused verification**

  Run: `npm run db:generate && npx vitest run tests/integration/admin-task-route.test.ts tests/integration/business.test.ts tests/unit/task-notifications.test.ts && npm run typecheck`

  Expected: PASS.

- [ ] **Step 8: Commit**

  ```bash
  git add prisma/schema.prisma prisma/migrations/20261116193000_feedback_dot3_notifications src/lib/task-notifications.ts src/lib/push.ts src/lib/business.ts src/app/api/admin/tasks/route.ts tests/integration/admin-task-route.test.ts tests/integration/business.test.ts tests/unit/task-notifications.test.ts src/generated/prisma
  git commit -m "feat: add assignable tasks and outcome alerts"
  ```

### Task 3: Admin task workspace and human-readable references

**Files:**
- Modify: `src/app/api/admin/overview/route.ts`
- Modify: `src/components/admin/admin-form-schemas.ts`
- Modify: `src/components/admin/admin-types.ts`
- Modify: `src/components/admin/forms/core-form.tsx`
- Modify: `src/components/admin/forms/lot-form.tsx`
- Modify: `src/components/admin/forms/zone-form.tsx`
- Modify: `src/components/admin/forms/shelf-form.tsx`
- Modify: `src/components/admin/forms/esl-form.tsx`
- Modify: `src/components/admin/forms/fefo-rule-form.tsx`
- Modify: `src/components/admin/forms/user-form.tsx`
- Create: `src/components/admin/forms/task-form.tsx`
- Modify: `src/components/admin-app.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/unit/admin-form-schemas.test.ts`
- Modify: `tests/unit/admin-reference-forms.test.tsx`
- Create: `tests/unit/admin-task-form.test.tsx`
- Modify: `tests/e2e/admin-foundation.spec.ts`

**Interfaces:**
- Adds: `taskCreateSchema` matching `AdminTaskInput` from Task 2.
- Produces: `ReferenceReadOnly({ label, value, options })`, displaying the option name or `Không còn khả dụng`, never a raw ID.
- Extends Admin overview with `tasks` including product, shelf, lot, assignee, timestamps, and with reference lists needed by the form.

- [ ] **Step 1: Write failing form/reference tests**

  Validate required task type/product/shelf/priority and optional due date/lot/assignee. Assert selects show names and the submitted body keeps IDs. Render every edit form and assert no field labeled `ID`, no raw `storeId/productId/supplierId`, and correct store/product/supplier names.

- [ ] **Step 2: Add failing Admin E2E**

  Create an assigned task by names, observe it in the store task list with status badge and assignee, and assert the assigned Staff sees it. Log in as Manager and assert the same list is visible but cross-store options are absent.

- [ ] **Step 3: Run tests and confirm RED**

  Run: `npx vitest run tests/unit/admin-form-schemas.test.ts tests/unit/admin-reference-forms.test.tsx tests/unit/admin-task-form.test.tsx`

  Expected: FAIL on the missing task form and current raw read-only IDs.

- [ ] **Step 4: Extend Admin overview and typed form contracts**

  Query tasks for the selected authorized store, capped at 100 and ordered active-first/newest. Provide Staff assignee options for that store. Add `task` to the dialog descriptor/resource map without exposing unsupported edit behavior.

- [ ] **Step 5: Replace raw IDs with reference names**

  Remove every `CoreReadOnly label="ID"`. Route immutable references through `ReferenceReadOnly` and pass store/product/supplier options to the forms. Keep IDs only in dialog state and payloads.

- [ ] **Step 6: Build the task panel**

  Add a `Nhiệm vụ` Admin tab with `Giao nhiệm vụ`, filters/status badges, product/shelf/lot/assignee names, and completed time. Submit only through `POST /api/admin/tasks`; keep dialog data after a server error and close after confirmed write.

- [ ] **Step 7: Run focused verification and commit**

  Run: `npx vitest run tests/unit/admin-form-schemas.test.ts tests/unit/admin-reference-forms.test.tsx tests/unit/admin-task-form.test.tsx && npm run test:e2e -- --grep "Admin task assignment|human-readable references"`

  ```bash
  git add src/app/api/admin/overview/route.ts src/components/admin src/components/admin-app.tsx src/app/globals.css tests/unit/admin-form-schemas.test.ts tests/unit/admin-reference-forms.test.tsx tests/unit/admin-task-form.test.tsx tests/e2e/admin-foundation.spec.ts
  git commit -m "feat: add admin task workspace"
  ```

### Task 4: Lightweight change token and visibility-aware polling

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261116203000_store_change_indexes/migration.sql`
- Create: `src/app/api/store-changes/route.ts`
- Create: `src/lib/use-store-change-polling.ts`
- Modify: `src/components/staff-app.tsx`
- Modify: `src/components/admin-app.tsx`
- Create: `tests/unit/store-changes-route.test.ts`
- Create: `tests/unit/store-change-polling.test.tsx`
- Modify: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `StoreChangeSnapshot = { token: string; taskUpdatedAt: string | null; notificationUpdatedAt: string | null; unreadCount: number }`.
- Produces: `useStoreChangePolling(options: { storeId: string; onChange(snapshot: StoreChangeSnapshot): void | Promise<void>; intervalMs?: number }): void`; default `intervalMs` is `4_000`.
- Route authorization: `GET /api/store-changes?storeId=` uses `ensureStoreAccess` and scopes notifications to the current user.

- [ ] **Step 1: Write failing route tests**

  Assert the token changes on task create/start/complete, notification create, and read count change; unrelated stores/users do not change it; unauthorized stores reject. Pin the query to task max `updatedAt`, notification max `createdAt/readAt`, and unread count.

- [ ] **Step 2: Write failing hook tests with fake timers**

  Assert one baseline request, 4-second checks while visible, zero checks while hidden, immediate check on `focus`/visible return, one `onChange` per new token, no overlapping requests, and cleanup on unmount/store change.

- [ ] **Step 3: Run tests and confirm RED**

  Run: `npx vitest run tests/unit/store-changes-route.test.ts tests/unit/store-change-polling.test.tsx`

  Expected: FAIL because route/hook do not exist.

- [ ] **Step 4: Implement the cheap snapshot route**

  Add `Task(storeId, updatedAt)`, `Notification(userId, storeId, createdAt)`, and `Notification(userId, storeId, readAt)` indexes. Use aggregate/count queries only; do not return task rows. Serialize a deterministic token from the aggregate timestamps and unread count.

- [ ] **Step 5: Replace broad polling in both clients**

  Remove Staff's 15-second full-data interval. Keep online/offline queue handling, but let the hook trigger `load()` for remote changes. Add the same hook to Admin and guard both `load()` functions against overlapping/stale responses.

- [ ] **Step 6: Run focused and realtime E2E verification**

  Run: `npm run db:generate && npx vitest run tests/unit/store-changes-route.test.ts tests/unit/store-change-polling.test.tsx && npm run test:e2e -- --grep "realtime task sync|hidden polling"`

  Expected: a Staff completion appears in Manager/Admin within 6 seconds; a created Admin task appears in Staff within 6 seconds.

- [ ] **Step 7: Commit**

  ```bash
  git add prisma/schema.prisma prisma/migrations/20261116203000_store_change_indexes src/generated/prisma src/app/api/store-changes/route.ts src/lib/use-store-change-polling.ts src/components/staff-app.tsx src/components/admin-app.tsx tests/unit/store-changes-route.test.ts tests/unit/store-change-polling.test.tsx tests/e2e/smoke.spec.ts
  git commit -m "feat: sync store changes with light polling"
  ```

### Task 5: Push on/off and per-notification read controls

**Files:**
- Modify: `src/lib/push-client.ts`
- Modify: `src/app/api/push/subscriptions/route.ts`
- Modify: `src/app/api/staff/notifications/route.ts`
- Modify: `src/components/staff-notification-center.tsx`
- Modify: `src/components/staff-app.tsx`
- Modify: `src/components/admin-app.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/unit/staff-push.test.tsx`
- Modify: `tests/unit/staff-notifications-route.test.ts`
- Create: `tests/unit/admin-notifications.test.tsx`
- Modify: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `getDevicePushState(): Promise<"enabled" | "disabled" | PushFailure>`.
- Produces: `disableDevicePush(): Promise<{ status: "disabled" } | PushFailure>`.
- Changes: `StaffNotificationCenter` props to `onRead(ids: string[]): Promise<boolean>` and uses the same method for one/all rows.
- Extends Admin overview with current-user `notifications` for the selected store.

- [ ] **Step 1: Write failing push-toggle tests**

  Assert existing subscription loads as enabled; disabling calls browser `unsubscribe()` and authenticated `DELETE` once; missing subscription is idempotently disabled; failure clears pending and remains retryable; rapid clicks produce one lifecycle.

- [ ] **Step 2: Write failing individual-read tests**

  Click one unread row's check icon and assert PATCH contains only its ID, only that row becomes read, unread count decrements, and failure rolls back only that row. Preserve mark-all behavior and store/user scoping.

- [ ] **Step 3: Run tests and confirm RED**

  Run: `npx vitest run tests/unit/staff-push.test.tsx tests/unit/staff-notifications-route.test.ts tests/unit/admin-notifications.test.tsx`

  Expected: current UI can only enable push and only mark all rows.

- [ ] **Step 4: Validate and implement push deletion**

  Parse `{ endpoint: string().url() }`, delete only the authenticated user's row, and make zero-row deletion return 204. In the client, unsubscribe the local endpoint and clean the server row; expose explicit enabled/disabled/pending copy without disabling the toggle permanently.

- [ ] **Step 5: Generalize optimistic read handling**

  Move Staff's existing versioned/confirmed-read logic behind `markNotificationsRead(ids)`. Give each unread row an accessible `Đánh dấu đã đọc` icon and retain `Đánh dấu tất cả đã đọc`.

- [ ] **Step 6: Reuse the notification center in Admin**

  Render the bell in the Admin header, load current-user store notifications, and use the same PATCH contract. Manager/Admin task outcome alerts must update through Task 4 polling.

- [ ] **Step 7: Run focused verification and commit**

  Run: `npx vitest run tests/unit/staff-push.test.tsx tests/unit/staff-notifications-route.test.ts tests/unit/admin-notifications.test.tsx && npm run test:e2e -- --grep "push toggle|individual notification|Admin notification"`

  ```bash
  git add src/lib/push-client.ts src/app/api/push/subscriptions/route.ts src/app/api/staff/notifications/route.ts src/components/staff-notification-center.tsx src/components/staff-app.tsx src/components/admin-app.tsx src/app/globals.css tests/unit/staff-push.test.tsx tests/unit/staff-notifications-route.test.ts tests/unit/admin-notifications.test.tsx tests/e2e/smoke.spec.ts
  git commit -m "feat: add two-way notification controls"
  ```

### Task 6: Subsystem regression and operational documentation

**Files:**
- Modify: `README.md`
- Modify: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Documents: explicit task start, Admin assignment, four-second near-realtime sync, notification recipients, and Web Push toggle behavior.

- [ ] **Step 1: Add the complete two-browser acceptance flow**

  Use isolated Admin and Staff browser contexts: Admin creates/assigns a task, Staff receives it without reload, opening does not mutate, Staff starts/completes it, and Admin receives the completed badge plus unread notification without reload.

- [ ] **Step 2: Update README behavior notes**

  Explain the polling delay and that Web Push is optional; in-app notification and task sync remain available if permission/configuration is unavailable.

- [ ] **Step 3: Run the subsystem gate**

  Run: `npm run db:deploy && npm run db:seed && npm run typecheck && npm test && npm run build && npm run test:e2e -- --grep "task|notification|realtime|ESL lookup"`

  Expected: all commands PASS.

- [ ] **Step 4: Commit**

  ```bash
  git add README.md tests/e2e/smoke.spec.ts
  git commit -m "test: cover two-way task synchronization"
  ```
