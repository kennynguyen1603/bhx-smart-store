# Kiosk Product Detail Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebalance the kiosk product-detail modal around a compact product summary, the unchanged route map, and a structured traceability panel.

**Architecture:** Keep the existing modal state, data fetching, cache, map rendering, and route-step components. Recompose the three visual regions as sibling grid items using only Tailwind utility classes in JSX, so desktop places product/traceability beside the map while mobile preserves the sequence summary → map → traceability → confirmation.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4, Playwright, Vitest

**Spec:** `docs/superpowers/specs/2026-11-20-kiosk-product-detail-layout-design.md`

## Global Constraints

- Keep the store map, legend, map copy, and four route steps behaviorally and visually unchanged.
- Preserve supplier, origin, certificate, lot code, expiry date, and markdown percentage when present.
- Preserve product image, availability, name, current/original price, shelf, and zone.
- Remove only duplicated presentation: the separate green guidance card and oversized location-card treatment.
- Keep close and confirmation controls at least 44px tall.
- Implement all new layout and styling with Tailwind utilities in `KioskApp`; do not edit `globals.css` or add component CSS.
- Use Tailwind important modifiers where existing unlayered modal styles would otherwise override the utility.
- Do not change loading, retry, caching, closing, route calculation, or session-reset behavior.
- Do not overwrite the existing unstaged formatting changes in `src/components/kiosk-app.tsx`; do not commit unless the user asks.

## Review Focus

- A long product name must wrap without colliding with the close button; Task 1 checks summary overflow at 390px.
- Missing certificate data must still render the existing “Đã kiểm định” fallback; Task 1 checks the first real trace card.
- Multiple lots must remain separate readable cards; Task 1 preserves one-card-per-lot markup and the existing trace-row reachability test.
- Loading and retry states must stay inside the map region without showing incomplete traceability; Task 1 leaves those branches unchanged and runs the existing retry/cache scenarios.
- The confirmation action must remain reachable after the trace cards in portrait view; Task 1 checks geometry and re-runs the existing scroll test.

---

### Task 1: Recompose the product-detail modal

**Files:**
- Modify: `tests/e2e/smoke.spec.ts`
- Modify: `src/components/kiosk-app.tsx`
- Test: `tests/unit/screen-typography.test.tsx`

**Interfaces:**
- Consumes: `Detail`, `modalProduct`, `detail.product.traceability`, `StoreMap`, `closeDetail`, and the existing `.map-side`, `.store-map-shell`, `.route-steps`, `.trace-row`, and `.map-confirm` selectors.
- Produces: `.detail-product-summary`, `.detail-location-inline`, `.detail-map-panel`, `.detail-trace-panel`, and `.trace-card`, while retaining `.trace-row` and `.map-confirm` for existing consumers.

- [ ] **Step 1: Write the failing responsive E2E test**

Add a 390x844 and 1280x900 viewport loop that opens a seeded product detail and asserts:

- `.detail-help` and `.detail-location-card` are absent.
- `.detail-product-summary`, `.detail-map-panel`, and `.detail-trace-panel` are visible.
- The summary is at most 250px tall and the page/modal have no horizontal overflow.
- Mobile geometry is summary before map before trace panel, with `.map-confirm` after trace content.
- Desktop geometry places summary and trace in the left column and the map in the right column spanning both.
- `.route-steps > span` remains exactly four.
- The first `.trace-card` exposes the labels Nhà cung cấp, Xuất xứ, Chứng nhận, Lô, and HSD.
- The close and confirmation controls remain at least 44px tall.

- [ ] **Step 2: Run the focused test and verify it fails against the current modal**

Run: `npx playwright test tests/e2e/smoke.spec.ts --grep "kiosk product detail balances summary map and traceability" --workers=1`

Expected: FAIL because the new regions do not exist and duplicated guidance/location cards are still rendered.

- [ ] **Step 3: Implement the compact product summary**

In `KioskApp`, replace the current `product-detail-info` contents with:

- `.detail-product-summary` containing the compact emoji, availability, name, and `ProductPrice`.
- `.detail-location-inline` containing the pin, shelf label, and zone.
- No `.detail-help` or `.detail-location-card`.

Use only Tailwind utilities in JSX, with important modifiers where legacy unlayered CSS would otherwise override the new responsive dimensions. Do not add or modify CSS selectors.

- [ ] **Step 4: Separate map and traceability into sibling regions**

- Keep the existing map heading, walking time, `StoreMap`, loading skeleton, and retry branch inside `.map-side.detail-map-panel` without changing their copy or logic.
- Move traceability and `.map-confirm` into `.detail-trace-panel` after the map sibling in DOM order.
- Render one `.trace-card.trace-row` per lot using a semantic label/value grid: supplier full-width, origin/certificate paired, lot/HSD paired, and conditional markdown badge.
- Apply responsive Tailwind grid placement in JSX so desktop uses a 310px left rail plus map column, while widths below 1024px use the vertical DOM order. Do not add or modify CSS selectors.

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `npx playwright test tests/e2e/smoke.spec.ts --grep "kiosk product detail balances summary map and traceability" --workers=1`

Expected: 2 tests passed.

- [ ] **Step 6: Run existing detail and typography regression tests**

Run:

- `npx playwright test tests/e2e/smoke.spec.ts --grep "kiosk product detail scrolls|mobile kiosk maps yogurt|product detail retry|product detail cache" --workers=1`
- `npx vitest run tests/unit/screen-typography.test.tsx`

Expected: all selected scenarios pass; map/route behavior and readable metadata remain unchanged.

- [ ] **Step 7: Inspect mobile and desktop screenshots**

Capture the open detail modal at 390x844 and 1280x900. Confirm balanced whitespace, readable wrapping, unchanged map/route steps, compact trace cards, and a reachable confirmation action.

- [ ] **Step 8: Run project verification**

Run `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test`. Report the known baseline seed/bootstrap failures by name if they remain; do not describe the full suite as green unless it is green.

- [ ] **Step 9: Review the final diff**

Run `git diff --check`, inspect the semantic diff for only the approved product-detail layout, and leave concurrent formatting changes unstaged and unmodified.
