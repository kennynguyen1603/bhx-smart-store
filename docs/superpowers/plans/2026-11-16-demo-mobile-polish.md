# Mobile Demo Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a reliable mobile demo with touch shelf movement, resilient notifications, printable ESL labels, clearer typography, and an unambiguous two-experience/three-role presentation.

**Architecture:** Keep authorization and existing task flows intact while extracting three focused boundaries: shelf placement, service-worker/push setup, and ESL label mapping. Page components consume those boundaries, and presentation cleanup remains scoped to the demo-critical screens. Each task is test-first and independently reviewable.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma/PostgreSQL, Radix/shadcn UI, Vitest + happy-dom, Playwright, browser Service Worker/Push APIs, `qrcode`.

**Spec:** `docs/superpowers/specs/2026-11-16-demo-mobile-polish-design.md`

## Global Constraints

- Do not add Redis, a queue broker, or any new infrastructure dependency.
- Preserve the `STAFF`, `MANAGER`, and `ADMIN` authorization roles and all existing server-side permission checks.
- Present exactly two primary product experiences: Staff app and customer Kiosk; Admin is supporting backoffice.
- Manager's existing Staff oversight remains read-only for task execution.
- QR payloads are raw ESL codes, not privileged URLs.
- Active label task statuses are exactly `OPEN`, `IN_PROGRESS`, and `BLOCKED`; badge order is RESTOCK, FEFO, QUARANTINE.
- Mobile shelf moves must remain in bounds and must not overlap another shelf; reject rather than swap.
- Expected push capability failures render inline and never as generic destructive toasts.
- Local service workers retain push/sync but bypass application caching on `localhost` and `127.0.0.1`.
- Use Vietnamese user-facing copy, visible focus states, and useful 44px mobile touch targets where layout permits.
- Preserve unrelated user changes and do not modify the generated `next-env.d.ts` in the main checkout.

## Review Focus

- Multi-cell shelves near the right/bottom map edge must be rejected rather than partially clipped; pin this in Task 3 placement tests.
- Two same-tick push-enable clicks must create at most one browser subscription and one backend write; pin this in Task 2 component tests.
- Permission denied or missing VAPID configuration must leave in-app notifications usable; pin this in Task 2 component tests.
- Labels with duplicate task types or only completed/cancelled tasks must render deterministic badges or “Không có nhiệm vụ”; pin this in Task 4 mapper tests.
- A 320px viewport must keep the notification bell, logout, ESL navigation, and text accessible without horizontal page overflow; pin this in Task 6 browser tests.

---

### Task 1: Service-worker registration foundation

**Files:**
- Create: `src/lib/service-worker.ts`
- Modify: `src/components/providers.tsx`
- Modify: `public/sw.js`
- Test: `tests/unit/service-worker.test.ts`

**Interfaces:**
- Produces: `ServiceWorkerRegistrationResult = { ok: true; registration: ServiceWorkerRegistration } | { ok: false; reason: "unsupported" | "insecure-context" | "registration-failed" }`.
- Produces: `ensureServiceWorkerRegistration(container?: ServiceWorkerContainer): Promise<ServiceWorkerRegistrationResult>`.
- Produces: `isLocalServiceWorkerHost(hostname: string): boolean` for deterministic local-host behavior tests.
- Consumed by: Task 2 push setup and the root `Providers` effect.

- [ ] **Step 1: Write failing service-worker helper tests**

  Cover reuse of an existing `/sw.js` registration, one new registration when absent, unsupported/insecure contexts returning structured failures, and concurrent calls sharing one in-flight registration.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run: `npx vitest run tests/unit/service-worker.test.ts`

  Expected: FAIL because `@/lib/service-worker` does not exist.

- [ ] **Step 3: Implement the registration helper**

  Add the exact interfaces above. Never wait indefinitely on `navigator.serviceWorker.ready`; use `getRegistration()`/`register()` and catch registration errors into the result union.

- [ ] **Step 4: Change `Providers` to register rather than unregister in development**

  Call `ensureServiceWorkerRegistration()` once on mount. Do not display UI or log raw registration errors from this background attempt.

- [ ] **Step 5: Make the worker cache-free on local hosts**

  In `public/sw.js`, set one local-host flag from `self.location.hostname`. On local hosts, skip app-shell cache population and do not call `respondWith` for GET fetches; keep `push`, `notificationclick`, and `sync` listeners active. Preserve current production caching and clean up obsolete BHX caches during activation.

- [ ] **Step 6: Run focused tests and lint the changed files**

  Run: `npx vitest run tests/unit/service-worker.test.ts && npx eslint src/lib/service-worker.ts src/components/providers.tsx`

  Expected: PASS with no lint errors.

- [ ] **Step 7: Commit**

  ```bash
  git add src/lib/service-worker.ts src/components/providers.tsx public/sw.js tests/unit/service-worker.test.ts
  git commit -m "fix: make service worker reliable in local demo"
  ```

### Task 2: In-app notification center and deliberate push setup

**Files:**
- Create: `src/lib/push-client.ts`
- Create: `src/components/staff-notification-center.tsx`
- Create: `src/app/api/staff/notifications/route.ts`
- Modify: `src/app/api/push/subscriptions/route.ts`
- Modify: `src/components/staff-app.tsx`
- Modify: `src/app/globals.css`
- Replace/extend test: `tests/unit/staff-push.test.tsx`
- Test: `tests/unit/staff-notifications-route.test.ts`

**Interfaces:**
- Consumes: `ensureServiceWorkerRegistration()` from Task 1.
- Produces: `PushSetupResult = { status: "enabled" } | { status: "unsupported" | "denied" | "worker-unavailable" | "backend-unconfigured" | "failed"; message: string }`.
- Produces: `setupDevicePush(): Promise<PushSetupResult>`; it owns capability checks, GET readiness, permission, subscription, and POST persistence with same-tick deduplication.
- Produces: authenticated `GET /api/push/subscriptions` response `{ configured: boolean; publicKey: string | null }` without private data.
- Produces: authenticated `PATCH /api/staff/notifications` body `{ storeId: string }`, response `{ updated: number; readAt: string }`, scoped to `userId + storeId + readAt:null` after `ensureStoreAccess`.
- Produces: `StaffNotificationCenter` props `{ notifications: StaffNotification[]; storeId: string; onReadAll(): Promise<boolean> }`, where `StaffNotification` includes `id`, `type`, `title`, `body`, `readAt`, `createdAt`, and `taskId`.

- [ ] **Step 1: Rewrite component tests around the desired bell behavior**

  Assert that clicking the bell opens a dialog and does not call `Notification.requestPermission`, service-worker registration, or push APIs. Assert that notification title/body/time and unread count render, empty state works, and an explicit enable button starts setup.

- [ ] **Step 2: Add failing push-state and concurrency tests**

  Assert inline states for unsupported browser, denied permission, worker failure, backend unconfigured, and persistence failure. Assert two same-tick enable clicks yield one subscription and one POST; successful setup may produce success feedback but expected failures never create an error toast.

- [ ] **Step 3: Add failing notification read-route tests**

  Mock auth/Prisma and assert store access, authenticated user/store scoping, only unread rows updated, and no cross-user/cross-store mutation.

- [ ] **Step 4: Run focused tests and confirm RED**

  Run: `npx vitest run tests/unit/staff-push.test.tsx tests/unit/staff-notifications-route.test.ts`

  Expected: FAIL because the center, client helper, GET status, and PATCH route are not implemented.

- [ ] **Step 5: Implement `setupDevicePush()` and backend readiness**

  Fetch readiness before requesting permission, use the Task 1 registration result, convert the public VAPID key, reuse an existing subscription when available, and persist exactly once. Return the result union for all expected states; throw no raw worker error into the UI.

- [ ] **Step 6: Implement notification read mutation**

  Parse `{ storeId }`, require the current user, call `ensureStoreAccess`, update unread notifications for that user/store, and return one shared ISO `readAt` timestamp.

- [ ] **Step 7: Build the shadcn notification center**

  Use the existing Radix/shadcn `Dialog`. The bell opens the center; it never enables push directly. Add explicit “Bật thông báo trên thiết bị” and “Đánh dấu tất cả đã đọc” actions, pending guards, neutral/warning inline status, readable notification rows, and a proper empty state.

- [ ] **Step 8: Integrate the center into `StaffApp`**

  Expand the notification payload type, remove the old `enablePush`/timeout refs, and make `onReadAll()` immediately apply one local `readAt`, PATCH the route, then restore the prior notifications and return `false` on failure. Keep the mobile logout button topmost and accessible.

- [ ] **Step 9: Run focused tests and the existing Staff regression tests**

  Run: `npx vitest run tests/unit/staff-push.test.tsx tests/unit/staff-notifications-route.test.ts tests/unit/esl-scanner-modal.test.ts`

  Expected: PASS.

- [ ] **Step 10: Commit**

  ```bash
  git add src/lib/push-client.ts src/components/staff-notification-center.tsx src/app/api/staff/notifications/route.ts src/app/api/push/subscriptions/route.ts src/components/staff-app.tsx src/app/globals.css tests/unit/staff-push.test.tsx tests/unit/staff-notifications-route.test.ts
  git commit -m "feat: add resilient staff notification center"
  ```

### Task 3: Touch-safe Admin shelf map with placement validation

**Files:**
- Create: `src/lib/shelf-layout.ts`
- Create: `src/components/admin/admin-map-editor.tsx`
- Modify: `src/components/admin-app.tsx`
- Modify: `src/app/api/admin/[resource]/[id]/route.ts`
- Modify: `src/app/globals.css`
- Test: `tests/unit/shelf-layout.test.ts`
- Test: `tests/unit/admin-map-editor.test.tsx`

**Interfaces:**
- Produces: `ShelfRect = { id: string; x: number; y: number; width: number; height: number }` and `MapBounds = { width: number; height: number }`.
- Produces: `validateShelfPlacement(candidate: ShelfRect, shelves: ShelfRect[], bounds: MapBounds): { valid: true } | { valid: false; reason: "out-of-bounds" | "occupied" }`.
- Produces: `AdminMapEditor` props `{ store: AdminMapStore; canEdit: boolean; onMove(shelfId: string, x: number, y: number): Promise<ApiMutationResult> }`.
- Consumes: existing `ApiMutationResult` and existing Admin overview shelf data.

- [ ] **Step 1: Write failing pure placement tests**

  Cover valid placement, negative coordinates, multi-cell right/bottom clipping, edge-touching without overlap, true rectangle overlap, self exclusion, and unchanged target.

- [ ] **Step 2: Write failing map interaction tests**

  In happy-dom, mock element bounds and pointer capture. Assert pointer drag snaps to a cell and calls `onMove` once, tap shelf then tap cell works, unchanged/occupied targets do not write, non-Admin mode cannot move, a pending move ignores duplicates, and a failed move restores the original visual state with inline feedback.

- [ ] **Step 3: Run focused tests and confirm RED**

  Run: `npx vitest run tests/unit/shelf-layout.test.ts tests/unit/admin-map-editor.test.tsx`

  Expected: FAIL because the layout helper and editor do not exist.

- [ ] **Step 4: Implement placement validation and enforce it in the API**

  Before updating `shelves`, load the shelf, its store bounds, and sibling shelf rectangles; validate the merged x/y/width/height candidate. Return a 400 `SHELF_OUT_OF_BOUNDS` or 409 `SHELF_POSITION_OCCUPIED` via `ApiError` with Vietnamese messages.

- [ ] **Step 5: Implement `AdminMapEditor`**

  Use Pointer Events with capture and a movement threshold; calculate a target from the map bounding rectangle; set `touch-action:none` only on shelf handles. Add tap-select/tap-place, Escape cancel, `aria-pressed`/instructions, optimistic target display, pending lock, and rollback/error text.

- [ ] **Step 6: Replace the inline Admin map markup**

  Remove `dragShelf`/`dropShelf`, pass `api('/api/admin/shelves/:id', 'PUT', {x,y})` through `onMove`, and leave zone/ESL management alongside the extracted editor.

- [ ] **Step 7: Run focused tests plus Admin form regressions**

  Run: `npx vitest run tests/unit/shelf-layout.test.ts tests/unit/admin-map-editor.test.tsx tests/unit/admin-core-forms.test.tsx tests/unit/admin-reference-forms.test.tsx`

  Expected: PASS.

- [ ] **Step 8: Commit**

  ```bash
  git add src/lib/shelf-layout.ts src/components/admin/admin-map-editor.tsx src/components/admin-app.tsx src/app/api/admin/'[resource]'/'[id]'/route.ts src/app/globals.css tests/unit/shelf-layout.test.ts tests/unit/admin-map-editor.test.tsx
  git commit -m "feat: support mobile shelf placement"
  ```

### Task 4: Dynamic printable ESL label sheet

**Files:**
- Create: `src/lib/esl-labels.ts`
- Create: `src/app/demo/esl-labels/page.tsx`
- Create: `src/components/esl-label-print-button.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/unit/esl-labels.test.ts`

**Interfaces:**
- Produces: `EslTaskBadge = "RESTOCK" | "FEFO" | "QUARANTINE"`.
- Produces: `activeTaskBadges(tasks: Array<{ type: EslTaskBadge; status: TaskStatus }>): EslTaskBadge[]`.
- Produces: `encodeEslLabelQr(code: string, encoder?: QrEncoder): Promise<{ dataUrl: string; error: string }>`; it passes the raw code unchanged to the encoder and isolates errors per label.
- Produces: `loadEslLabels(storeId?: string): Promise<{ stores: LabelStoreOption[]; selectedStoreId: string | null; labels: EslLabelRecord[] }>` where each label has ESL code, store, shelf, product, badges, and QR data URL/error.
- Produces: public `/demo/esl-labels?storeId=<id>` and a client-only print button that calls `window.print()`.

- [ ] **Step 1: Write failing label mapper tests**

  Assert exact active statuses, completed/cancelled exclusion, duplicate removal, RESTOCK/FEFO/QUARANTINE ordering, and the empty array that maps to “Không có nhiệm vụ”. Assert QR encoder receives the raw ESL code.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run: `npx vitest run tests/unit/esl-labels.test.ts`

  Expected: FAIL because `@/lib/esl-labels` does not exist.

- [ ] **Step 3: Implement the data query and mapper**

  Query active stores and ESLs with product/shelf plus matching tasks on the same `storeId + shelfId + productId`. Generate each QR independently with error correction `M`; preserve a label with a manual code and error state if one QR fails.

- [ ] **Step 4: Build the public label page**

  Render a screen toolbar with title, store GET filter, label count, and “In A4”. Render each card with QR, large ESL code, product, shelf/store, deterministic badges, or “Không có nhiệm vụ”. Render an instructive empty state when no assignments exist.

- [ ] **Step 5: Add A4 print styles**

  Use `@page { size: A4; margin: 10mm; }`, two columns, four cards per page target, `break-inside: avoid`, 55–60mm QR sizing, grayscale-safe borders/badges, and hide all `.screen-only` controls in print.

- [ ] **Step 6: Run focused tests, typecheck, and a production page build**

  Run: `npx vitest run tests/unit/esl-labels.test.ts tests/unit/esl-qr-demo.test.ts && npm run typecheck`

  Expected: PASS.

- [ ] **Step 7: Commit**

  ```bash
  git add src/lib/esl-labels.ts src/app/demo/esl-labels/page.tsx src/components/esl-label-print-button.tsx src/app/globals.css tests/unit/esl-labels.test.ts
  git commit -m "feat: add printable ESL demo labels"
  ```

### Task 5: Role presentation, landing hierarchy, and typography cleanup

**Files:**
- Create: `src/lib/demo-roles.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/login/page.tsx`
- Modify: `src/components/login-form.tsx`
- Modify: `src/components/staff-app.tsx`
- Modify: `src/components/admin-app.tsx`
- Modify: `src/components/esl-scanner-modal.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/unit/demo-roles.test.ts`
- Test: `tests/unit/login-form.test.tsx`
- Test: `tests/unit/home-page.test.tsx`

**Interfaces:**
- Produces: `DEMO_ACCOUNTS` descriptors with Vietnamese label, description, email, role, and primary destination.
- Produces: `demoDestinationForEmail(email: string): "/staff" | "/admin"`; Staff and Manager map to `/staff`, Admin maps to `/admin`.
- Consumes: no authorization interfaces; this task changes presentation and default navigation only.

- [ ] **Step 1: Write failing role/destination tests**

  Assert all three role descriptors remain, Vietnamese descriptions are distinct, Staff/Manager destination is `/staff`, Admin destination is `/admin`, and login submission uses the selected account's destination. Render the home page and assert exactly two primary experience cards plus compact Admin and ESL-label links.

- [ ] **Step 2: Run focused tests and confirm RED**

  Run: `npx vitest run tests/unit/demo-roles.test.ts tests/unit/login-form.test.tsx tests/unit/home-page.test.tsx`

  Expected: FAIL because role descriptors/destination behavior are not implemented.

- [ ] **Step 3: Implement role descriptors and login behavior**

  Render “Nhân viên — thực hiện nhiệm vụ”, “Quản lý — giám sát cửa hàng”, and “Quản trị — cấu hình hệ thống”. Route the selected demo account to its primary destination after successful sign-in.

- [ ] **Step 4: Restructure the landing hierarchy**

  Change the hero to “Hai trải nghiệm, một nền dữ liệu”, retain two large Staff/Kiosk cards, and move Admin plus `/demo/esl-labels` into compact secondary demo links. Remove the technical data-flow footer if it repeats the hero without helping the demo.

- [ ] **Step 5: Remove duplicate technical captions**

  Delete or replace user-visible captions such as `LIVE DATA`, `STORE ADMIN`, `SYSTEMS OF RECORD`, `STANDALONE SCAN`, and other repeated all-caps labels where the adjacent heading already explains the section. Preserve meaningful state labels and ESL/task codes.

- [ ] **Step 6: Normalize scoped typography and touch targets**

  Raise legacy body/control text to 13–14px minimum on narrow screens and 14px on normal screens; metadata to 11–12px; enlarge key headings; set primary mobile controls to at least 44px; keep map/kiosk spatial annotations scoped and compact. Do not apply a single global font multiplier.

- [ ] **Step 7: Run focused tests and existing UI unit suite**

  Run: `npx vitest run tests/unit/demo-roles.test.ts tests/unit/login-form.test.tsx tests/unit/home-page.test.tsx tests/unit/staff-push.test.tsx tests/unit/admin-dialogs.test.tsx`

  Expected: PASS.

- [ ] **Step 8: Commit**

  ```bash
  git add src/lib/demo-roles.ts src/app/page.tsx src/app/login/page.tsx src/components/login-form.tsx src/components/staff-app.tsx src/components/admin-app.tsx src/components/esl-scanner-modal.tsx src/app/globals.css tests/unit/demo-roles.test.ts tests/unit/login-form.test.tsx tests/unit/home-page.test.tsx
  git commit -m "refactor: clarify demo experiences and roles"
  ```

### Task 6: Mobile, print, and full regression verification

**Files:**
- Create: `tests/e2e/demo-mobile-polish.spec.ts`
- Modify if a shared helper is needed: `tests/e2e/smoke.spec.ts`
- Modify as failures reveal narrowly scoped issues: files changed in Tasks 1–5

**Interfaces:**
- Consumes: all interfaces and routes produced by Tasks 1–5.
- Produces: browser-level acceptance coverage only; no new product API.

- [ ] **Step 1: Write failing mobile map browser coverage**

  At a 390px viewport, authenticate as Admin, move a shelf to a computed valid empty target using pointer input, reload and verify persistence, then restore its original coordinates. Also verify tap-select/tap-place and visible inline rejection for an occupied target.

- [ ] **Step 2: Write failing Staff/Manager navigation and notification coverage**

  For both roles at 390px, open “Quét ESL” and assert the scanner remains active instead of switching to Nhiệm vụ. Open the bell and assert the dialog appears without a permission request or error toast; assert logout remains clickable.

- [ ] **Step 3: Write failing local-worker and ESL-label coverage**

  Clear BHX caches in test setup, then assert localhost controls a `/sw.js` registration while no BHX application cache is populated. Visit `/demo/esl-labels`, assert QR/code/product/shelf/task/no-task content, emulate print media, and verify screen controls hide and cards do not split.

- [ ] **Step 4: Write failing responsive typography coverage**

  At 320px, 390px, and tablet width, assert no document-level horizontal overflow, key body/control computed font sizes meet the scoped minimum, and bell/logout/ESL controls have useful hit boxes.

- [ ] **Step 5: Run the new browser suite and confirm/fix failures**

  Run: `npx playwright test tests/e2e/demo-mobile-polish.spec.ts`

  Expected: PASS after only narrowly scoped fixes; preserve all earlier unit tests.

- [ ] **Step 6: Run all quality gates**

  Run: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`

  Expected: all commands exit 0. Record exact test counts and any non-blocking pre-existing warnings.

- [ ] **Step 7: Inspect A4 output and the five mobile acceptance flows**

  Use Chromium print emulation/screenshot for A4 and visually inspect mobile Admin map, Staff ESL scanner, notification panel, landing/login role hierarchy, and label sheet. Save no generated screenshots unless needed as a test artifact.

- [ ] **Step 8: Commit final verification fixes**

  ```bash
  git add tests/e2e/demo-mobile-polish.spec.ts tests/e2e/smoke.spec.ts
  # If a narrow production fix was required, add only its exact path after reviewing `git diff`.
  git commit -m "test: cover polished mobile demo flows"
  ```

## Completion Gate

- [ ] Review the diff for permission changes, secret exposure, and unrelated edits.
- [ ] Run `git status --short` and confirm only intended files remain.
- [ ] Use `superpowers:verification-before-completion` before claiming completion.
- [ ] Use `superpowers:requesting-code-review` for a whole-branch review.
- [ ] Because subagent-driven execution was selected, integrate only after every task review and the whole-branch review are resolved.
