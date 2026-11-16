# Mobile reliability and shadcn admin forms

## Intent

Make Staff/Manager mobile controls reliable and replace every browser-native Admin CRUD interaction with consistent, accessible shadcn-based forms. Users must always understand whether a notification or integration action has started, succeeded, or failed.

## Goals

- The mobile notification button has a stable 44×44px hit target and remains clickable at supported widths.
- Staff and Manager open ESL as a real application tab. The task list is not rendered beneath it, the ESL tab is active, and returning/closing is deterministic.
- All Admin create/edit operations use accessible dialog forms; no `prompt()` remains.
- All destructive Admin actions use an accessible confirmation dialog; no `confirm()` remains.
- Inputs are validated before submission with field-level Vietnamese errors.
- Submit buttons show pending state, prevent duplicate requests, keep the dialog open on failure, and close only on success.
- Integration simulator buttons show per-action loading text/spinner and disable all simulator actions while one request runs.
- Existing role and API authorization rules remain unchanged.

## Non-goals

- No database schema or API contract redesign.
- No visual redesign of Kiosk or task execution modals.
- No new notification backend behavior; this work only makes the existing Web Push control usable and exposes its pending/error state.
- No bulk editing, undo history, or optimistic persistence.

## Chosen approach

Use source-owned shadcn-style components backed by the official Radix primitives, React Hook Form, Zod, and Sonner. Components live under `src/components/ui` and are adapted to the existing BHX CSS tokens rather than importing a global Tailwind reset that could change the current application. This keeps the shadcn accessibility and composition model while preserving the established visual system.

Rejected alternatives:

- One schema-driven generic CRUD form: less code, but poor field semantics for lots, ESL, FEFO, inventory, and users.
- Staged migration: safer per release, but leaves mixed browser prompts and dialogs during the transition.

## Mobile behavior

### ESL

`StaffApp` owns a four-state navigation model: overview, tasks, history, and scanner. Selecting scanner renders the ESL experience as the selected application state, never as a side effect of the tasks tab. The scanner may retain its focused overlay presentation, but the task page must be unmounted and the ESL nav item must be active. Closing returns to overview; choosing a task transitions to tasks and opens that task. The behavior is identical for Staff and Manager, while Manager keeps oversight-only task authorization.

### Notification and logout controls

Header actions use explicit mobile layout rules, 44×44px minimum targets, non-overlapping flex items, and visible focus states. Notification and logout buttons remain above content and below full-screen dialogs by z-index. Notification permission/setup exposes a pending state and disables repeat clicks.

## Admin form architecture

Create reusable UI primitives:

- `Dialog`, `AlertDialog`, `Button`, `Input`, `Label`, `Select`, `Checkbox`, `Form`, `FormField`, `FormMessage`, `Toaster`.
- `AdminEntityDialog` provides title, description, scrollable form body, cancel/submit actions, pending state, and responsive mobile sizing.
- `AdminConfirmDialog` handles hide, deactivate, close, detach, delete, and lock actions with resource-specific copy.

Create dedicated forms/schemas for:

1. Store create/edit.
2. Inventory edit: on-shelf, backroom, capacity, low threshold.
3. Product create/edit.
4. Supplier create/edit.
5. Lot create/edit with product/supplier selects and date/quantity validation.
6. Zone create/edit with color validation.
7. Shelf create/edit; creation starts with map defaults currently used by the API.
8. ESL attach/edit using shelf and product selects.
9. FEFO rule create/edit including quarantine and active toggles.
10. User create/edit with role and store selection.

The parent Admin app stores one typed dialog descriptor (`kind`, `mode`, entity ID/default values) instead of one boolean per form. Each form receives reference data and an async submit callback. API success returns a boolean/result; forms close and reset only after success. API failure is shown by Sonner and preserves entered values.

Destructive actions open a typed confirmation descriptor. Confirmation is pending-safe and closes only after the API succeeds.

## Feedback and loading

- Replace hand-built Admin toast state with Sonner toasts.
- Keep non-CRUD Staff task feedback as the existing in-app toast; browser alerts are not used.
- `api()` returns a structured success/failure result and does not silently close UI.
- Integration mode state is `null | POS | WMS | SUPPLIER | FEFO`. The active button displays a spinner and `Đang xử lý…`; all simulator buttons are disabled until request plus refresh completes.
- Refresh, notification permission, form submit, and destructive confirm each expose pending and disabled states.

## Error handling

- Client Zod errors render under the relevant field in Vietnamese.
- Server `error.message` is surfaced in a toast.
- Network errors are caught and reported without closing the form.
- Duplicate submit is prevented by pending guards and disabled buttons.
- Dialog focus is trapped and restored to the trigger by Radix.

## Testing

- Unit/component tests verify schemas, dialogs preserve values on API failure, pending buttons disable duplicate submission, and integration loading state.
- Mobile E2E covers Staff and Manager ESL navigation, task page absence, notification click invocation, notification pending state, and mobile logout.
- Admin E2E asserts no native dialog event is triggered, exercises representative create/edit/destructive forms, validates field errors, and checks integration loading/disabled state.
- Existing full Vitest, Playwright, typecheck, lint, and production build remain green.

## Constraints and rulings

- Preserve existing custom CSS and brand styling; shadcn primitives are customized locally.
- Preserve all current API routes and authorization.
- Treat every `prompt()` and `confirm()` in Admin as in scope, including create and delete flows.
- Use Vietnamese labels and errors throughout.
- If a reference record is unavailable, disable the relevant create action and explain why rather than constructing invalid payloads.
- Fix the existing inventory PUT parser: parse optional fields with an unrefined base schema, merge with persisted inventory, then validate the complete refined schema. Preserve version increment and audit logging.
- Respect API create/edit asymmetry: immutable identifiers and references are read-only on edit; FEFO rules are active on creation and expose `active` only on edit; shelf creation explicitly sends `{x:0,y:1,width:1,height:2}`.
- Extend Admin response types so edits initialize from actual ESL IDs, shelf zone IDs, user memberships, and default membership. Show every ESL rather than silently using the first.
- A successful mutation and a failed refresh are separate outcomes: close after confirmed write success, report refresh failure separately, and retry only the read to avoid duplicate effects.
- Push setup checks browser support and subscription POST status, bounds service-worker readiness, and always clears pending state. Development E2E mocks browser push APIs; real push remains a production verification.
- Test mobile controls at 320px, 390px, and 760px. Controls are nonshrinking and at least 44px. Dialog focus returns to the opener or a stable fallback; Admin dialog CSS cannot alter existing task/Kiosk modals.
- Preserve the current global FEFO simulation scope and label it accurately; changing its store scope or permission model is outside this UI task.
