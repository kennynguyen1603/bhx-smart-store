# Stale FEFO Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close obsolete FEFO tasks successfully when their lot already satisfies a markdown rule, while preserving lot data and giving staff an actionable success message.

**Architecture:** Extend `completeFefoTask` with one atomic superseded-task outcome used by both the precheck and distinct-task race path. The outcome cancels only the task, records event/audit/receipt data, and returns `resolution: "ALREADY_APPLIED"`; `StaffApp` chooses the matching success copy from the response.

**Tech Stack:** TypeScript, Next.js/React, Prisma/PostgreSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-stale-fefo-and-kiosk-search-design.md`

## Global Constraints

- Equal or higher existing markdown must be a successful terminal outcome, not `MARKDOWN_NOT_UPGRADABLE`.
- The terminal task status is `CANCELLED` with note `Không cần xử lý: lô đã giảm X%, bằng hoặc cao hơn quy tắc Y%.`
- The lot and markdown history remain unchanged; no new `Markdown` row is created.
- Record `TaskEvent.type = "CANCELLED"`, audit action `FEFO_TASK_SUPERSEDED`, and an idempotent mutation receipt.
- Return `resolution: "ALREADY_APPLIED"`; the staff success copy is `Nhiệm vụ đã được đóng vì lô đã có mức giảm giá phù hợp.`
- Turn the ESL LED off only if no other active task remains for the same store, product, and shelf.
- Preserve real conflict responses for missing rules, non-sellable lots, invalid states, ownership, and authorization.
- Preserve the user's existing `next-env.d.ts` change.

## Review Focus

- Equal and higher markdown percentages both cancel with exact percentages in the note.
- Retrying the same client mutation returns the receipt without duplicate event or audit rows.
- Two distinct tasks racing on one lot produce one completed task and one cancelled task, but the same task racing still rejects the loser as an invalid state.
- A remaining active sibling task keeps the ESL LED on; no sibling allows it to turn off.
- A lot concurrently quarantined or sold out still returns `LOT_NOT_SELLABLE` and is not cancelled as superseded.

---

### Task 1: Resolve obsolete FEFO tasks and surface the outcome

**Files:**
- Modify: `src/lib/business.ts:317-391`
- Modify: `src/components/staff-app.tsx:201-228`
- Modify: `tests/integration/business.test.ts:380-510`
- Modify: `tests/unit/staff-task-interactions.test.tsx`

**Interfaces:**
- Consumes: existing `completeFefoTask(taskId, user, clientMutationId)` and staff `mutation(...)` flow.
- Produces: FEFO responses with `resolution?: "ALREADY_APPLIED"`; cancelled task responses contain task status/note and unchanged lot summary.
- Produces: `mutation(url, body, success: string | ((result: { resolution?: "ALREADY_APPLIED" }) => string)): Promise<boolean | "queued">`, preserving its current return contract for callers.

- [ ] **Step 1: Write failing business integration tests**

Replace the old `MARKDOWN_NOT_UPGRADABLE` expectation with tests that assert equal and higher markdowns return `resolution: "ALREADY_APPLIED"`, task `CANCELLED`, exact note percentages, one `CANCELLED` event, one `FEFO_TASK_SUPERSEDED` audit entry on the task, one mutation receipt, no lot/markdown mutation, and idempotent retry. Add one active sibling task case that keeps `ESL-TST-01` on and one no-sibling case that turns it off. Update the distinct-task concurrency case to expect two fulfilled results, exactly one `COMPLETED`, exactly one `CANCELLED`, one markdown, two receipts, and only one completion notification/push; keep the same-task race expectation rejected with `INVALID_TASK_STATE`.

- [ ] **Step 2: Run the business integration tests to verify RED**

Run: `npm test -- tests/integration/business.test.ts`

Expected: FAIL because obsolete FEFO tasks still throw `MARKDOWN_NOT_UPGRADABLE` and do not record cancellation side effects.

- [ ] **Step 3: Implement the atomic superseded-task outcome**

In `src/lib/business.ts`, add a transaction-local helper or equivalent focused branch that claims the still-active task as `CANCELLED`, sets `assigneeId` and the exact note, creates the cancellation event/audit/receipt, leaves the lot untouched, recomputes the ESL LED from remaining active tasks, and returns `resolution: "ALREADY_APPLIED"`. Use it from both the precheck and the failed lot-upgrade race after confirming the lot is still sellable and now satisfies the rule. Do not send completion notifications or push messages for cancellation.

- [ ] **Step 4: Run the business integration tests to verify GREEN**

Run: `npm test -- tests/integration/business.test.ts`

Expected: PASS.

- [ ] **Step 5: Write a failing staff UI test**

In `tests/unit/staff-task-interactions.test.tsx`, add a FEFO task fixture and successful POST response with `resolution: "ALREADY_APPLIED"`; assert the modal closes, task data reloads, and the toast contains `Nhiệm vụ đã được đóng vì lô đã có mức giảm giá phù hợp.` rather than the normal FEFO success message.

- [ ] **Step 6: Run the staff UI test to verify RED**

Run: `npm test -- tests/unit/staff-task-interactions.test.tsx`

Expected: FAIL because `mutation` ignores the successful response payload.

- [ ] **Step 7: Implement response-aware success copy**

In `src/components/staff-app.tsx`, let the existing `mutation` flow parse the successful response and accept either a fixed success string or a response-to-message callback while preserving its `boolean | "queued"` return contract. For FEFO completion, pass a callback that selects the exact obsolete-task success copy when `resolution === "ALREADY_APPLIED"`; retain the current RESTOCK, quarantine, normal FEFO, start, error, and offline behavior.

- [ ] **Step 8: Run focused and full tests**

Run: `npm test -- tests/integration/business.test.ts tests/unit/staff-task-interactions.test.tsx`

Expected: PASS.

Run: `npm test`

Expected: PASS with no new failures.

- [ ] **Step 9: Commit**

```bash
git add src/lib/business.ts src/components/staff-app.tsx tests/integration/business.test.ts tests/unit/staff-task-interactions.test.tsx
git commit -m "fix: resolve obsolete FEFO tasks"
```

