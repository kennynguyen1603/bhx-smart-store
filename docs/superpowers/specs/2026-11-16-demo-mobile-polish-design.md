# Mobile Demo Polish Design

**Date:** 2026-11-16  
**Status:** Approved for implementation; builder-reviewed  
**Scope:** Admin mobile map, notifications/push resilience, printable ESL demo labels, UI typography/cleanup, and role presentation

## Intent

Make the demo reliable and easy to understand on a phone without weakening the existing role permissions or production push behavior. The resulting demo must support a complete ESL story, avoid exposing infrastructure failures as alarming frontend errors, and present the product as the two experiences required by the source brief: the Staff app and the customer Kiosk. Administration remains available as supporting backoffice functionality.

## Evidence and Current Root Causes

- The Admin shelf map uses HTML5 `draggable`, `dragstart`, `dragover`, and `drop`. Mobile browsers do not provide a dependable touch implementation for that interaction, so shelves cannot be repositioned on a phone.
- The root provider explicitly unregisters all service workers outside production. The Staff notification action then waits for `navigator.serviceWorker.ready`, which cannot resolve locally and eventually produces an error toast.
- The notification bell immediately starts push-permission setup. A bell should open notifications first; browser/device subscription should be a deliberate secondary action.
- A QR component exists, but there is no presentation-ready label sheet that combines an ESL code, product, shelf, task meaning, and print layout.
- The legacy UI contains many 7–12px labels and repeated technical captions. This makes the mobile demo dense and visually noisy.
- The source brief defines two product prototypes (Staff Mobile App and Customer Kiosk), while the functional requirements distinguish Staff and Manager behavior. The current Admin capability is also actively required by the demo. These are different concepts: product experiences are not the same as authorization roles.

## Goals

1. Allow an Admin to move shelves on touch and pointer devices, with a reliable tap fallback.
2. Make the notification bell useful even when push infrastructure is unavailable.
3. Keep service workers usable on localhost without letting development caching interfere with hot reload.
4. Provide a public, data-backed `/demo/esl-labels` page suitable for scanning and A4 printing.
5. Improve reading size and remove duplicate/technical chrome in the main demo flows.
6. Preserve the three functional roles while making the demo entry points match the two-product brief.
7. Cover the new behavior with focused tests before implementation and mobile browser verification afterward.

## Non-goals

- Replacing the current authentication model or rewriting role-based API authorization.
- Building a production label-design editor or print queue.
- Introducing Redis, a queue broker, or another infrastructure dependency.
- Guaranteeing delivery when browser push credentials or external push services are absent.
- Redesigning every screen from scratch.

## Selected Approach

Use one cohesive polish pass instead of isolated patches:

- Replace mobile-incompatible map drag behavior with Pointer Events and tap-to-place.
- Separate in-app notifications from optional device push registration.
- Register the service worker in supported local environments, but bypass its cache on localhost.
- Generate the ESL label page on the server from current database records and render deterministic task badges.
- Apply scoped typography and chrome cleanup to demo-critical screens.
- Keep Staff, Manager, and Admin as functional roles; reduce role confusion through navigation, labels, and default destinations.

### Alternatives Considered

1. **Minimal patches only.** Add touch handlers, suppress the toast, and hard-code labels. This is fast but leaves an ambiguous bell, incomplete demo data, and duplicated failure paths.
2. **Selected: cohesive behavior and presentation pass.** Solves the root causes and provides an end-to-end demo while preserving the architecture.
3. **Merge roles down to two.** Rejected because requirements explicitly distinguish Staff from Manager, Admin is needed for shelf layout, and merging permissions would change security semantics rather than merely simplify presentation.

## Role Decision

The application retains three authorization roles:

| Role | Primary purpose | Primary demo destination |
| --- | --- | --- |
| Staff | Execute assigned store tasks | `/staff` |
| Manager | Monitor the store team and all relevant tasks | `/staff` in oversight mode |
| Admin | Configure stores, shelves, ESLs, and system data | `/admin` |

The landing page presents two primary experiences: **Ứng dụng nhân viên** and **Kiosk khách hàng**. Admin becomes a smaller **Backoffice quản trị** entry, not a third equal product card. Login labels are localized and include one-line role descriptions. Direct access remains subject to existing server-side authorization.

Manager oversight already exists in the Staff app and remains read-only for task execution. This pass changes its primary login destination and presentation only; it does not create a new oversight product or change task permissions.

## Detailed Design

### 1. Mobile Admin Shelf Map

Extract the map behavior into a focused component if this reduces the size and test surface of `AdminApp`.

- Use Pointer Events for mouse, pen, and touch.
- On pointer down, capture the pointer and record the shelf and origin.
- Start visual dragging only after a small movement threshold to avoid interpreting normal taps as drags.
- While dragging, render a selected/dragging state and calculate the target cell from the map bounding rectangle.
- On pointer up, snap to a valid cell and persist once through the existing shelf update endpoint.
- A target is valid only when the shelf rectangle remains fully inside the store grid and does not overlap another shelf rectangle. Occupied targets are rejected; shelves are never silently replaced or swapped. Apply the same validation in the update API so alternate clients cannot persist an invalid layout.
- Set `touch-action: none` only on draggable shelf elements, not the whole page, so normal page scrolling still works.
- Provide a tap fallback: tapping a shelf selects it; tapping a target cell moves it. A second tap or Escape cancels selection.
- Do not write when the target is unchanged or invalid.
- Disable repeat moves while a shelf update is pending and show a short inline Vietnamese status. Revert the local visual position if persistence fails.
- Preserve the desktop workflow and keyboard focusability. Selected shelves and target cells expose accessible state/instructions.

### 2. Notifications, Service Worker, and Push

The notification bell opens a shadcn dialog/sheet containing:

- recent in-app notifications already available to the user;
- unread/read state and an empty state;
- a compact device notification status;
- an explicit **Bật thông báo trên thiết bị** action when setup is possible;
- inline guidance when permission is denied, the browser lacks support, the service worker cannot initialize, or backend push credentials are not configured.

Opening the bell never requests browser permission and never waits for a service worker. Infrastructure limitations are normal states in the panel, not generic destructive toasts.

Opening the panel does not implicitly mark notifications as read. The panel includes an explicit **Đánh dấu tất cả đã đọc** action for currently displayed unread notifications. That action updates only the authenticated user's notifications for the selected store, refreshes the unread badge optimistically, and restores it with inline feedback if persistence fails.

Create a shared service-worker helper that:

- detects support and secure-context eligibility;
- reuses an existing registration or registers `/sw.js`;
- returns a structured result instead of relying on an unbounded `ready` wait;
- is used by both the root provider and the explicit push-subscription flow;
- avoids duplicate registrations and duplicate subscription requests.

`public/sw.js` retains push and background-sync handlers in all supported environments. On localhost/127.0.0.1 it does not populate or serve the production application cache, preventing stale development bundles and HMR conflicts. Production cache behavior remains unchanged.

Expose a non-secret backend readiness response from the push subscriptions route (or a narrowly scoped status route). It reports only capabilities such as whether required VAPID configuration is present. It never returns keys other than the already-public VAPID key and never claims that an external delivery provider is healthy without actually checking it.

Push setup flow:

1. User opens the bell and chooses to enable device notifications.
2. Frontend verifies browser support and backend configuration.
3. Frontend ensures a service-worker registration.
4. Frontend requests permission.
5. Frontend subscribes and stores the subscription.
6. The panel shows success or an actionable inline state.

Success may use a small success toast. Expected unavailable/denied/misconfigured states do not emit alarming toasts or raw technical errors.

### 3. Printable ESL Label Demo

Add a public server-rendered page at `/demo/esl-labels` backed by current database data.

Each card contains:

- a large, high-contrast QR code;
- the ESL code as large text;
- product name;
- shelf/location name and store context;
- zero or more task badges: `RESTOCK`, `FEFO`, `QUARANTINE`;
- the neutral label **Không có nhiệm vụ** when no active matching task exists.

The QR payload is the raw ESL code (for example `ESL-NT-Q5-L-02`), matching the current Staff scanner and `/api/esl/[code]` lookup contract. Scanning it from the Staff flow opens the current ESL lookup; the public label itself does not encode a privileged URL or bypass authentication.

Task matching uses `storeId + shelfId + productId` and includes exactly `OPEN`, `IN_PROGRESS`, and `BLOCKED`. Each badge is the matching task `type` (`RESTOCK`, `FEFO`, or `QUARANTINE`). When multiple task types match, show each distinct type in the deterministic order RESTOCK, FEFO, QUARANTINE rather than discarding information.

The screen view provides a title, a compact store filter when multiple stores exist, a label count, and an **In A4** button. The print stylesheet:

- uses A4 with approximately 10mm margins;
- hides navigation and screen-only controls;
- lays out two columns and targets four cards per page;
- prevents a card from splitting across pages;
- keeps the QR approximately 55–60mm and readable in grayscale;
- preserves the code/product/shelf hierarchy at print size.

If there are no ESL assignments, show a useful empty state explaining which Admin data must be added. QR generation failures are isolated per card and do not crash the whole sheet.

### 4. UI Cleanup and Typography

Apply a scoped pass to landing, login, Staff, Admin, notification panel, and ESL label demo:

- interactive/body text targets at least 14px on normal screens and 13–14px on narrow screens;
- secondary metadata targets at least 11–12px;
- primary touch targets remain at least 44px where layout permits;
- remove duplicate technical captions such as `LIVE DATA`, `SYSTEM OF RECORD`, and repeated section labels when a nearby heading already communicates the same information;
- increase key page and section headings consistently;
- keep dense map and kiosk annotations compact only where spatial constraints genuinely require it;
- retain color contrast and visible focus states.

This is not a global font multiplier: individual legacy selectors are normalized to avoid overflow and preserve kiosk/map geometry.

### 5. Error and Loading Semantics

- User-action failures that prevent saving remain visible and actionable.
- Optional capability failures (push unsupported, worker unavailable, backend not configured) are rendered as neutral/warning inline states.
- No raw stack traces, worker lifecycle messages, or backend implementation details are shown to users.
- Pending map moves, push setup, label loading/filtering, and existing Manager integrations expose a loading state and prevent duplicate actions.

## Data and Component Boundaries

- `AdminApp` owns page-level data; a map editor component owns pointer/tap interaction and emits one requested shelf move.
- A service-worker utility owns registration and support detection.
- The Staff notification panel owns in-app notification display and explicit push setup UI; network functions return structured outcomes.
- A server-side ESL-label query/mapper owns store/shelf/product/task joins and deterministic badge mapping.
- A small client toolbar owns store filtering and `window.print`; label content remains server-renderable and printable without client-only data fetching.
- Role authorization continues to be enforced by existing server APIs and route guards. Presentation changes do not broaden permissions.

## Test Strategy

Implementation follows test-driven development.

### Unit/component tests

- pointer drag snaps to the intended cell and persists once;
- tap-select/tap-place works and unchanged/invalid moves do not write;
- failed moves restore state and show inline feedback;
- notification bell opens the panel without requesting permission;
- unsupported, denied, worker-failed, and backend-unconfigured states render inline;
- explicit push setup uses an existing or newly registered worker and stores one subscription;
- local service-worker behavior bypasses application caching;
- ESL task matching filters statuses, deduplicates types, orders badges, and handles no-task data;
- role selection routes Staff/Manager/Admin to their intended primary destinations.

### Browser tests

- 390px mobile Admin can drag a shelf and can use tap-to-place;
- mobile Staff/Manager can open the ESL tab and notification panel without redirect or worker error;
- “ESL tab” means the existing **Quét ESL** scanner surface. The printable demo page is a separate public presentation route and is not added to Staff/Manager navigation.
- localhost obtains a service-worker registration without stale-cache behavior;
- `/demo/esl-labels` renders scannable labels, store filter, and print controls;
- 320px, 390px, and tablet-width key screens have no horizontal overflow and maintain useful text/tap sizes.

### Verification

- run focused tests after each task;
- run the full test suite and production build;
- perform mobile viewport smoke tests for all five feedback areas;
- inspect the print preview or print media rendering for A4 page breaks and QR dimensions.

## Acceptance Criteria

- An Admin can reposition a shelf on a mobile viewport through drag or tap-to-place, and the new position persists after reload.
- Clicking the bell always opens a usable panel. It does not immediately request permission or show a generic worker error.
- Local development can register the worker for push/sync while bypassing production asset caching.
- Missing push backend configuration is communicated inline without exposing secrets or breaking in-app notifications.
- `/demo/esl-labels` displays real ESL assignments with large QR/code/product/shelf/task meaning and prints cleanly on A4.
- Main demo screens use visibly larger, consistent type and fewer duplicate technical labels without introducing overflow.
- The landing page emphasizes exactly two product experiences; Staff, Manager, and Admin permissions remain distinct and correct.
- All new focused tests, the existing suite, and the production build pass.

## Risks and Mitigations

- **Pointer gestures conflict with scrolling:** limit `touch-action: none` to shelf handles and use a movement threshold plus tap fallback.
- **Service-worker changes cause stale local bundles:** bypass all application cache reads/writes on local hostnames and verify HMR/local reload behavior.
- **Print layout varies by browser:** use physical CSS units, `break-inside: avoid`, and verify Chromium print media at A4.
- **Task-to-label matching is ambiguous:** use the explicit store/shelf/product tuple and display all distinct active task types.
- **Role cleanup accidentally changes permissions:** limit changes to labels, landing hierarchy, and default destinations; retain API and route authorization tests.
