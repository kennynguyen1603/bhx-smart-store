# Login home navigation and admin dialog scrolling design

**Date:** 2026-11-17

## Context

The three login entry points (`/login`, `/staff/login`, and `/admin/login`) share `LoginShell`, but none gives a signed-out user a direct way back to the customer-facing home page. Admin entity dialogs already cap their height and mark the fieldset as scrollable, but `.admin-dialog-content` overrides the generic dialog scrolling with `overflow: hidden` without defining a constrained grid row for the form. On short desktop, tablet, and mobile viewports, a long form can therefore extend below the visible dialog while its intended body scroller never receives usable height.

## Chosen behavior

- Add one shared link styled as a button with the label `Về trang chủ` and destination `/`.
- Render it through `LoginShell`, so it appears once on all three login entry points without duplicating page-specific code.
- Place the link above and aligned with the login card; keep the card centered and preserve all callback URL and authentication behavior.
- Keep an admin entity dialog within `calc(100dvh - 24px)` on desktop and `calc(100dvh - 16px)` at widths up to 760px.
- Keep the dialog title/description and Lưu/Hủy footer visible while only `.admin-dialog-body` scrolls vertically.
- Give the dialog grid an explicit `auto minmax(0, 1fr)` row structure, let the form fill the constrained second row, and let the fieldset grow/shrink as the scroll region.
- Do not change confirmation dialogs, form validation, submit/pending behavior, focus restoration, or dismissal guards.

## Alternatives considered

- Add separate home links to the staff and admin forms: rejected because it duplicates behavior and leaves `/login` without a return path.
- Make the entire admin dialog scroll: rejected because Lưu/Hủy would disappear while the user reviews lower fields.
- Convert admin forms to full-screen mobile sheets: rejected as unnecessary scope expansion for a height-allocation defect.

## Accessibility and responsive details

- The home link remains a semantic anchor and uses the existing button styling and minimum touch-target rules.
- At 320px and wider, the link and card remain inside the auth panel without horizontal overflow.
- Native wheel/touch scrolling moves the real `.admin-dialog-body`; keyboard focus can still reach every field.
- The admin footer remains visible before and after body scrolling so actions are always reachable.

## Test strategy

- Extend the real login shell typography test to assert that each login variant exposes exactly one `Về trang chủ` link to `/` with a touch-sized target.
- Extend the browser-based admin foundation fixture with a deliberately tall entity form.
- At a 390×320 viewport, assert that the dialog stays inside the viewport, its body has real overflow, wheel input changes `scrollTop`, the last field becomes visible, and the footer remains visible.
- Run the focused tests through a RED/GREEN cycle, followed by typecheck, the full unit suite, and the relevant Playwright foundation suite.
