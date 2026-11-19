# Kiosk Product List Compact Layout Design

## Intent

Make the `/kiosk` product-results view feel denser and visually aligned on phones and tablets without changing search, product, stock, or navigation behavior.

## Goals

- Keep the category and stock badge on one top row, with the product name visually close beneath it.
- Use a compact 44px back icon to the left of the results title block, where mobile users expect page navigation.
- Set the main kiosk content padding to 20px at the top and bottom.
- Preserve the existing 20px product-card padding, readable stock colors, and zero horizontal overflow.

## Non-goals

- No changes to product data, search requests, availability labels, card click behavior, or detail modal behavior.
- No redesign of the kiosk header, category grid, or product-detail screen.

## Approaches

1. **Selected — back icon to the left of the title block.** This keeps navigation adjacent to the page identity, removes the visually detached right-side control, and leaves the title copy its own stable column.
2. **Rejected — keep the text button at the top-right.** Aligning it to the top improves the current position but continues to make the header feel split on narrow screens.
3. **Rejected — standalone back row above the heading.** This is familiar but adds vertical height, which conflicts with the requested denser layout.

## Layout Contract

- `.kiosk-main` has exactly `20px` top and bottom padding.
- `.kiosk-results-back` is a 44px icon button placed before `.kiosk-results-copy`.
- The stock badge and category share the same top edge.
- The category-to-product-name visual gap is no more than `6px`.
- The page has no horizontal overflow at 390px and 768px widths.
