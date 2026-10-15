# beUI

Components from [beUI](https://beui.dev) (MIT, see `LICENSE`), installed with the shadcn CLI from the registry `https://beui.dev/r` using the aliases in `apps/web/components.json`:

```sh
cd apps/web && pnpm dlx shadcn@4.21.5 add https://beui.dev/r/<slug>.json
```

`theme.css` is `https://beui.dev/theme.css`. Files stay as installed, except:

- `alert.tsx`, `animated-badge.tsx`, `breadcrumb.tsx`, `animated-sidebar.tsx`: the `lucide-react` import line now imports the `reicon-react` equivalents (ADR 010).
- `animated-sidebar.tsx`: the hover pill is `bg-foreground/5` (was `bg-muted/70`), the active pill `bg-primary/10` (was `bg-muted`) and active text `text-primary-strong` (was `text-foreground`), the sidebar part of ADR 009.

Prettier and oxlint skip this folder; TypeScript still checks it. Joinpath's other token changes live in `app/globals.css` (ADR 009).
