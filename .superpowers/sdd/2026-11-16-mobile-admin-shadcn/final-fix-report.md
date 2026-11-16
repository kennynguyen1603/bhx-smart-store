# Final fix wave report

## Status and commits

- Status: complete; all seven findings implemented, focused regressions green, and the required full sequential verification green.
- Base: `fac4002fd5b72dc638493f0f54cb17a277ef740f`.
- Implementation head: `33091b2` (`fac4002..33091b2`).
- Implementation commits:
  - `2880936` — `fix: harden admin and manager workflows`
  - `33091b2` — `fix: reconcile pending simulator operations`
- Report artifact is committed separately after the implementation range so this report can name the exact implementation head.

## Changed files

- Runtime/API:
  - `src/components/staff-app.tsx`
  - `src/components/admin-app.tsx`
  - `src/components/admin/forms/user-form.tsx`
  - `src/components/ui/sonner.tsx`
  - `src/app/api/admin/[resource]/[id]/route.ts`
  - `src/app/api/admin/[resource]/route.ts`
  - `src/app/api/admin/simulate/route.ts`
- Tests:
  - `tests/unit/staff-push.test.tsx`
  - `tests/unit/admin-integrations.test.tsx`
  - `tests/unit/admin-dialogs.test.tsx`
  - `tests/unit/admin-reference-forms.test.tsx`
  - `tests/integration/admin-resource-routes.test.ts`
  - `tests/integration/admin-simulate-route.test.ts`
  - `tests/e2e/smoke.spec.ts`
- Evidence/report:
  - `.superpowers/sdd/2026-11-16-mobile-admin-shadcn/progress.md` (ignored working ledger)
  - `.superpowers/sdd/2026-11-16-mobile-admin-shadcn/final-fix-report.md` (this committed report)

## Finding-to-implementation map

### 1. Manager ESL read-only navigation

- `StaffApp` now accepts Manager single-result auto-selection and multi-result manual selection, transitions from ESL to Tasks, and opens the selected task without calling start/complete endpoints.
- Manager details show a Vietnamese read-only notice and omit ESL verification, quantity controls, FEFO/quarantine instructions that lead to mutation, and all confirmation actions. Staff behavior and ESL close-to-Overview behavior remain unchanged.
- Tests: two Manager selection cases in `staff-push.test.tsx`; real single/multi ESL Playwright flow in `smoke.spec.ts`, including zero mutation requests and absent mutation controls.

### 2. Bounded pending and ambiguous simulator writes

- Push setup retains the 5,000 ms Service Worker readiness bound and adds 8,000 ms bounds for `PushManager.subscribe` and the subscription POST. The POST uses `AbortController`; attempt generation and mounted guards suppress late success/error and state updates, and every active attempt clears the ref/state guard.
- Admin simulator write and overview refresh each use a 10,000 ms abortable bound. Exact loading copy remains `Đang xử lý…`; confirmed write success and stale refresh feedback remain separate.
- The client sends `operationId` UUIDs. It retains the same UUID after ambiguous timeout/network failure, reuses it for explicit retry, and clears it after a confirmed HTTP outcome so a later deliberate action receives a new UUID.
- `/api/admin/simulate` binds the key to user + action in `MutationReceipt`, records PENDING/COMPLETED state, derives deterministic integration IDs, returns stored completed results, refuses replay while current work is pending, reconciles a completed `IntegrationEvent`, and reclaims a still-PENDING claim after 120,000 ms. No schema migration was needed.
- Tests: never-settling subscribe and push POST (including abort, pending cleanup, and ignored late success); never-settling simulator write and refresh; stable retry/new-action keys; real database proof that same-key retry creates one sale effect; completed-event and stale-claim reconciliation.

### 3. Cross-store reference isolation

- Shelf `zoneId` updates and ESL `shelfId` updates now read the owning record, authorize it, validate the reference against that same `storeId`, and update inside one Prisma transaction.
- Shelf/ESL creation receives the same reference invariant as defense at the API boundary. Permissions were not broadened.
- Foreign references return Vietnamese `400 CROSS_STORE_REFERENCE` feedback.
- Tests: two-store Manager shelf/zone and Admin ESL/shelf route cases assert rejection, unchanged records, and no audit creation.

### 4. Safe shelf deletion

- Shelf DELETE now runs transactionally, counts ESL, inventory, task, sale, and shelf-history dependencies, and returns `409 SHELF_NOT_EMPTY` instead of invoking schema cascades. Only a truly empty shelf is deleted.
- Confirmation copy states that only an empty shelf can be deleted and dependencies must first be moved or removed.
- Tests: dependent shelf rejection/preservation, empty shelf success, and focused confirmation-copy assertion.

### 5. Atomic inventory update and audit

- Persisted inventory read, store authorization, merged-value validation, version increment/update, and audit insert now execute in one Prisma transaction.
- Existing authorization and validation/version behavior remain intact.
- Test: a controlled PostgreSQL audit trigger failure makes the route return an error and proves `onShelf` and `version` both roll back with no audit row. The trigger/function are removed in `finally`.

### 6. Sonner accessibility localization

- The supported Sonner `toastOptions.closeButtonAriaLabel` API sets the label to `Đóng thông báo`; no dependency files were patched.
- Test: focused DOM accessibility assertion for the Vietnamese close-button label.

### 7. User password helper copy

- Create mode says the password is required and has a minimum of eight characters.
- Edit mode says a blank new-password field preserves the current password.
- Test: focused create/edit form-copy assertion.

## RED/GREEN evidence

- UI RED: `npm test -- tests/unit/staff-push.test.tsx tests/unit/admin-integrations.test.tsx tests/unit/admin-dialogs.test.tsx tests/unit/admin-reference-forms.test.tsx` → 13 expected failures, 73 passes.
- UI GREEN: same command → 4 files, 86/86 tests passed.
- API RED: `npm test -- tests/integration/admin-resource-routes.test.ts tests/integration/admin-simulate-route.test.ts` → 6 expected failures, 15 passes; failures demonstrated committed inventory after audit failure, accepted foreign references, cascading shelf deletion, and duplicate simulator effects.
- API GREEN: same command → 2 files, 21/21 tests passed.
- Reconciliation RED: `npm test -- tests/integration/admin-simulate-route.test.ts` → 2 expected failures, 1 pass for pending-event/stale-claim recovery.
- Reconciliation GREEN: same command → 3/3 passed.
- Focused browser GREEN: dedicated port 3424, `--grep "Manager opens single and multi-task ESL results read-only" --workers=1` → 1/1 passed. The Manager behavior itself was observed RED in both focused unit selection cases before production edits.

## API, RBAC, and transaction decisions

- Manager remains oversight-only. Read-only navigation is a UI transition only; no task mutation endpoint is called and no role authorization was expanded.
- Cross-store invariants are enforced at the trusted server boundary in the same transaction as the write; UI filtering remains convenience only.
- Inventory + audit atomicity and shelf dependency check + delete atomicity use Prisma interactive transactions.
- Simulator idempotency uses the existing `MutationReceipt` and `IntegrationEvent` records. Same key + same user/action reconciles; same key with a different user/action is rejected; current PENDING work returns `OPERATION_IN_PROGRESS`; a new deliberate action after confirmed completion uses a new key.
- No database schema migration was introduced.

## Focused and full verification

- Focused UI: 86/86 passed.
- Focused Admin API/simulator: 21/21 passed; reconciliation subset 3/3 passed.
- Focused Manager ESL Playwright: 1/1 passed on port 3424, one worker.
- `npm run lint`: PASS, 0 errors; one pre-existing `src/components/esl-qr-demo.tsx` `<img>` advisory only.
- `npm run typecheck`: PASS.
- `npm test`: PASS, 16 files / 208 tests.
- `npm run build`: PASS, 17 static pages generated and all routes compiled.
- `NEXTAUTH_URL=http://127.0.0.1:3424 PORT=3424 npm run test:e2e -- --workers=1`: PASS, 36/36.
- `git diff --check`: PASS.
- `next-env.d.ts`: restored to the committed production-types form after build/E2E.
- Database/integration/Playwright commands were run sequentially; Playwright used one worker.

## Self-review, concerns, and status

- Review method: author self-review against all seven findings and the two referenced specs/plans; no subagent was used per explicit instruction.
- Self-review correction: added mounted/generation guards for React Strict Mode and added server recovery for crash-left PENDING simulator receipts before final verification.
- Open Critical/Important/Minor findings: none.
- Known retained advisory: the pre-existing QR `<img>` lint warning allowed by the request.
- Schema/migration concern: none; existing tables support the policy.
- External side effects: no push, merge, or publish was performed.
- Worktree status is verified clean after the report commit in the completion contract.
