# Staff toast top position and close action design

**Date:** 2026-11-17

## Context

The admin application already uses Sonner at the top-right with a close button. The staff application still renders its custom toast stack at the bottom-right and does not provide a manual dismissal action.

## Chosen behavior

- Move the staff toast stack from the bottom-right to the top-right.
- Keep the current fixed width, visual success/error variants, z-index, and 4.2-second automatic dismissal.
- Add an `X` button inside each staff toast.
- The button uses `aria-label="Đóng thông báo"`, meets the existing 44px touch-target convention, and immediately removes the toast.
- Preserve the existing toast messages and notification triggers.
- Admin toast behavior is unchanged because it already meets both requirements.

## Alternatives considered

- Top-left: rejected because it is less consistent with the admin application and more likely to cover page titles/navigation.
- Replace the staff toast with Sonner: rejected as unnecessary scope expansion for a position and close-action adjustment.

## Test strategy

- Extend the real StaffApp interaction test to assert that a generated toast exposes `Đóng thông báo` and disappears when clicked.
- Load the real stylesheet in the test and assert the rendered stack is fixed at the top-right with no bottom offset.
- Retain existing message, error, offline, and automatic-dismiss behavior tests.
