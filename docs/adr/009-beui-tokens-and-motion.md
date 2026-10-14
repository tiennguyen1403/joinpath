# ADR 009: Design tokens and motion from beUI, with three deviations

- **Status:** Accepted
- **Date:** 2026-10-14 (design in session S0, code in session M0.3)

## Context

Joinpath needs one visual language across 12 screens without spending the project on inventing one. A home-grown token set was tried first and rejected in review. beUI (beui.dev, MIT) ships a small theme (`theme.css`: neutral surfaces, one blue primary, status hues), Geist type, motion curves and springs (`lib/ease.ts`), and animated React components in a shadcn registry.

Three beUI defaults fail in an admin UI where people scan nav and lists all day:

- White text on beUI's primary `#0285F7` is 3.7:1, below the 4.5:1 that 14px labels need.
- Hover on nav links and rows is `muted/60`, about 1.03:1 against the page, so it is hard to see.
- The current nav item is `muted/70`, hard to tell apart from hover.

## Decision

- **beUI as the base.** `theme.css` is copied unchanged to `apps/web/components/beui/theme.css` and imported by `app/globals.css`. Motion uses `motion/react` with beUI's `lib/ease.ts` springs, always with a reduced-motion branch. Fonts are Geist and Geist Mono through `next/font`.
- **Three deviations, defined in `app/globals.css`:**
  1. `--primary-strong: #0067D1` (5.4:1) behind white text and for links. `#0285F7` stays for focus rings, icons, progress and indicators.
  2. One hover layer for nav links and list rows: `bg-foreground/5`, `bg-foreground/8` when pressed.
  3. The current nav item sits on the primary tint (`bg-primary/10`, about `#E3F0FC`) with `primary-strong` text and a `primary` icon.
- **Status text shades.** Small text on a 10% status tint uses a darker shade of the same hue (`--danger-strong`, `--violet-strong`, `--accent-strong`, and so on), so 11–12px labels pass 4.5:1.
- **No shadows** on cards and other resting surfaces.
- Where a beUI component hard-codes one of these colors with no prop to change it (the hover and active pills of `animated-sidebar`), the class string is edited in place. Each edit is listed in `apps/web/components/beui/README.md`.

## Consequences

- Components take the deviations through their `className` prop where they can, for example `<Button className="bg-primary-strong">`. `tailwind-merge` drops the beUI class that conflicts.
- Reinstalling a beUI component with the shadcn CLI overwrites local edits. The README lists what to re-apply.
- On the sidebar, hovering the current item stacks the 5% hover layer on the tint, so the item looks slightly darker while the pointer is on it. The canvas does not draw that state.

## Alternatives considered

- **Joinpath's own tokens.** Rejected in design review: invented, and harder to defend than a named library.
- **CSS overrides against beUI's internal markup** instead of editing class strings. The pills have no stable hook, so the selectors would break silently on the next beUI update.
