# Login Home Navigation and Admin Dialog Scrolling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every login screen a clear route back to the home page and keep every admin form field reachable on short desktop, tablet, and mobile viewports.

**Architecture:** Put the home action in the existing shared `LoginShell` and add a small layout wrapper that aligns it with the login card. Repair only the admin entity-dialog sizing chain: an explicit constrained grid row contains a flex form whose fieldset is the sole vertical scroller, leaving the header and footer visible.

**Tech Stack:** Next.js 16, TypeScript, React 19, Radix Dialog, CSS, Vitest/happy-dom, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-login-home-admin-dialog-scroll-design.md`

## Global Constraints

- Render exactly one `Về trang chủ` link to `/` on `/login`, `/staff/login`, and `/admin/login` through `LoginShell`.
- Preserve callback URL handling and all authentication behavior.
- Keep the home action and login card usable without horizontal overflow at widths of 320px and above.
- Keep admin entity-dialog title/description and Lưu/Hủy footer visible while only `.admin-dialog-body` scrolls.
- Keep entity dialogs inside the existing desktop and mobile `100dvh` height limits.
- Do not change admin confirmation dialogs, validation, pending state, focus restoration, or dismissal guards.
- Preserve the user's existing uncommitted `next-env.d.ts` change on `main`.

## Review Focus

- The shared home link appears once, not once per shell plus once per form, and its literal destination is `/` regardless of `callbackUrl`.
- The login wrapper does not narrow or overflow the existing 440px card on desktop or a 320px viewport.
- A short viewport allocates real height to `.admin-dialog-body`; wheel/touch input changes its native scroll position rather than relying on programmatic scrolling.
- The footer remains visible and does not shrink or overlap the scrolling body at 390×320.
- Confirmation dialogs retain their current simple grid and are not accidentally forced into the entity form's two-row layout.

---

### Task 1: Add shared login home navigation

**Files:**
- Modify: `tests/unit/app-typography.test.tsx`
- Modify: `src/components/login-role-choice.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `LoginShell({ children }: { children: ReactNode })` and the existing `.auth-panel`, `.login-card`, and `.button` styles.
- Produces: `.auth-panel-content` wrapper and one `.auth-home-link` anchor with text `Về trang chủ` and `href="/"`.

- [ ] **Step 1: Write the failing real-component test**

In the existing `describe.each([320, 390, 1280])` login typography case, query `.auth-home-link`, assert exactly one anchor exists, its text is `Về trang chủ`, its `href` is `/`, and include it in the touch-target assertion for every `choice`, `staff`, and `admin` variant.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `npm test -- tests/unit/app-typography.test.tsx -t "keeps .* login copy and controls readable"`

Expected: FAIL because `.auth-home-link` does not exist.

- [ ] **Step 3: Implement the shared home action**

In `LoginShell`, wrap the home action and `children` in `.auth-panel-content`; render a Next.js `Link` with class `button secondary auth-home-link`, label `Về trang chủ`, and literal `href="/"`. Add layout CSS so the wrapper remains `min(440px, 100%)`, the link aligns to its start, and the nested login card fills the wrapper without changing the existing mobile auth-panel padding.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `npm test -- tests/unit/app-typography.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run task verification**

Run: `npm run typecheck && npm test`

Expected: PASS with no new failures.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-11-17-login-home-admin-dialog-scroll-design.md docs/superpowers/plans/2026-11-17-login-home-admin-dialog-scroll.md tests/unit/app-typography.test.tsx src/components/login-role-choice.tsx src/app/globals.css
git commit -m "feat: add home link to login screens"
```

### Task 2: Keep long admin entity forms scrollable

**Files:**
- Modify: `tests/fixtures/admin-foundation.tsx`
- Modify: `tests/e2e/admin-foundation.spec.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `.ui-dialog-content.admin-dialog-content`, `.admin-dialog-form`, `.admin-dialog-body`, and the `data-kind` switch in the admin foundation fixture.
- Produces: a `tall-entity` fixture and a constrained entity-dialog layout where `.admin-dialog-body` is the native vertical scroller.

- [ ] **Step 1: Write the failing short-viewport browser test**

Extend the fixture so `data-kind="tall-entity"` renders enough labeled inputs inside the real `AdminEntityDialog` to exceed a 390×320 viewport. Add a Playwright test that opens it at 390×320 and asserts: the dialog bounds stay within the viewport; the header and Lưu/Hủy footer are visible; `.admin-dialog-body` has `scrollHeight > clientHeight` and computed `overflow-y: auto`; native wheel input increases its `scrollTop`; the last labeled field becomes visible; and the footer stays visible after scrolling.

- [ ] **Step 2: Run the browser test to verify RED**

Run: `npx playwright test tests/e2e/admin-foundation.spec.ts --config=playwright.foundation.config.ts -g "long admin entity form keeps actions visible and body scrollable"`

Expected: FAIL because the current entity dialog does not allocate a definite shrinking row and flex share to the body scroller on the short viewport.

- [ ] **Step 3: Implement the constrained entity-dialog layout**

In `src/app/globals.css`, scope the explicit `grid-template-rows: auto minmax(0, 1fr)` to `.ui-dialog-content.admin-dialog-content`, make `.admin-dialog-form` fill that row, make `.admin-dialog-body` the growing/shrinking vertical scroller, and prevent `.ui-dialog-footer` inside the form from shrinking. Retain the existing generic dialog max heights and do not apply the entity row template to `.ui-alert-dialog-content` confirmation dialogs.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `npx playwright test tests/e2e/admin-foundation.spec.ts --config=playwright.foundation.config.ts -g "long admin entity form keeps actions visible and body scrollable" && npm test -- tests/unit/admin-dialogs.test.tsx tests/unit/app-typography.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run task verification**

Run: `npm run typecheck && npm test && npx playwright test tests/e2e/admin-foundation.spec.ts --config=playwright.foundation.config.ts`

Expected: PASS with no new failures.

- [ ] **Step 6: Run the production build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/admin-foundation.tsx tests/e2e/admin-foundation.spec.ts src/app/globals.css
git commit -m "fix: keep admin form body scrollable"
```
