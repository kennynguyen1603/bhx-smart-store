# Test Feedback Adjustments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FEFO pricing visible on the kiosk, separate Staff/Manager task visibility, provide a production-shaped ESL scan/QR demo, and make product details open without repetitive global synchronization delays.

**Architecture:** Keep the existing Next.js/Prisma application and introduce small pure helpers for kiosk pricing and task authorization. Enforce role rules in API/business functions, reuse the existing ZXing scanner, generate demo QR codes client-side, and split store-map data from product detail so an in-session 30–60 second client cache can prefetch and reuse responses without Redis.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7/PostgreSQL, Vitest, Playwright, ZXing, `qrcode`.

**Spec:** `docs/superpowers/specs/2026-11-15-test-feedback-adjustments-design.md`

## Global Constraints

- Do not add Redis or another shared cache service.
- QR payloads contain only stable ESL identifiers such as `ESL-NT-Q5-COLD-01`; never encode price or stock.
- Role restrictions must be enforced by the API/business layer, not only hidden in React.
- Scanning an ESL never completes a task automatically.
- Reuse current `Lot` markdown fields and `Task` assignment fields; do not create a database migration unless implementation proves the existing schema insufficient.
- Product-detail cache TTL is 60 seconds and is cleared when the store changes or the kiosk session resets.

## Review Focus

- A product with an earliest quarantined/sold-out lot must price from the earliest still-sellable lot, not stale markdown data; Task 1 tests this selection.
- Two Staff users racing to claim one task must result in one owner and a conflict for the other; Task 2 tests business-layer ownership checks.
- An ESL can have zero, one, or multiple visible active tasks; Task 3 tests all three scan outcomes.
- A cached detail from one store must never appear after switching stores; Task 4 tests cache-keying and invalidation.
- A prefetched request that fails must not block a later click retry or leave a permanent loading state; Task 4 tests rejected-entry eviction.

---

## File Structure

- Create `src/lib/kiosk-pricing.ts`: select the active sellable lot and serialize public price fields consistently.
- Create `src/lib/task-access.ts`: build role-aware Prisma filters and validate task ownership transitions.
- Create `src/lib/kiosk-detail-cache.ts`: TTL cache with request deduplication, rejection eviction, and store/session clearing.
- Create `src/components/esl-scanner-modal.tsx`: standalone ESL scanner/manual-entry flow and zero/one/many task result UI.
- Create `src/components/esl-qr-demo.tsx`: client-side QR rendering for an existing ESL identifier.
- Create `src/app/api/kiosk/stores/[code]/map/route.ts`: store map payload reused by every product detail.
- Modify kiosk product APIs/components, Staff API/business/component, global styles, package metadata, and tests listed below.

### Task 1: Consistent FEFO Pricing on Kiosk

**Files:**
- Create: `src/lib/kiosk-pricing.ts`
- Modify: `src/app/api/kiosk/products/search/route.ts`
- Modify: `src/app/api/kiosk/products/[id]/route.ts`
- Modify: `src/components/kiosk-app.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/unit/kiosk-pricing.test.ts`
- Test: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `selectPublicPrice(basePriceVnd: number, lots: PublicPriceLot[]): { priceVnd: number; originalPriceVnd: number; markdownPercent: number | null }`, where sellable lots are `AVAILABLE` or `MARKED_DOWN`, have `quantity > 0`, and are ordered by `expiryDate` ascending.
- Produces: kiosk search `Product` fields `originalPriceVnd: number` and `markdownPercent: number | null` for Tasks 3–4 UI reuse.

- [ ] **Step 1: Write failing unit tests for public FEFO price selection**

Cover regular price, earliest marked-down sellable lot, quarantined/zero-quantity exclusion, and fallback to base price; assert the exact `{ priceVnd, originalPriceVnd, markdownPercent }` result.

- [ ] **Step 2: Run the pricing test and confirm failure**

Run: `npm test -- tests/unit/kiosk-pricing.test.ts`
Expected: FAIL because `src/lib/kiosk-pricing.ts` does not exist.

- [ ] **Step 3: Implement `selectPublicPrice` and use it in both kiosk APIs**

Fetch only active sellable lots needed for pricing in the search route, preserve earliest-expiry ordering, and replace the detail route's `lots[0]?.markdownPriceVnd || basePriceVnd` expression with the helper.

- [ ] **Step 4: Add discount rendering to result cards**

Extend the React `Product` type and render current price, struck-through original price, and `Giảm N%` only when `markdownPercent` is non-null and `priceVnd < originalPriceVnd`.

- [ ] **Step 5: Add an E2E assertion for discounted list and detail prices**

Seed or arrange one marked-down lot, then assert the same current price, original price, and discount percentage appear before and after opening the product.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/unit/kiosk-pricing.test.ts && npm run test:e2e -- --grep "discounted FEFO price"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/kiosk-pricing.ts src/app/api/kiosk/products src/components/kiosk-app.tsx src/app/globals.css tests/unit/kiosk-pricing.test.ts tests/e2e/smoke.spec.ts
git commit -m "feat: show FEFO prices consistently on kiosk"
```

### Task 2: Enforce Staff and Manager Task Visibility

**Files:**
- Create: `src/lib/task-access.ts`
- Modify: `src/app/api/staff/tasks/route.ts`
- Modify: `src/lib/business.ts`
- Modify: `src/components/staff-app.tsx`
- Test: `tests/unit/task-access.test.ts`
- Test: `tests/integration/business.test.ts`
- Test: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `taskVisibilityWhere(user: { id: string; role: Role }, storeId: string): Prisma.TaskWhereInput`.
- Produces: `assertTaskClaimable(task: { assigneeId: string | null }, user: { id: string; role: Role }): void`, throwing `ApiError(409, ..., "TASK_ALREADY_ASSIGNED")` when Staff tries to mutate another Staff member's task.
- Produces: serialized task fields `assignee: { id: string; name: string } | null` and `completedAt: string | null`.

- [ ] **Step 1: Write failing unit tests for role-aware filters and ownership**

Assert Staff gets `OR: [{ assigneeId: null }, { assigneeId: user.id }]`, Manager/Admin get the whole store, Staff cannot claim another user's task, and Manager/Admin pass ownership validation.

- [ ] **Step 2: Run unit tests and confirm failure**

Run: `npm test -- tests/unit/task-access.test.ts`
Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement access helpers and apply the query filter**

Use `taskVisibilityWhere` in `/api/staff/tasks`; compute Staff metrics and recent events from only their visible task scope, while Manager/Admin retain store-wide data.

- [ ] **Step 4: Add ownership checks to all task mutations**

Call `assertTaskClaimable` inside the same transaction in `startTask`, `completeRestock`, and `completeFefoTask` before updating assignment or task state.

- [ ] **Step 5: Write and run integration coverage for competing Staff claims**

Create two Staff users in one store, have the first start a task, assert the second receives `TASK_ALREADY_ASSIGNED`, and assert the original assignee remains unchanged.

Run: `npm test -- tests/integration/business.test.ts`
Expected: PASS.

- [ ] **Step 6: Render Manager oversight information**

Extend `Task` with `assignee` and `completedAt`; for Manager rows show assignee or “Chưa nhận”, and for completed tasks show localized completion time. Keep Staff rows limited to their own/claimable tasks.

- [ ] **Step 7: Add Staff/Manager E2E coverage**

Assert Staff history excludes another Staff user's completed task and Manager's completed filter shows that task, assignee name, and completion time.

- [ ] **Step 8: Run focused and static checks**

Run: `npm test -- tests/unit/task-access.test.ts tests/integration/business.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/task-access.ts src/lib/business.ts src/app/api/staff/tasks/route.ts src/components/staff-app.tsx tests/unit/task-access.test.ts tests/integration/business.test.ts tests/e2e/smoke.spec.ts
git commit -m "feat: separate staff and manager task visibility"
```

### Task 3: Standalone ESL Scan and QR Demo

**Files:**
- Create: `src/components/esl-scanner-modal.tsx`
- Create: `src/components/esl-qr-demo.tsx`
- Modify: `src/app/api/esl/[code]/route.ts`
- Modify: `src/components/staff-app.tsx`
- Modify: `src/app/globals.css`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: Task 2's role-aware visible-task rule.
- Produces: `EslLookupPayload = { esl; inventory; tasks: TaskSummary[] }` from `GET /api/esl/[code]`.
- Produces: `<EslScannerModal storeId tasks onSelectTask onClose />`, where `onSelectTask(taskId: string)` opens the existing Staff task modal.
- Produces: `<EslQrDemo code: string />`, rendering a QR whose decoded text equals `code`.

- [ ] **Step 1: Add failing E2E tests for standalone scan outcomes**

Test manual entry for an ESL with one active task opening that task, an ESL with no task showing “Không có nhiệm vụ đang mở”, multiple tasks presenting choices, and a code from another store returning an access error.

- [ ] **Step 2: Run the ESL E2E tests and confirm failure**

Run: `npm run test:e2e -- --grep "ESL"`
Expected: FAIL because the sidebar button does not open a scanner.

- [ ] **Step 3: Extend the ESL lookup API**

Return only active tasks (`OPEN`, `IN_PROGRESS`, `BLOCKED`) matching the ESL store/shelf/product and apply Task 2's Staff/Manager visibility rule.

- [ ] **Step 4: Implement `EslScannerModal`**

Reuse `BarcodeScanner`, include manual input, fetch the lookup payload, and implement exact zero/one/many behavior without completing any task.

- [ ] **Step 5: Connect the sidebar action to the new modal**

Replace the current tab/filter click behavior; on one result or selected result, close the scanner and call the existing `openTask` path.

- [ ] **Step 6: Install and use `qrcode` for demo labels**

Run: `npm install qrcode && npm install --save-dev @types/qrcode`

Implement `EslQrDemo` with `QRCode.toDataURL(code, { errorCorrectionLevel: "M", width: 320, margin: 2 })`, visible code text, and no mutable product data in the payload.

- [ ] **Step 7: Expose QR demo from a verified ESL result**

Show the QR panel after a successful lookup so a second device can scan it; use only ESLs already returned by the authenticated API.

- [ ] **Step 8: Run ESL tests and dependency checks**

Run: `npm run test:e2e -- --grep "ESL" && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/app/api/esl src/components/esl-scanner-modal.tsx src/components/esl-qr-demo.tsx src/components/staff-app.tsx src/app/globals.css tests/e2e/smoke.spec.ts
git commit -m "feat: add standalone ESL scan and QR demo"
```

### Task 4: Instant Kiosk Product Detail with Session Cache

**Files:**
- Create: `src/lib/kiosk-detail-cache.ts`
- Create: `src/app/api/kiosk/stores/[code]/map/route.ts`
- Modify: `src/app/api/kiosk/products/[id]/route.ts`
- Modify: `src/components/kiosk-app.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/unit/kiosk-detail-cache.test.ts`
- Test: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `createKioskDetailCache<T>(ttlMs = 60_000)` with `get(key, loader)`, `prefetch(key, loader)`, `clearStore(storeCode)`, and `clear()`; rejected loaders remove their entry.
- Produces: `GET /api/kiosk/stores/[code]/map` returning `{ store, zones, shelves, start }`.
- Changes product-detail API to return only product, inventory shelf, and traceability data; the client combines it with cached map data and calls the existing pure `routeToShelf` helper in the browser.

- [ ] **Step 1: Write failing cache unit tests**

Assert request deduplication, 60-second reuse, expiry reload, rejected-entry retry, separate store keys, `clearStore`, and full session `clear`.

- [ ] **Step 2: Run cache tests and confirm failure**

Run: `npm test -- tests/unit/kiosk-detail-cache.test.ts`
Expected: FAIL because the cache module does not exist.

- [ ] **Step 3: Implement the cache module**

Use an in-memory `Map` storing `{ expiresAt, promise }`; do not persist to localStorage/IndexedDB and do not add SWR/React Query.

- [ ] **Step 4: Split reusable map data into a store endpoint**

Move store/zone/shelf/kiosk payload out of the product-detail response. Import `routeToShelf` into the client, compute the route from the cached store map plus the selected shelf, and preserve the current `Detail["map"]` rendering contract.

- [ ] **Step 5: Separate search and detail loading state**

Replace shared `loading` with `searchLoading` and local detail state. Remove the global “Đang đồng bộ dữ liệu cửa hàng…” toast from product clicks.

- [ ] **Step 6: Open a shell modal immediately and hydrate it in the background**

On click, initialize the modal from the search `Product`, show a scoped skeleton only for traceability/map, then combine cached map and detail responses when ready. Preserve close/reset behavior and surface a retry action on failure.

- [ ] **Step 7: Add prefetch triggers**

Call the same cache loader on `onMouseEnter`, `onFocus`, and `onTouchStart`; ensure click reuses the in-flight or fulfilled promise.

- [ ] **Step 8: Invalidate on store change and session reset**

Call `clearStore(previousStoreCode)` when selecting another store and `clear()` from `home` when it represents the 120-second automatic session reset; ordinary back/close actions retain cache for the current session.

- [ ] **Step 9: Add E2E request-count and failure-retry tests**

Assert modal chrome appears immediately, no global synchronization toast appears, reopening within TTL performs no second detail/map request, store switch fetches the new store, and an intercepted first failure can be retried successfully.

- [ ] **Step 10: Run focused tests**

Run: `npm test -- tests/unit/kiosk-detail-cache.test.ts && npm run test:e2e -- --grep "product detail cache|product detail retry"`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/kiosk-detail-cache.ts src/app/api/kiosk/stores src/app/api/kiosk/products/[id]/route.ts src/components/kiosk-app.tsx src/app/globals.css tests/unit/kiosk-detail-cache.test.ts tests/e2e/smoke.spec.ts
git commit -m "perf: prefetch and cache kiosk product details"
```

### Task 5: Full Regression and Documentation

**Files:**
- Modify: `README.md`
- Test: all test suites

**Interfaces:**
- Consumes: all prior tasks; produces no new runtime interface.

- [ ] **Step 1: Document the final demo flow**

Add the standalone ESL scan/QR steps, Staff versus Manager behavior, FEFO kiosk pricing behavior, and the fact that kiosk optimization is in-session cache/prefetch without Redis.

- [ ] **Step 2: Run formatting/static/unit/integration checks**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all commands exit 0.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: production build exits 0 with no route/type errors.

- [ ] **Step 4: Run the complete E2E suite**

Run: `npm run test:e2e`
Expected: all Playwright tests pass on desktop and configured projects.

- [ ] **Step 5: Review the final diff against the spec**

Run: `git diff --check && git status --short`
Expected: no whitespace errors; only planned source, test, package, and documentation files are changed.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: add feedback verification guide"
```
