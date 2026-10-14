import { Route } from 'reicon-react';
import { cn } from '@/components/beui/lib/utils';

export function Logo({ large = false }: { large?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 text-foreground">
      <span
        className={cn(
          'flex items-center justify-center bg-primary text-white',
          large ? 'size-9 rounded-[10px]' : 'size-7 rounded-lg',
        )}
      >
        <Route size={large ? 20 : 16} aria-hidden />
      </span>
      <span
        className={cn(
          'font-semibold tracking-[-0.025em]',
          large ? 'text-[22px]' : 'text-[17px]',
        )}
      >
        joinpath<span className="text-primary">.</span>
      </span>
    </span>
  );
}
