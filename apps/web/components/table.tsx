import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/components/beui/lib/utils';

// The canvas's table, built on tokens (PLAN §10.1): beUI's `table` is a virtualized grid of
// fixed height and row height, while these tables are short and their rows vary.

// Without overflow the border no longer rounds the header's corners: its end cells do.
const HEADER_CORNERS =
  '[&_th:first-child]:[clip-path:inset(0_round_15px_0_0_0)] [&_th:last-child]:[clip-path:inset(0_round_0_15px_0_0)]';

/**
 * Scrolls sideways inside its border when the screen is narrower than the table.
 * `scroll={false}` lets a select's panel in a cell spill past the border instead of being
 * cut off; the table then has to fit its container.
 */
export function Table({
  className,
  scroll = true,
  ...props
}: ComponentProps<'table'> & { scroll?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border',
        scroll ? 'overflow-x-auto' : HEADER_CORNERS,
      )}
    >
      <table
        className={cn('w-full border-collapse text-sm', className)}
        {...props}
      />
    </div>
  );
}

/** The header row: give it Th cells. */
export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="text-left text-xs leading-5 text-muted-foreground">
        {children}
      </tr>
    </thead>
  );
}

export function Th({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn('bg-card px-4 py-2.5 font-medium', className)}
      {...props}
    />
  );
}

/** Rows hover on the list-row layer (ADR 009). */
export function Tr({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-t border-foreground/4 transition-colors hover:bg-foreground/5',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('px-4 py-3', className)} {...props} />;
}
