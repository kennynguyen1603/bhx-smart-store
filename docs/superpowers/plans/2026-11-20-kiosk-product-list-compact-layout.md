# Kiosk Product List Compact Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the `/kiosk` product-results layout so navigation, page padding, and product metadata align naturally on mobile and tablet.

**Architecture:** Keep the existing result-state component and Tailwind v4 integration. Change only layout utilities in `KioskApp`, with Playwright geometry assertions defining the responsive contract.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4, Playwright

**Spec:** `docs/superpowers/specs/2026-11-20-kiosk-product-list-compact-layout-design.md`

## Global Constraints

- Main kiosk content top and bottom padding must be exactly 20px.
- The back control remains a minimum 44px touch target and keeps the accessible name `Quay lại`.
- Product-card padding remains 20px.
- No product, search, availability, or detail-modal behavior changes.
- Do not overwrite unrelated working-tree changes and do not commit unless the user asks.

## Review Focus

- At 390px, the icon button must not squeeze the results title into horizontal overflow; Task 1 checks page overflow.
- At 768px, the back control must remain before the title rather than drifting to the right; Task 1 checks element geometry.
- Long availability labels must not push the product name away from the category; Task 1 checks category/name and badge/category offsets.
- The compact back control must retain a 44px touch target; Task 1 checks computed dimensions.
- The card compaction must not reduce its requested 20px internal padding; Task 1 keeps the existing padding assertion.

---

### Task 1: Compact the kiosk results header and product metadata

**Files:**
- Modify: `tests/e2e/smoke.spec.ts:511`
- Modify: `src/components/kiosk-app.tsx:154`

**Interfaces:**
- Consumes: existing `.kiosk-main`, `.kiosk-results-header`, `.kiosk-results-back`, `.kiosk-results-copy`, `.product-card`, and `.availability` selectors.
- Produces: the same selectors with a 20px page-padding contract, left-side icon navigation, and compact product metadata spacing.

- [ ] **Step 1: Extend the responsive layout test before changing production code**

In `kiosk results keep the compact heading and stock badge`, assert at both 390px and 768px that:

- `.kiosk-main` has `20px` top and bottom padding.
- `.kiosk-results-back` is before `.kiosk-results-copy`, is at least 44px square, and no wider than 48px.
- category and badge top edges differ by no more than `2px`.
- the category-to-name gap is no more than `6px`.
- product-card padding remains `20px` and page overflow is at most zero.

- [ ] **Step 2: Run the focused test and verify the current layout fails**

Run: `npx playwright test tests/e2e/smoke.spec.ts --grep "kiosk results keep the compact heading and stock badge" --workers=1`

Expected: FAIL because `.kiosk-main` still has larger vertical padding, the back button is after the copy, and the category/name gap exceeds 6px.

- [ ] **Step 3: Apply the minimal Tailwind layout change**

In `src/components/kiosk-app.tsx`:

- Add `py-5!` to `.kiosk-main`.
- Make `.kiosk-results-header` an `items-start` row with the back button first and reduced bottom spacing.
- Render `.kiosk-results-back` as an icon-only 44px button with `aria-label="Quay lại"`.
- Compact the availability pill height and override the product-name top margin so the category/name gap is at most 6px.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npx playwright test tests/e2e/smoke.spec.ts --grep "kiosk results keep the compact heading and stock badge" --workers=1`

Expected: 2 tests passed.

- [ ] **Step 5: Inspect mobile and tablet screenshots**

Capture the results view at 390x844 and 768x1024. Confirm the back icon reads as navigation, category/name spacing is compact, badge/category remain aligned, and neither viewport overflows.

- [ ] **Step 6: Run project verification**

Run:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm test`

Expected: typecheck and build exit 0; lint has no new errors or warnings; report any pre-existing unit failures by name rather than hiding them.

- [ ] **Step 7: Review the final diff**

Run `git diff --check` and inspect only the files listed above plus the approved spec and plan. Do not commit unless the user asks.
