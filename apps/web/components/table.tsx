import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/components/beui/lib/utils';

// The canvas's table, built on tokens (PLAN §10.1): beUI's `table` is a virtualized grid of
// fixed height and row height, while these tables are short and their rows vary.

/** Scrolls sideways inside its border when the screen is narrower than the table. */
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
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
      <tr className="bg-card text-left text-xs leading-5 text-muted-foreground">
        {children}
      </tr>
    </thead>
  );
}

export function Th({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn('px-4 py-2.5 font-medium', className)}
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
