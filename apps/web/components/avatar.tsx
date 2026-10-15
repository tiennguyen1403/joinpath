import type { Role } from '@joinpath/core';
import { cn } from '@/components/beui/lib/utils';

// Initials on a tint, as on the canvas (beUI has no avatar). Someone with a role wears its
// tint; a new hire gets one of three, picked by id so it stays the same on every screen.
export const ROLE_TINT: Record<Role, string> = {
  HR: 'bg-violet/10 text-violet-strong',
  IT: 'bg-foreground/8 text-foreground',
  MEMBER: 'bg-accent/10 text-accent-strong',
};
const NEW_HIRE_TINTS = [
  'bg-primary/10 text-primary-strong',
  'bg-warning/10 text-warning-strong',
  'bg-success/10 text-success-strong',
];
// Employee ids are UUIDv7, whose last digits are random.
export const newHireTint = (id: string) =>
  NEW_HIRE_TINTS[parseInt(id.slice(-4), 16) % NEW_HIRE_TINTS.length];

/** The tint of anyone: their role's, or a new hire's when they have no account yet. */
export const tintOf = (id: string, role: Role | undefined) =>
  role ? ROLE_TINT[role] : newHireTint(id);

const initials = (name: string) =>
  name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** Size it with `className`, along with a tint. */
export function Avatar({
  name,
  className,
}: {
  name: string;
  className: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
