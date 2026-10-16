# beUI

Components from [beUI](https://beui.dev) (MIT, see `LICENSE`), installed with the shadcn CLI from the registry `https://beui.dev/r` using the aliases in `apps/web/components.json`:

```sh
cd apps/web && pnpm dlx shadcn@4.21.5 add https://beui.dev/r/<slug>.json
```

`theme.css` is `https://beui.dev/theme.css`. Files stay as installed, except:

- `alert.tsx`, `animated-badge.tsx`, `animated-toast-stack.tsx`, `breadcrumb.tsx`, `animated-sidebar.tsx`, `center-morph-modal.tsx`, `context-menu.tsx`, `date-range-picker.tsx`, `file-upload.tsx`, `morphing-lightbox.tsx`, `select.tsx`, `tabs.tsx`, `agents/todo-list.tsx`, `agents/approval-card/index.tsx`: the `lucide-react` import line now imports the `reicon-react` equivalents (ADR 010). reicon has no audio, video or spreadsheet file icon, so `file-upload` shows the plain file icon for those.
- `animated-sidebar.tsx`: the hover pill is `bg-foreground/5` (was `bg-muted/70`), the active pill `bg-primary/10` (was `bg-muted`) and active text `text-primary-strong` (was `text-foreground`), the sidebar part of ADR 009.
- `animated-toast-stack.tsx`: the success icon sits on `bg-success/10` in `text-success-strong` (was emerald), the error icon in `text-danger-strong` (was `text-destructive`), so both kinds keep the tokens' contrast in one stack.
- `date-range-picker/types.ts` and `use-date-range-picker.ts`: two props marked `Joinpath:` (ADR 010). `single` makes a click pick one day, announced as "<date> selected." rather than as the start of a range; `today` marks the org's business date instead of the browser's.
- `agents/todo-list.tsx`: edits marked `Joinpath:` (ADR 010). An item's `meta` is a second line under its title, and each list is named by its `title` rather than "Agent task list". An item's `body` follows its row, which is then tinted `bg-muted`; the row sits in a `div` for it. A cancelled item's mark stays muted (was rose).
- `context-menu.tsx`: edits marked `Joinpath:` (ADR 010). `ContextMenuTrigger` takes `openOnClick`: a click opens the menu below the trigger, its right edge at the trigger's (`openAt` takes an `align`, and an `"end"` menu hangs left of its point), and a second click closes it. Enter or Space opens it as the keyboard does, focus on the first item.
- `center-morph-modal.tsx`: edit marked `Joinpath:` (ADR 010). Esc does nothing while a `select` inside it is open, so the select closes first. Opened from somewhere other than its own trigger, it gives focus back to nothing: the caller does (the onboarding page refocuses the button or ⋯ that opened it). Its `onOpenChange` must stay the same function while it is open, since the modal re-runs its focus effect whenever it changes.
- `file-upload.tsx`: the success and error tones are `text-success-strong` and `text-danger-strong` (were emerald and `text-destructive`). Edits marked `Joinpath:` (ADR 010): an item's `note` follows its kind and size; `queueLabel` names the list, between the dropzone and the list; the progress bar shows only while an upload's progress is known; there is no Remove while a file uploads; `formatBytes` is exported, so the review drawer sizes files the same way.
- `drawer.tsx`: edits marked `Joinpath:` (ADR 010). It renders in a portal under `body` and takes `useModalScope` (`lib/hooks/use-modal-scope.ts`, installed with `morphing-lightbox`): focus moves in, Tab stays inside, Esc closes and focus goes back to the opener, and the page behind is inert and doesn't scroll. Its own Esc listener and scroll lock are gone, so Esc in a lightbox opened over it closes the lightbox only.
- `agents/approval-card/index.tsx`: the status tones are the `*-strong` tokens on 10% tints (were emerald, rose, amber and blue), and `Button` comes from `button/base`. Edits marked `Joinpath:`: `meta` stands where the status badge would ("Revision 2"); Approve is white on `bg-primary-strong` (ADR 009).

The CLI also adds `lucide-react` to `package.json`: take it out again. `approval-card` also brings `button/index.tsx` with the magnetic, metallic and stateful buttons, and `magnetic.tsx`: Joinpath keeps only `button/base.tsx` and `checkbox.tsx`. The CLI asks before it overwrites a file; with no terminal to answer, it stops there and skips the files after it, so compare what it wrote with the registry's file list.

Prettier and oxlint skip this folder; TypeScript still checks it. Joinpath's other token changes live in `app/globals.css` (ADR 009).
