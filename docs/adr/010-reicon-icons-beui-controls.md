# ADR 010: Icons from reicon, controls from beUI

- **Status:** Accepted
- **Date:** 2026-10-14 (design in session S0, code in session M0.3)

## Context

Hand-drawn controls and browser-default widgets (date pickers, selects, validation bubbles) look different in every browser and cost time to make accessible. beUI's registry (`https://beui.dev/r`) already has the controls Joinpath needs: sidebar, input, select, tabs, badges, alert, todo list, approval card, drawer and more. Its components import icons from `lucide-react`, while the design canvas uses reicon's Outline set (24 grid, 1.5px stroke, `currentColor`).

## Decision

- **Controls:** use the beUI component wherever one exists (map in PLAN §10.1). Build only what beUI lacks: progress bar, initials avatar, wizard steps, textarea and the dependency graph canvas.
- **Install:** the shadcn CLI adds registry items into one vendored folder, `apps/web/components/beui/`, through the aliases in `apps/web/components.json`. Files stay as installed. Prettier and oxlint skip the folder; TypeScript still checks it. beUI's MIT notice is in the folder's `LICENSE`.
- **Icons:** `reicon-react` 1.2.6, pinned. In beUI files, the `lucide-react` import line is changed to the matching reicon icons, and `lucide-react` is not a dependency.
- **Forms** use `noValidate`, and the app shows its own field errors, so no browser validation bubble ever appears.

## Consequences

- Updating a beUI component means re-running the CLI, then re-applying the icon line and any ADR 009 edit listed in `components/beui/README.md`.
- Registry slugs differ from component names: the button is `button-base`, and there is no `image-viewer` (PLAN §10.1 notes the alternative for M2.4).
- beUI's sidebar renders plain `<a href>`. The app shell routes clicks on nav links through the Next router, so pages change without a full reload and the shell's motion keeps running.

## Alternatives considered

- **shadcn/ui with `lucide-react`.** A good default, but not the look the canvas was designed in, and it has less motion.
- **Hand-made controls.** More code to own and to make accessible, for no visual gain.
