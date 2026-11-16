# Feedback Dot 3 — Role Login and UI Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate role entry points, remove demo credentials from the public UI, make logout and LED meaning obvious, and raise screen typography to the approved readable scale.

**Architecture:** Keep one Auth.js credentials provider and enforce route roles after authentication, while presenting separate Staff and Admin login pages. Replace scattered screen typography values with a small token scale, explicitly excluding physical print sheets and dense store-map geometry.

**Tech Stack:** Next.js 16 App Router, React 19, Auth.js/NextAuth Credentials, TypeScript, CSS, Vitest/Happy DOM, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-feedback-dot3-design.md`

**Execution dependency:** Run after the kiosk-data and tasks-realtime plans; typography/privacy acceptance covers the barcode sheet and Admin notification controls those plans add.

## Global Constraints

- Read the relevant guides in `node_modules/next/dist/docs/` before changing page/redirect behavior.
- `/staff/login` accepts Staff and Manager; `/admin/login` accepts Manager and Admin.
- `/login` is a role-choice page and must not show account emails or passwords.
- No login form may prefill credentials or bundle the demo account list into client UI.
- Body/control text is at least 14px; secondary labels/badges are at least 12px; touch controls are at least 44px where layout permits.
- Do not enlarge store-map geometry/annotations or alter ESL/product barcode physical print dimensions.
- User-facing copy remains Vietnamese and route guards remain server-side.

## Review Focus

- Valid credentials entered on the wrong role page must be signed back out and receive a clear link to the correct page; pin this in Task 1.
- A crafted `callbackUrl` must not send Staff to Admin or allow an external redirect; pin this in Task 1.
- Existing authenticated Admin visiting `/staff` and Staff visiting `/admin` must be redirected to their allowed experience; pin this in Task 1.
- At 320px the Admin notification/reload/logout controls and navigation must remain clickable without horizontal page overflow; pin this in Task 2.
- Screen typography cleanup must not change A4 QR/barcode size or map annotation density; pin this in Task 3.

---

### Task 1: Role-specific login pages and route guards

**Files:**
- Modify: `src/components/login-form.tsx`
- Create: `src/components/login-role-choice.tsx`
- Modify: `src/app/login/page.tsx`
- Create: `src/app/staff/login/page.tsx`
- Create: `src/app/admin/login/page.tsx`
- Modify: `src/app/staff/page.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/demo-roles.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/unit/login-form.test.tsx`
- Modify: `tests/unit/demo-roles.test.ts`
- Modify: `tests/unit/home-page.test.tsx`
- Create: `tests/unit/role-pages.test.tsx`
- Modify: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `LoginAudience = "staff" | "admin"`.
- Changes: `LoginForm({ audience, callbackUrl? }: { audience: LoginAudience; callbackUrl?: string })`.
- Produces: `isRoleAllowedForAudience(role: Role, audience: LoginAudience): boolean`.
- Produces: `safeAudienceCallback(audience: LoginAudience, callbackUrl?: string): "/staff" | "/admin" | string`, accepting only same-origin relative paths under the chosen experience.
- Replaces client `DEMO_ACCOUNTS` with `ROLE_LABELS: Record<Role, string>`; demo emails/password remain in seed and README only.

- [ ] **Step 1: Write failing form and helper tests**

  Assert both forms start with blank email/password and render no account chips/demo password. Assert Staff/Manager are allowed for `staff`, Manager/Admin for `admin`. Assert external, protocol-relative, cross-role, and malformed callback URLs fall back to `/staff` or `/admin`.

- [ ] **Step 2: Write failing wrong-role behavior tests**

  Mock successful credentials plus `/api/auth/session`: Staff on Admin login and Admin on Staff login call `signOut({ redirect: false })`, remain on the form, and show the correct-page link. Manager succeeds on both. Invalid credentials retain the generic credential error without revealing whether an email exists.

- [ ] **Step 3: Run focused tests and confirm RED**

  Run: `npx vitest run tests/unit/login-form.test.tsx tests/unit/demo-roles.test.ts tests/unit/role-pages.test.tsx tests/unit/home-page.test.tsx`

  Expected: current shared login is prefilled and exposes all demo credentials.

- [ ] **Step 4: Build separate entry pages and compact role chooser**

  Reuse one visual shell but provide role-specific heading/help. `/login` renders only two links: `Tôi là nhân viên / quản lý` and `Tôi là quản trị`. Preserve a valid callback only when it belongs to the chosen audience.

- [ ] **Step 5: Verify the authenticated role before navigation**

  After `signIn(..., { redirect: false })` succeeds, fetch `/api/auth/session`, validate the audience, and only then navigate. On mismatch, sign out without redirect and show the correct login link. Keep Auth.js `pages.signIn` at `/login` as the neutral chooser.

- [ ] **Step 6: Update server page guards and public links**

  Unauthenticated `/staff` redirects to `/staff/login?callbackUrl=/staff`; unauthenticated `/admin` redirects to `/admin/login?callbackUrl=/admin`. Redirect authenticated disallowed roles to their primary experience. Point home cards/secondary Admin link to the new routes.

- [ ] **Step 7: Run focused and browser verification**

  Run: `npx vitest run tests/unit/login-form.test.tsx tests/unit/demo-roles.test.ts tests/unit/role-pages.test.tsx tests/unit/home-page.test.tsx && npm run test:e2e -- --grep "role login|wrong role|route guard"`

  Expected: PASS.

- [ ] **Step 8: Commit**

  ```bash
  git add src/components/login-form.tsx src/components/login-role-choice.tsx src/app/login/page.tsx src/app/staff/login/page.tsx src/app/admin/login/page.tsx src/app/staff/page.tsx src/app/admin/page.tsx src/lib/auth.ts src/lib/demo-roles.ts src/app/page.tsx src/app/globals.css tests/unit/login-form.test.tsx tests/unit/demo-roles.test.ts tests/unit/home-page.test.tsx tests/unit/role-pages.test.tsx tests/e2e/smoke.spec.ts
  git commit -m "feat: split login by role"
  ```

### Task 2: Visible logout and clear ESL LED meaning

**Files:**
- Modify: `src/components/admin-app.tsx`
- Modify: `src/components/staff-app.tsx`
- Modify: `src/components/admin/forms/esl-form.tsx`
- Modify: `src/components/admin/forms/reference-fields.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/unit/admin-session-controls.test.tsx`
- Modify: `tests/unit/admin-reference-forms.test.tsx`
- Modify: `tests/e2e/admin-foundation.spec.ts`
- Modify: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: visible `Đăng xuất` controls in Admin desktop sidebar and mobile header.
- Extends: `ReferenceToggle({ name, label, description? })` for inline field help.
- Sign-out destinations: Staff/Manager Staff app -> `/staff/login`; Admin backoffice -> `/admin/login`.

- [ ] **Step 1: Write failing control/help tests**

  Assert Admin renders a named logout button on desktop and mobile, both invoke `signOut` once with `/admin/login`. Assert ESL form associates the LED toggle with: `Đèn LED trên nhãn kệ sáng khi tồn kho chạm ngưỡng cảnh báo, tắt sau khi bổ sung.`

- [ ] **Step 2: Add failing responsive E2E**

  At 320/390/760px assert Admin logout is visible, its center point resolves to the button, it does not overlap notification/reload, and the page has no horizontal body overflow. Assert Staff sign-out returns to `/staff/login`.

- [ ] **Step 3: Run tests and confirm RED**

  Run: `npx vitest run tests/unit/admin-session-controls.test.tsx tests/unit/admin-reference-forms.test.tsx`

  Expected: Admin currently exposes only an unlabeled sidebar icon and the ESL toggle has no explanation.

- [ ] **Step 4: Add explicit session controls**

  Keep the desktop user card but add text to the logout action. Add a nonshrinking 44×44 mobile Admin header control with accessible label and role-specific callback. Update Staff callbacks consistently.

- [ ] **Step 5: Add LED description at the control**

  Render the exact copy as persistent field description, not hover-only tooltip, so touch devices and screen readers receive it. Do not change automatic LED business rules.

- [ ] **Step 6: Run focused verification and commit**

  Run: `npx vitest run tests/unit/admin-session-controls.test.tsx tests/unit/admin-reference-forms.test.tsx && npm run test:e2e -- --grep "Admin session controls|LED explanation|mobile staff navbar"`

  ```bash
  git add src/components/admin-app.tsx src/components/staff-app.tsx src/components/admin/forms/esl-form.tsx src/components/admin/forms/reference-fields.tsx src/app/globals.css tests/unit/admin-session-controls.test.tsx tests/unit/admin-reference-forms.test.tsx tests/e2e/admin-foundation.spec.ts tests/e2e/smoke.spec.ts
  git commit -m "fix: clarify logout and ESL LED controls"
  ```

### Task 3: Consolidated readable screen typography

**Files:**
- Modify: `src/app/globals.css`
- Modify: `tests/unit/screen-typography.test.tsx`
- Create: `tests/unit/app-typography.test.tsx`
- Modify: `tests/e2e/demo-mobile-polish.spec.ts`

**Interfaces:**
- Adds CSS tokens: `--font-body: 14px`, `--font-control: 14px`, `--font-meta: 12px`, `--font-title-sm: 18px`, `--touch-target: 44px`.
- Applies tokens only under screen application surfaces; print sheets and store-map geometry retain explicit isolated sizes.

- [ ] **Step 1: Expand failing typography coverage**

  Render landing, role login, Staff task list/modal/filters, Admin navigation/table/forms/notification center, Kiosk cards/details/scanner at 320, 390, and 1280px. Assert body/control text >=14px, meta/badge text >=12px, touch controls >=44px, and no horizontal body overflow.

- [ ] **Step 2: Preserve dense/physical exceptions in tests**

  Retain assertions that map shelf/facility labels stay below 11px and ESL QR is 58mm. Add the product barcode sheet's planned physical-size assertion from the kiosk-data plan.

- [ ] **Step 3: Run tests and confirm RED**

  Run: `npx vitest run tests/unit/screen-typography.test.tsx tests/unit/app-typography.test.tsx`

  Expected: remaining legacy 6–11px selectors outside current overrides fail.

- [ ] **Step 4: Introduce tokens and replace scattered screen values**

  Move the approved sizes to `:root`, update landing/auth/app/kiosk selectors to consume them, and remove redundant late overrides where the base rule now satisfies the contract. Do not apply a blanket `* { font-size }` rule.

- [ ] **Step 5: Rebalance layouts after type growth**

  Allow wrapping/min-width zero in task rows, metric cards, Admin header/actions, dialogs, and kiosk cards. Keep desktop information hierarchy while preventing truncation at mobile widths.

- [ ] **Step 6: Run focused and responsive verification**

  Run: `npx vitest run tests/unit/screen-typography.test.tsx tests/unit/app-typography.test.tsx && npm run test:e2e -- tests/e2e/demo-mobile-polish.spec.ts`

  Expected: PASS at all target widths; print/map exception assertions unchanged.

- [ ] **Step 7: Commit**

  ```bash
  git add src/app/globals.css tests/unit/screen-typography.test.tsx tests/unit/app-typography.test.tsx tests/e2e/demo-mobile-polish.spec.ts
  git commit -m "style: standardize readable screen type"
  ```

### Task 4: Authentication/UI acceptance and documentation

**Files:**
- Modify: `README.md`
- Modify: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Documents: role-specific URLs and demo credentials outside the public app UI.

- [ ] **Step 1: Add the public-surface privacy acceptance test**

  Visit `/`, `/login`, `/staff/login`, and `/admin/login`; assert none contains `staff@demo.bhx`, `manager@demo.bhx`, `admin@demo.bhx`, or `Demo@123`. Verify each role can still sign in at the permitted page and logout returns to the matching page.

- [ ] **Step 2: Update README test instructions**

  Keep the three demo accounts in README, explicitly map Staff/Manager to `/staff/login` and Manager/Admin to `/admin/login`, and warn testers not to share a mutable session concurrently.

- [ ] **Step 3: Run the plan gate**

  Run: `npm run typecheck && npm test && npm run build && npm run test:e2e -- --grep "login|logout|typography|public credentials"`

  Expected: all commands PASS.

- [ ] **Step 4: Commit**

  ```bash
  git add README.md tests/e2e/smoke.spec.ts
  git commit -m "docs: document role-specific demo access"
  ```
