# Stale FEFO tasks and kiosk search design

**Date:** 2026-11-17

## Context

Two related usability issues remain after the feedback-dot3 work:

1. A FEFO task returns `MARKDOWN_NOT_UPGRADABLE` when its lot already has an equal or higher markdown. The task stays active, so staff see an error but have no next action.
2. The customer kiosk always labels the primary action `Tìm kiếm`, even when the search field is empty and submitting it loads the complete product catalog.

## Goals

- Resolve obsolete FEFO work as a successful terminal outcome instead of a blocking error.
- Preserve price, markdown history, and lot state when no stronger markdown is needed.
- Make the kiosk primary action describe what will happen for both empty and non-empty input.
- Keep mutation retries idempotent and preserve the current offline queue behavior.

## Non-goals

- No background migration or bulk cancellation of all historical FEFO tasks.
- No manual task-cancellation workflow.
- No change to FEFO rule selection or product search ranking.

## Chosen behavior

### Obsolete FEFO task

When a non-quarantine FEFO task is completed and the lot already has a markdown percentage greater than or equal to the applicable rule:

- Treat the request as successful.
- Atomically change the task to `CANCELLED` and assign the acting user.
- Store an actionable note such as `Không cần xử lý: lô đã giảm 30%, bằng hoặc cao hơn quy tắc 20%.`
- Add a `TaskEvent` with type `CANCELLED` and the same note.
- Add an audit record with action `FEFO_TASK_SUPERSEDED`; the lot is not changed and no `Markdown` row is created.
- Store and return a mutation receipt so retries return the same result.
- Return a resolution marker such as `ALREADY_APPLIED` so the staff UI can show `Nhiệm vụ đã được đóng vì lô đã có mức giảm giá phù hợp.`
- Refresh the task list and close the task modal as it does after other successful completions.
- Turn the ESL LED off only when no other active task remains for the same store, product, and shelf.

The same resolution applies to the concurrency path where another task upgrades the lot after this task has begun. A normal price upgrade still completes the winner as `COMPLETED`; the obsolete task ends as `CANCELLED`.

Real conflicts remain errors: missing rule, non-sellable lot, forbidden store, invalid task state, and task ownership conflicts.

### Kiosk primary action

- Normalize the field with `trim()` when deciding the action and building the request.
- Empty or whitespace-only input shows `Xem tất cả sản phẩm`.
- Non-empty input shows `Tìm kiếm`.
- During either request, keep the existing loading label `Đang tìm…`.
- Submitting empty input calls the existing catalog search without a `q` parameter and opens the results view containing all products for the selected store.
- Clearing a typed value immediately restores `Xem tất cả sản phẩm`.
- Result headings use the normalized query, avoiding headings that contain only whitespace.

## Test strategy

- Business integration tests for an already-discounted lot, idempotent retry, preserved lot/markdown data, cancellation event/audit, and ESL behavior.
- Concurrency integration test asserting one completed task and one cancelled obsolete task.
- Kiosk component test for the initial label, typing, clearing, whitespace-only input, and the request URL.
- Update affected Playwright expectations and retain the existing typed-search, barcode, category, and mobile-detail coverage.
- Run focused tests first, followed by the full test suite before merging.
