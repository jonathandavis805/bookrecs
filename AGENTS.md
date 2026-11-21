# Agent Guidelines

## UI/UX Guidelines

- Do not use emojis in the UI
- Use simple SVG icons where applicable
- Keep the interface clean and minimal

## Ownership

- You own this codebase and should take responsibility for its organization and architecture.

## Code quality

- Run `bun run check` before pushing (lint, format, typecheck, dead code). `bun run lint:fix` applies safe fixes. A Lefthook pre-commit hook runs the full check.
- Shared UI lives in `web/src/components/ui/` (`Modal`, `ConfirmDialog`, `Cover`, `Byline`, `Switch`, icons). Reuse these instead of copying markup.
- Styles use the tokens in `:root` of `web/src/index.css`; Stylelint rejects raw colors, radii, font sizes and shadows. No inline styles. Every CSS class must be referenced from TSX (`lint/unused-css.ts`).
- Buttons: bare `<button>` for quiet actions, `.btn-primary` for the main action, `.btn-secondary` for outlined, `.btn-danger` for destructive confirms, `.danger` / `.link` / `.icon-btn` for inline variants, `.btn-sm` to shrink any of them.
- The header switches to its stacked layout when the one-row version actually wraps (`useStackWhenWrapped` in `App.tsx`), not at a fixed width. Don't add width breakpoints for it; tabs and usernames of any length are handled.
- Project-specific Biome rules (no emoji glyphs, no inline styles) are GritQL plugins in `lint/`.
- Backend domain logic lives in `src/core/` (one module per area). Operations that can be refused return a `Result`: `fail` (400), `forbidden` (403) or `notFound` (404); routes answer with `failure(r)` and never inspect error text.
- API behaviour is tested through `handleApi` against an in-memory D1 (`src/test/d1.ts`) in `src/api.test.ts`; add a test there when changing a route.
- `src/mcp.ts` is a client of the HTTP API, authenticated with a user's API token; add tools by mapping them onto routes, not by calling core.
