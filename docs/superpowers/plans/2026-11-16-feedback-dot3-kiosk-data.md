# Feedback Dot 3 — Kiosk Data and Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the seeded demo reliably show FEFO pricing and provide scannable product/ESL codes that open the correct kiosk product.

**Architecture:** Centralize store-calendar calculations and EAN-13 encoding in pure helpers, then make the kiosk routes, FEFO engine, seed, and printable demo pages consume them. Public price selection remains FEFO-first: the earliest sellable lot controls the price, with invalid lots removed before sorting.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma/PostgreSQL, Vitest, Playwright, server-rendered SVG.

**Spec:** `docs/superpowers/specs/2026-11-16-feedback-dot3-design.md`

## Global Constraints

- Read the relevant guides in `node_modules/next/dist/docs/` before changing App Router code.
- Do not add a barcode dependency unless the planned SVG encoder cannot pass the EAN-13 decode test.
- Treat a lot expiring today in `Store.timeZone` as not sellable; default the timezone to `Asia/Ho_Chi_Minh` only when persisted data is empty.
- The earliest sellable lot controls public price; a later markdown never overrides an earlier regular-price lot.
- Ignore `SOLD_OUT`, `QUARANTINED`, `quantity <= 0`, and expiry-day-or-older lots.
- Preserve the existing in-memory kiosk detail cache and its store/session invalidation.
- Demo seed data must remain useful for two days; reseeding before a test session remains the documented operating procedure.

## Review Focus

- At the UTC boundary where Ho Chi Minh City has advanced to the next day, expiry filtering must use the store's calendar day; pin this in Task 1.
- A markdown on a later lot must not leak into the public price while an earlier sellable lot is regular price; pin this in Task 1.
- Re-completing FEFO at the same/lower discount must not create a second `Markdown`, while a higher rule may replace the discount; pin this in Task 2.
- Every printed product barcode must have a valid checksum and decode back to the exact 13 digits; pin this in Task 3.
- An ESL belonging to another store or an unknown ESL must never return a product from the selected store; pin this in Task 4.
- Product detail must scroll on portrait mobile, landscape mobile, and tablet whenever content exceeds the viewport; pin this in Task 5.

---

### Task 1: Store-calendar pricing boundary

**Files:**
- Create: `src/lib/store-calendar.ts`
- Modify: `src/lib/kiosk-pricing.ts`
- Modify: `src/app/api/kiosk/products/search/route.ts`
- Modify: `src/app/api/kiosk/products/[id]/route.ts`
- Modify: `tests/unit/kiosk-pricing.test.ts`
- Create: `tests/unit/store-calendar.test.ts`

**Interfaces:**
- Produces: `daysUntilStoreDate(date: Date, now: Date, timeZone: string): number`.
- Produces: `PublicPriceContext = { now: Date; timeZone: string }`.
- Produces: `PublicPrice = { priceVnd: number; originalPriceVnd: number; markdownPercent: number | null }`.
- Changes: `selectPublicPrice(basePriceVnd: number, lots: PublicPriceLot[], context: PublicPriceContext): PublicPrice`.
- Consumed by: Task 2 FEFO decisions and both kiosk product routes.

- [ ] **Step 1: Write failing calendar and price tests**

  Assert `2026-11-16` is day `0` at `2026-11-15T17:30:00Z` in `Asia/Ho_Chi_Minh`, but day `1` in `UTC`. Assert expiry day, past day, zero quantity, `SOLD_OUT`, and `QUARANTINED` are excluded. Assert the earliest valid regular lot beats a later markdown and the earliest valid markdown returns current/original/% values.

- [ ] **Step 2: Run the focused tests and confirm RED**

  Run: `npx vitest run tests/unit/store-calendar.test.ts tests/unit/kiosk-pricing.test.ts`

  Expected: FAIL because `store-calendar.ts` and the context-aware pricing signature do not exist.

- [ ] **Step 3: Implement calendar-day comparison and sellable-lot filtering**

  Use the `@db.Date` value's UTC year/month/day as the target calendar date, and `Intl.DateTimeFormat(..., { timeZone }).formatToParts(now)` for the store's current calendar date. Convert both calendar triples to UTC epoch-day integers before subtraction; do not compare expiry timestamps directly.

- [ ] **Step 4: Pass store timezone and one request timestamp through kiosk routes**

  Select `Store.timeZone`, create one `const now = new Date()` per request, and pass `{ now, timeZone }` to every `selectPublicPrice` call so list/detail cannot disagree inside one request.

- [ ] **Step 5: Run focused verification**

  Run: `npx vitest run tests/unit/store-calendar.test.ts tests/unit/kiosk-pricing.test.ts && npm run typecheck`

  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/store-calendar.ts src/lib/kiosk-pricing.ts 'src/app/api/kiosk/products/search/route.ts' 'src/app/api/kiosk/products/[id]/route.ts' tests/unit/store-calendar.test.ts tests/unit/kiosk-pricing.test.ts
  git commit -m "fix: apply store-day FEFO pricing"
  ```

### Task 2: FEFO completion safety and durable demo seed

**Files:**
- Modify: `src/lib/business.ts`
- Modify: `prisma/seed.ts`
- Modify: `tests/integration/business.test.ts`
- Create: `tests/integration/demo-seed.test.ts`

**Interfaces:**
- Consumes: `daysUntilStoreDate` from Task 1.
- Preserves: `completeFefoTask(taskId, user, clientMutationId)` and `runFefoEngine(now)` public signatures.
- Produces: API error `409 MARKDOWN_NOT_UPGRADABLE` when the current markdown is equal to or greater than the applicable rule.

- [ ] **Step 1: Write failing FEFO business tests**

  Cover store-timezone day selection, equality/lower-discount rejection with no task/lot/markdown side effects, 20% to 30% replacement with exactly one new audit/markdown record, and quarantine behavior on expiry day.

- [ ] **Step 2: Write the seeded-scenario integration assertions**

  After `npm run db:seed`, assert GREENS and BREAD earliest lots are `MARKED_DOWN` at 20% with expiry +3 store days; YOGURT and EGGS earliest lots are `AVAILABLE`, expiry +3 store days, and own `OPEN` FEFO tasks whose notes are derived from the actual rule; CHEESE has an expired `AVAILABLE` lot and an `OPEN` quarantine task; APPLE has an earlier `SOLD_OUT`/zero-quantity lot and a later sellable lot.

- [ ] **Step 3: Run the focused tests and confirm RED**

  Run: `npm run db:seed && npx vitest run tests/integration/business.test.ts tests/integration/demo-seed.test.ts`

  Expected: FAIL on current UTC-only rules, stacked markdown behavior, and seed fixtures.

- [ ] **Step 4: Use store-calendar days in FEFO engine/completion**

  Load `Store.timeZone` with the task. Determine the applicable rule before changing task state, reject non-upgrades with `MARKDOWN_NOT_UPGRADABLE`, and replace—not add to—the existing percentage. Keep mutation-receipt idempotency and transaction rollback guarantees.

- [ ] **Step 5: Make seed scenarios explicit and repeatable**

  Add per-lot seed overrides for `status`, `quantity`, and markdown fields. Set GREENS/BREAD primary lots to the exact pre-markdown scenario, EGGS/YOGURT primary expiry to +3, APPLE's earliest lot to sold-out/zero, and generate FEFO task note/priority from the seeded expiry plus active rules instead of hard-coded day/percent strings.

- [ ] **Step 6: Run focused verification**

  Run: `npm run db:seed && npx vitest run tests/integration/business.test.ts tests/integration/demo-seed.test.ts tests/unit/kiosk-pricing.test.ts`

  Expected: PASS; a second `npm run db:seed` also succeeds and leaves the same scenario.

- [ ] **Step 7: Commit**

  ```bash
  git add src/lib/business.ts prisma/seed.ts tests/integration/business.test.ts tests/integration/demo-seed.test.ts
  git commit -m "feat: seed durable FEFO demo scenarios"
  ```

### Task 3: Valid EAN-13 values and printable product sheet

**Files:**
- Create: `src/lib/ean13.ts`
- Create: `src/components/ean13-barcode.tsx`
- Create: `src/components/barcode-print-button.tsx`
- Create: `src/app/demo/barcodes/page.tsx`
- Modify: `prisma/seed.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/unit/ean13.test.ts`
- Create: `tests/unit/product-barcode-page.test.tsx`
- Modify: `tests/unit/home-page.test.tsx`

**Interfaces:**
- Produces: `ean13CheckDigit(firstTwelve: string): string`.
- Produces: `isValidEan13(value: string): boolean`.
- Produces: `encodeEan13Modules(value: string): boolean[]`, including guards and parity rules.
- Produces: `<Ean13Barcode value: string; height?: number; showText?: boolean />` using an SVG `viewBox`, not canvas.

- [ ] **Step 1: Write failing EAN tests**

  Assert all 14 corrected demo codes validate; bad length/non-digits/wrong checksum reject; module encoding is 95 modules, has exact `101` guards, and matches a known EAN-13 fixture. Render one SVG and assert its accessible label/text preserve the exact code.

- [ ] **Step 2: Run tests and confirm RED**

  Run: `npx vitest run tests/unit/ean13.test.ts tests/unit/product-barcode-page.test.tsx`

  Expected: FAIL because the helper/component/page do not exist.

- [ ] **Step 3: Implement the pure encoder and correct seed codes**

  Replace only the invalid final digits: `8934673574211`, `8934563138165`, `8934673103220`, `2900014825737`, `8934868179078`, `8938502520165`, `2900012345671`, keep valid `2900019876543`, then `8935054700014`, `3073781164992`, `8936036024050`, `8936136160054`, `8934868106876`, `8935001700234`. Update tests/docs that use old codes.

- [ ] **Step 4: Build `/demo/barcodes` as an A4 server page**

  Query active stores and their inventory products, filter by `storeId`, render product name/SKU/store/shelf plus EAN SVG, add a client print button, and paginate without splitting labels. Add `Mã vạch sản phẩm demo` beside the existing ESL demo link.

- [ ] **Step 5: Add isolated screen/print CSS**

  Scope styles under `.barcode-sheet-page`; use physical units only in `@media print`; preserve existing ESL print dimensions and kiosk/map typography.

- [ ] **Step 6: Verify the sheet and existing print contract**

  Run: `npx vitest run tests/unit/ean13.test.ts tests/unit/product-barcode-page.test.tsx tests/unit/home-page.test.tsx tests/unit/screen-typography.test.tsx && npm run typecheck`

  Expected: PASS.

- [ ] **Step 7: Commit**

  ```bash
  git add src/lib/ean13.ts src/components/ean13-barcode.tsx src/components/barcode-print-button.tsx src/app/demo/barcodes/page.tsx prisma/seed.ts src/app/page.tsx src/app/globals.css tests/unit/ean13.test.ts tests/unit/product-barcode-page.test.tsx tests/unit/home-page.test.tsx
  git commit -m "feat: add printable product barcodes"
  ```

### Task 4: Kiosk lookup by ESL or product barcode

**Files:**
- Modify: `src/app/api/kiosk/products/search/route.ts`
- Modify: `src/components/kiosk-app.tsx`
- Create: `tests/unit/kiosk-search-route.test.ts`
- Modify: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Preserves: `GET /api/kiosk/products/search?storeCode=&q=&category=` response shape.
- Adds: exact, case-insensitive ESL lookup scoped to the selected store; a match narrows inventory by both `shelfId` and `productId`.
- Preserves: scanner `openExact` behavior—one result opens detail; zero results stays on a friendly result state.

- [ ] **Step 1: Write failing route tests**

  Assert product EAN and ESL both return the same product; an ESL from another store and an unknown ESL return `products: []`; a partial ESL string continues through normal text search and never bypasses store/category constraints.

- [ ] **Step 2: Add failing browser coverage**

  Scan/type one printed product EAN and one ESL code, assert both open the same product detail and map. Assert unknown ESL shows friendly copy without a client exception.

- [ ] **Step 3: Run tests and confirm RED**

  Run: `npx vitest run tests/unit/kiosk-search-route.test.ts && npm run test:e2e -- --grep "product barcode|ESL at kiosk"`

  Expected: ESL lookup fails on the current `Product.searchText`-only query.

- [ ] **Step 4: Resolve exact ESL before normal search**

  Keep the raw trimmed query for ESL matching and the normalized query for product matching. When an ESL matches the selected store, constrain inventory to its product+shelf; otherwise execute the existing product search. Return the same product DTO in both paths.

- [ ] **Step 5: Improve the zero-result scanner copy**

  When `openExact` produced no products, show `Không nhận diện được mã sản phẩm hoặc ESL tại cửa hàng này.` while ordinary text search keeps its existing suggestion.

- [ ] **Step 6: Run focused verification and commit**

  Run: `npx vitest run tests/unit/kiosk-search-route.test.ts tests/unit/kiosk-pricing.test.ts && npm run test:e2e -- --grep "discounted FEFO price|product barcode|ESL at kiosk"`

  ```bash
  git add 'src/app/api/kiosk/products/search/route.ts' src/components/kiosk-app.tsx tests/unit/kiosk-search-route.test.ts tests/e2e/smoke.spec.ts
  git commit -m "feat: resolve kiosk scans by ESL"
  ```

### Task 5: Scrollable kiosk product detail on tablet and mobile

**Files:**
- Modify: `src/app/globals.css`
- Modify: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Preserves: the existing `.map-modal` markup and desktop two-column/mobile stacked layouts.
- Changes: `.map-modal` clips horizontal overflow only and remains the vertical scroll container whenever `scrollHeight > clientHeight`.

- [ ] **Step 1: Add the failing responsive scroll test**

  Open a product detail with traceability data at `390×844`, `844×390`, `768×1024`, and `1024×768`. For each viewport where `scrollHeight > clientHeight`, wheel/drag inside `.map-modal`, assert `scrollTop > 0`, and assert the traceability rows plus `Tôi đã biết đường` can be scrolled into view. Keep the existing no-horizontal-overflow assertion.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run: `npm run test:e2e -- --grep "kiosk product detail scrolls"`

  Expected: landscape mobile/tablet fails because `.map-modal { overflow: hidden }` overrides `.modal { overflow: auto }`, producing `overflow-y: hidden` and `scrollTop === 0`.

- [ ] **Step 3: Fix the root overflow rule**

  Replace the shorthand with `overflow-x: hidden; overflow-y: auto`; keep `max-height`/`100dvh` bounds at responsive breakpoints and add touch momentum/overscroll containment on the modal scroll container. Do not create nested vertical scrollers inside `.product-detail-info` or `.map-side`.

- [ ] **Step 4: Run responsive verification**

  Run: `npm run test:e2e -- --grep "mobile kiosk maps|kiosk product detail scrolls"`

  Expected: PASS at all four viewports, with vertical scroll available only when content exceeds the modal and no horizontal page/modal overflow.

- [ ] **Step 5: Commit**

  ```bash
  git add src/app/globals.css tests/e2e/smoke.spec.ts
  git commit -m "fix: allow responsive kiosk detail scrolling"
  ```

### Task 6: Demo documentation and plan-level regression

**Files:**
- Modify: `README.md`
- Modify: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Documents: exact GREENS/BREAD markdown examples, YOGURT/EGGS completion flow, barcode/ESL print links, and reseed cadence.

- [ ] **Step 1: Add one end-to-end seeded demo test**

  Without mutating the database in the test, select the seeded store, verify a pre-marked GREENS/BREAD card shows current/original/% price, verify a base-price product remains regular, and open the printed-code routes.

- [ ] **Step 2: Update README demo instructions**

  State `npm run db:seed` before each demo session or at least every two days, and list `/demo/barcodes` plus `/demo/esl-labels` as printable fixtures.

- [ ] **Step 3: Run the subsystem gate**

  Run: `npm run db:seed && npm run typecheck && npm test && npm run build && npm run test:e2e -- --grep "FEFO|barcode|ESL at kiosk"`

  Expected: all commands PASS.

- [ ] **Step 4: Commit**

  ```bash
  git add README.md tests/e2e/smoke.spec.ts
  git commit -m "docs: document kiosk demo fixtures"
  ```
