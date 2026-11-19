# Kiosk Product Detail Layout Design

## Intent

Rebalance the product-detail modal so customers can identify the product, follow the existing route, and scan traceability information without repeated guidance or oversized cards.

## Goals

- Keep the store map, legend, and four route steps visually and behaviorally unchanged.
- Present product image, availability, name, price, shelf, and zone as one compact summary.
- Keep every traceability value: supplier, origin, certificate, lot code, expiry date, and markdown percentage when present.
- Remove only duplicated explanatory UI, especially the separate “Đi theo tuyến màu xanh” card.
- Keep the close control and “Tôi đã biết đường” action accessible with at least a 44px touch target.

## Selected Layout

### Desktop and tablet landscape

The modal uses a two-column grid:

- **Left column:** compact product summary at the top, traceability cards below it, and the confirmation action at the bottom.
- **Right column:** the existing route heading, walking time, store map, legend, and four route steps. This section is preserved rather than redesigned.

Moving traceability out of the map column fills the underused product column and prevents the map section from becoming an unnecessarily long mixed-content page.

### Phone and tablet portrait

The modal becomes a single vertical flow:

1. Compact product summary and one-line location.
2. Existing map, legend, and four route steps.
3. Traceability cards.
4. Compact full-width confirmation action.

## Product Summary

- Use a small product image beside the identity copy.
- Show availability, product name, and current price in one hierarchy.
- Show shelf and zone in one compact location row with the map-pin icon.
- Preserve original price and markdown badge when the current price is discounted.
- Remove the uppercase “Vị trí sản phẩm” label card and the separate green guidance card; their values or instruction already appear in the summary and map.

## Traceability

- Render one card per lot.
- Supplier spans the full card width.
- Origin and certificate share a row.
- Lot code and expiry date share a row.
- Markdown percentage appears as a compact badge only when present.
- Use concise labels and values instead of two prose columns.

## Constraints

- Implement the new layout only with Tailwind utility classes in JSX; do not add or modify rules in `globals.css` or create component CSS.
- Use Tailwind important modifiers where the existing unlayered legacy modal CSS would otherwise win the cascade.
- Do not change product-detail loading, retry, caching, closing, or session-reset behavior.
- Do not change map geometry, route calculation, route steps, legend, or map copy.
- Preserve all existing product and traceability values returned by the API.
- Support multiple traceability lots without horizontal overflow at 390px, 768px, and desktop widths.

## Approaches Considered

1. **Selected — compact product summary plus structured traceability grid.** Keeps every value visible while shortening the page and improving hierarchy.
2. **Rejected — multiple independent cards.** Easier to isolate visually but retains excessive height and fragmentation.
3. **Rejected — collapsed traceability accordion.** Shortest initial screen, but hides information and adds an unnecessary interaction.
