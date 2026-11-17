# Staff Toast Top Position and Close Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move staff toast notifications to the top-right and let users dismiss them immediately with an accessible close button.

**Architecture:** Keep the existing StaffApp toast state and timeout, change only its rendered structure and shared CSS. Reuse the already imported `X` icon and validate behavior against the real StaffApp plus real stylesheet.

**Tech Stack:** TypeScript, React, CSS, Vitest/happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-17-staff-toast-top-close-design.md`

## Global Constraints

- Staff toast stack is fixed at the top-right, not the bottom-right.
- Each staff toast has an `X` close button with `aria-label="Đóng thông báo"` and a 44px touch target.
- Clicking close immediately removes the toast.
- Existing success/error copy, colors, z-index, width, triggers, and 4.2-second automatic dismissal remain unchanged.
- Admin Sonner toast behavior remains unchanged.
- Preserve the user's existing uncommitted `next-env.d.ts` change.

## Review Focus

- Close action removes both success and error toast variants because they share one renderer.
- The button uses `type="button"` and does not trigger surrounding form behavior.
- Top/right offsets remain usable at 320px viewport width without horizontal overflow.
- Existing timeout can fire after manual dismissal without recreating or corrupting toast state.
- Toast content remains readable and the close control remains visually distinct against both color variants.

---

### Task 1: Reposition and make staff toast dismissible

**Files:**
- Modify: `tests/unit/staff-task-interactions.test.tsx`
- Modify: `src/components/staff-app.tsx:311`
- Modify: `src/app/globals.css:25`

**Interfaces:**
- Consumes: existing `toast` state and `notify(message, error)` timeout behavior in `StaffApp`.
- Produces: `.toast-stack` at top-right and `.toast-close` button that calls `setToast(null)`.

- [ ] **Step 1: Write the failing real-component test**

Load `src/app/globals.css` into `tests/unit/staff-task-interactions.test.tsx`. Trigger the existing rejected-start error toast through the real `StaffApp`; assert the stack is fixed with `top: 20px`, `right: 20px`, and `bottom: auto`, the `Đóng thông báo` button has a minimum 44px target, and clicking it removes `.toast-stack`.

- [ ] **Step 2: Run the test to verify RED**

Run: `npm test -- tests/unit/staff-task-interactions.test.tsx -t "places staff toast at the top-right and lets staff dismiss it"`

Expected: FAIL because the stack is bottom-positioned and no close button exists.

- [ ] **Step 3: Implement the toast structure and styles**

In `src/components/staff-app.tsx`, wrap toast copy and add `<button type="button" className="toast-close" aria-label="Đóng thông báo" onClick={() => setToast(null)}><X /></button>`. In `src/app/globals.css`, change `.toast-stack` from `bottom:20px` to `top:20px;bottom:auto`, lay out toast copy and close control without changing existing colors/width/z-index, and give `.toast-close` a minimum 44px width and height.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `npm test -- tests/unit/staff-task-interactions.test.tsx tests/unit/app-typography.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run task verification**

Run: `npm run typecheck && npm test`

Expected: PASS with no new failures.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-11-17-staff-toast-top-close-design.md docs/superpowers/plans/2026-11-17-staff-toast-top-close.md tests/unit/staff-task-interactions.test.tsx src/components/staff-app.tsx src/app/globals.css
git commit -m "fix: move staff toast to top right"
```
