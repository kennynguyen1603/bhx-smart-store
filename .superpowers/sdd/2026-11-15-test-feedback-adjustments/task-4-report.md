# Task 4 Report — Instant Kiosk Product Detail with Session Cache

## Implementation

- Added a 60-second in-memory promise cache with request deduplication, rejection eviction, per-store invalidation, and full-session clearing.
- Split store map data into `GET /api/kiosk/stores/[code]/map`; the product-detail API now returns product, inventory shelf, pricing, and traceability only.
- Moved `routeToShelf` calculation into the kiosk client and preserved the existing `Detail["map"]` rendering contract.
- Preserved Task 1 `originalPriceVnd` and `markdownPercent` fields and list/detail discount rendering.
- Separated search and detail loading state. Product clicks open modal chrome immediately from search data while map and traceability use scoped skeletons.
- Added hover, focus, and touch prefetch. Clicks reuse in-flight or fulfilled cache promises.
- Added a scoped failure state and retry action; rejected detail requests are evicted before retry.
- Store changes clear only the previous store's entries. The automatic 120-second reset clears the complete cache; ordinary close, back, and manual Home retain it.
- Removed the stale hard-coded initial store so interaction waits for bootstrap's actual first store.

## TDD Evidence

Inherited cache RED/GREEN evidence from the prior worker:

- RED: `npm test -- tests/unit/kiosk-detail-cache.test.ts` failed because `@/lib/kiosk-detail-cache` did not exist.
- GREEN: the same focused suite passed 6/6 after implementing the cache module.

Continuation/final evidence:

- `npm test -- tests/unit/kiosk-detail-cache.test.ts` — PASS, 1 file / 6 tests.
- `npm run typecheck` — PASS.
- `npm test -- --reporter=dot` — PASS, 6 files / 26 tests.
- Initial focused E2E RED exposed an over-broad test route matcher that treated `/api/kiosk/products/search` as product detail; trace inspection confirmed production emitted one detail and one map request.
- `npm run test:e2e -- --grep "product detail cache|product detail retry"` — PASS, 2/2.

## Self-review

Self-review performed because the task explicitly prohibited subagents/reviewers. No Critical, Important, or Minor findings remain for Task 4. `git diff --check` passed, and generated `next-env.d.ts` churn was reverted before commit.

Review focus confirmed:

- 60-second fulfilled/in-flight reuse and rejected-entry eviction.
- Immediate modal shell without the global synchronization toast.
- Pricing fields and discount UI preserved.
- Store isolation and automatic-timeout invalidation follow the recorded ruling.
- Close/back/manual Home retain cache.
- Retry succeeds without refetching already-cached map data.
