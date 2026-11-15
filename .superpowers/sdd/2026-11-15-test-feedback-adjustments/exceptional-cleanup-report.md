# Exceptional cleanup report

Date: 2026-11-15
Worktree: `/Users/nguyenny/Documents/Projects/kiosk/bhx-smart-store-mvp/.worktrees/test-feedback-adjustments`
Branch: `feature/test-feedback-adjustments`
Implementation commit SHA: `0e263ffc3b5b649cd6ecd6a706f77bab34219851`
Implementation commit subject: `fix: serialize FEFO completion and cancel ESL lookups`

## Status

Both residual findings are fixed and verified. All six added regression cases were observed failing for the expected missing behavior before either production file was changed. Focused tests, the full Vitest suite, the full Playwright suite, typecheck, lint, and the production build completed successfully. No subagents were dispatched.

The implementation and tests are in the immutable implementation commit above. This report is delivered in a subsequent documentation commit so it can record that exact SHA.

## Requirements, verbatim

> Fix the two residual review findings using strict TDD (write and observe failing tests first):
>
> 1. `completeFefoTask` must claim/transition the task atomically for every mutating role, including Admin. Two concurrent Admin completion requests with different mutation IDs must not both update the lot/create markdown side effects. Preserve existing authorization and idempotency semantics. Add a deterministic Admin concurrency regression test.
> 2. ESL scanner requests must use `AbortController`: abort a superseded lookup and abort the active lookup when the modal closes/unmounts. Keep the generation guard as a correctness backstop. Add focused component/unit coverage that proves the prior request receives an aborted signal and cannot affect current UI.
>
> Run focused tests, then the full Vitest suite, Playwright suite, typecheck, lint, and build. Commit all changes. Do not modify unrelated behavior. Do not dispatch subagents.
>
> Write a detailed report to `.superpowers/sdd/2026-11-15-test-feedback-adjustments/exceptional-cleanup-report.md`, including RED evidence, changed files, commit SHA, and verification results.

## Finding 1: atomic FEFO completion for every mutating role

### Root cause

`completeFefoTask` used `claimStaffTaskForCompletion`, which returns immediately for any role other than Staff. Admin requests therefore checked the status of an earlier task snapshot and performed lot/markdown writes before an unconditional completion update. Two transactions could both read `OPEN`, pass validation, and commit their side effects with distinct mutation IDs.

### Change

- Inside the existing transaction, conditionally transition the task to `COMPLETED` using `updateMany` constrained by task ID and the existing allowed statuses (`OPEN` and `IN_PROGRESS`). This database operation now applies to every role reaching the mutation.
- Retain the null/current-user assignee predicate for Staff. Admin and Manager retain their existing ability to act regardless of Staff assignment; non-Admin store authorization still runs before the transition.
- If the conditional update affects no row, re-read the task and retain the existing `TASK_ALREADY_ASSIGNED` conflict for another Staff assignee, otherwise return `409 INVALID_TASK_STATE`.
- Run lot updates, markdown creation, task event, ESL LED update, audit, and receipt creation only after the transition succeeds. All remain within the same transaction, so a later failure also rolls back the transition.
- Preserve the initial mutation-receipt replay path. The final task update supplies the result note; status, assignee, and completion time come from the successful conditional transition.
- Leave the restock helper and restock behavior unchanged.

### Deterministic regression

`atomically completes FEFO once for concurrent Admin requests with different mutation IDs` uses real Prisma transactions and the real database. A test-only proxy pauses each initial task read after its query returns, releasing both snapshots only after both have read the task. There are no timing sleeps and no mocked writes.

The requests use the same Admin identity, no store memberships (preserving the Admin store override), and distinct mutation IDs. Assertions require two initial reads, exactly one successful completion, a losing `409 INVALID_TASK_STATE`, the expected completed task and discounted lot, and exactly one markdown, completion event, audit entry, and receipt. Replaying the winning mutation ID must return its saved response; completing with a new mutation ID must conflict without another markdown.

## Finding 2: cancel scanner lookups throughout their lifecycle

### Root cause

The scanner generation guard ignored older lookup responses while the modal remained active, but fetch received no abort signal. Neither closing nor unmounting invalidated the active generation or canceled network activity.

### Change

- Maintain an active `AbortController` in a ref and pass its signal to fetch.
- Increment the generation before aborting a superseded request, then create the replacement controller.
- Share cancellation between the close button, backdrop close, and effect cleanup on unmount. Cancellation invalidates the generation before aborting and clears the controller ref.
- Preserve generation checks around successful results, single-task selection, errors, and loading completion. A stale request cannot clear the current controller or affect the current UI, even when the transport ignores cancellation.

### Component coverage

Added a file-scoped Happy DOM environment and rendered the real modal with React DOM. The unrelated camera and QR children are stubbed; lookup logic, hooks, form events, close events, fetch signal handling, and displayed results are exercised in the production component.

The controlled fetch boundary deliberately allows late resolution after abort, proving that the generation guard remains necessary and effective. Five cases cover:

1. Superseded lookup receives an aborted signal; a late successful response cannot replace the current code/result or auto-select its task.
2. Superseded lookup receives an aborted signal; a late abort rejection cannot display an error or alter the current result/loading state.
3. Close button aborts the active lookup and prevents late task selection/result display.
4. Backdrop close aborts the active lookup and prevents late task selection/result display.
5. Unmount aborts the active lookup and prevents late task selection.

The existing ESL browser regression now waits for the superseded request's `requestfailed` event and asserts `net::ERR_ABORTED`, while retaining its current-result and stale-task UI assertions. Waiting for an HTTP response would be incorrect once the request is intentionally canceled.

## Strict TDD: RED evidence

Both valid RED runs below completed before the production changes.

| Command | Observed result | Expected missing behavior |
| --- | --- | --- |
| `npm test -- tests/integration/business.test.ts -t 'concurrent Admin requests'` | Exit 1; 1 failed, 9 skipped. Both initial task reads reached the barrier; expected 1 fulfilled result, received 2. | Admin completion had no atomic task transition before side effects. |
| `npm test -- tests/unit/esl-scanner-modal.test.ts` | Exit 1; all 5 cases failed with `expected undefined to be an instance of AbortSignal`. | Fetch received no abort signal for replacement, close button, backdrop close, or unmount. |

During test-harness construction, an initial Prisma extension/transaction-spy approach failed before reaching the read barrier (`reads` was 0; subsequent diagnostics exposed `RangeError: Maximum call stack size exceeded`). That harness error was corrected by capturing the original transaction function and proxying only the transaction-local initial task read. It was not counted as RED evidence. The corrected harness then produced the two-success assertion failure shown above against unchanged production code.

An early typecheck also found overly broad inferred Vitest callback mock types in the new component test. Explicit callable mock types corrected those test declarations; subsequent typechecks and the build passed. No production workaround was made for either test-harness issue.

## Verification results

Focused verification, after implementation:

| Command | Result |
| --- | --- |
| `npm test -- tests/integration/business.test.ts tests/unit/esl-scanner-modal.test.ts` | Exit 0; 2 files, 15 tests passed; 71.69 seconds. |
| `npm test -- tests/unit/esl-scanner-modal.test.ts` | Exit 0; all 5 component cases passed. |
| `npm run test:e2e -- --grep 'ESL'` | Exit 0; both ESL scenarios passed; 30.2 seconds. |

Full required verification, after focused verification, in the requested order:

| Command | Result |
| --- | --- |
| `npm test` | Exit 0; 8 files, 37 tests passed; 71.87 seconds. |
| `npm run test:e2e` | Exit 0; all 16 Playwright tests passed; 1.2 minutes. No retry or rerun was needed. |
| `npm run typecheck` | Exit 0; no TypeScript errors. |
| `npm run lint` | Exit 0; 0 errors, 1 existing QR-image advisory. |
| `npm run build` | Exit 0; production compilation and TypeScript completed, all 17 static pages generated, page optimization finalized. |
| `git diff --check` and `git diff --cached --check` | Exit 0; no whitespace errors before the implementation commit. |

Typecheck and lint were run concurrently after Playwright because they are independent; the production build followed both. The full suites include the existing Staff ownership, restock CAS, authorization/visibility, FEFO/quarantine, kiosk, camera, and role-specific browser scenarios. No final verification test failed or was skipped.

## Changed files

| File | Purpose |
| --- | --- |
| `src/lib/business.ts` | Atomic conditional FEFO completion transition for all mutating roles, with existing Staff ownership and state-conflict behavior. |
| `src/components/esl-scanner-modal.tsx` | Abort superseded and closing/unmounting lookups; retain generation checks. |
| `tests/integration/business.test.ts` | Deterministic concurrent Admin regression, once-only side effects, and receipt replay/new-mutation assertions. |
| `tests/unit/esl-scanner-modal.test.ts` | Five focused modal cancellation and stale-result cases. |
| `tests/e2e/smoke.spec.ts` | Assert real browser cancellation in the existing ESL stale-response scenario. |
| `package.json` | Add Happy DOM as a development-only component-test environment. |
| `package-lock.json` | Lock Happy DOM 21.0.4 and its development dependencies. Existing dependency versions are unchanged. |
| `.superpowers/sdd/2026-11-15-test-feedback-adjustments/exceptional-cleanup-report.md` | This detailed report, committed separately after the implementation SHA was available. |

No schema or migration changes were needed. The dev server temporarily regenerated `next-env.d.ts`; the production build returned it to the tracked production form, so no generated-file churn was committed.

## Review and concerns

Self-review confirmed that the conditional transition precedes all FEFO and quarantine side effects, its status predicate also protects Admin/Manager requests, and Staff assignment checks remain in the database predicate. The transaction makes the early completion transition invisible until all completion work commits. The integration test's read barrier exercises the actual lost-update window and validates persisted side effects rather than mock call counts.

Scanner cancellation invalidates the generation before aborting, and an obsolete request's `finally` cannot clear the replacement request's controller or loading state. Close tests retain the mounted test modal when invoking the close callback, separately proving explicit close cancellation rather than depending solely on parent unmount cleanup.

No blocking implementation concerns remain. The following existing diagnostics are recorded without unrelated changes:

- Lint retains `@next/next/no-img-element` at `src/components/esl-qr-demo.tsx:38` for the generated data-URL QR image.
- `npm install` reported seven moderate audit findings. A follow-up `npm audit --json` exited 1 with seven moderate findings and no high or critical findings, all in the existing `minimatch` / TypeScript ESLint dependency chain. None names Happy DOM or its newly added dependencies. Dependency remediation is outside this cleanup's scope; existing dependency versions were not changed.
- Playwright emitted color-environment warnings and ZXing reader diagnostics during the camera scenario; that scenario and the full suite passed.

All work was performed directly in the requested worktree with no subagents and no changes to unrelated production behavior.
