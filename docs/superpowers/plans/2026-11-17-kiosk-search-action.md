# Kiosk Search Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the kiosk primary action say `Xem tất cả sản phẩm` for empty input and `Tìm kiếm` while the customer is typing a real query.

**Architecture:** Derive one normalized query with `trim()` at the search boundary and use it for the button label, request parameters, and result heading. Keep the existing search endpoint and results view unchanged.

**Tech Stack:** TypeScript, React, Next.js, Vitest/happy-dom, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-stale-fefo-and-kiosk-search-design.md`

## Global Constraints

- Empty or whitespace-only input shows `Xem tất cả sản phẩm`.
- Non-empty trimmed input shows `Tìm kiếm`.
- Loading continues to show `Đang tìm…`.
- Empty submission omits `q` and loads the full catalog for the selected store.
- Non-empty submission sends the trimmed query and the heading uses that normalized value.
- Clearing the field immediately restores `Xem tất cả sản phẩm`.
- Preserve barcode exact search, category search, store selection, and product-detail behavior.
- Preserve the user's existing `next-env.d.ts` change.

## Review Focus

- A whitespace-only value behaves exactly like an empty value and never emits `q`.
- Leading/trailing spaces are removed before both the request and heading are produced.
- Typing and clearing updates the accessible button name immediately.
- HID barcode exact search still sends `exact=1` with the scanned value.
- The empty action remains disabled until a store is selected and uses `Đang tìm…` while pending.

---

### Task 1: Add the context-aware kiosk search action

**Files:**
- Create: `tests/unit/kiosk-search-action.test.tsx`
- Modify: `src/components/kiosk-app.tsx:83-153`
- Modify: `tests/e2e/smoke.spec.ts:245-260`

**Interfaces:**
- Consumes: existing `KioskApp` form and `/api/kiosk/products/search` endpoint.
- Produces: dynamic accessible button label and normalized optional `q` parameter.

- [ ] **Step 1: Write failing kiosk component tests**

Create a happy-dom test using the real `KioskApp` with only fetch stubbed. Assert: after bootstrap the empty button is `Xem tất cả sản phẩm`; typing `  sua tuoi  ` changes it to `Tìm kiếm`; submitting sends `q=sua tuoi` and renders heading `Kết quả cho “sua tuoi”`; clearing or entering spaces restores `Xem tất cả sản phẩm`; submitting spaces sends no `q` and renders `Sản phẩm trong cửa hàng`; a pending request displays `Đang tìm…`.

- [ ] **Step 2: Run the component test to verify RED**

Run: `npm test -- tests/unit/kiosk-search-action.test.tsx`

Expected: FAIL because the button always says `Tìm kiếm` and the query is not normalized.

- [ ] **Step 3: Implement normalized search behavior**

In `src/components/kiosk-app.tsx`, normalize the submitted value once with `trim()`, use it for the optional `q`, store the normalized query before showing results, and derive the idle button label from `query.trim()`. Preserve the explicit barcode and category arguments and the existing loading state.

- [ ] **Step 4: Run the component test to verify GREEN**

Run: `npm test -- tests/unit/kiosk-search-action.test.tsx`

Expected: PASS.

- [ ] **Step 5: Update the reset regression expectation**

In `tests/e2e/smoke.spec.ts`, change the post-reset empty-input button expectation from `Tìm kiếm` to `Xem tất cả sản phẩm`; keep all typed-query expectations as `Tìm kiếm`.

- [ ] **Step 6: Run focused and full tests**

Run: `npm test -- tests/unit/kiosk-search-action.test.tsx tests/unit/kiosk-bootstrap.test.tsx tests/unit/screen-typography.test.tsx`

Expected: PASS.

Run: `npm test`

Expected: PASS with no new failures.

- [ ] **Step 7: Commit**

```bash
git add src/components/kiosk-app.tsx tests/unit/kiosk-search-action.test.tsx tests/e2e/smoke.spec.ts
git commit -m "fix: clarify kiosk search action"
```
