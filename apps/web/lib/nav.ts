import type { Role } from '@joinpath/core';
import type { ComponentType } from 'react';
import {
  Bell,
  Category,
  Layers,
  ListCheck,
  UserAdd,
  Users,
} from 'reicon-react';

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const tasks: NavItem = { href: '/tasks', label: 'My tasks', icon: ListCheck };
const notifications: NavItem = {
  href: '/notifications',
  label: 'Notifications',
  icon: Bell,
};
const myOnboardings: NavItem = {
  href: '/onboardings',
  label: "Onboardings I'm in",
  icon: UserAdd,
};

// The sidebar of each role, as drawn on the canvas: the org's pages, then the user's own.
// Managers (MEMBER) see what IT sees; the new hire's portal comes with M2.4.
export const NAV: Record<Role, { org: NavItem[]; you: NavItem[] }> = {
  HR: {
    org: [
      { href: '/dashboard', label: 'Dashboard', icon: Category },
      { href: '/onboardings', label: 'Onboardings', icon: UserAdd },
      { href: '/templates', label: 'Templates', icon: Layers },
      { href: '/employees', label: 'Employees', icon: Users },
    ],
    you: [tasks, notifications],
  },
  IT: { org: [tasks, myOnboardings], you: [notifications] },
  MEMBER: { org: [tasks, myOnboardings], you: [notifications] },
};

export const homeFor = (role: Role) => NAV[role].org[0].href;

export const findNavItem = (role: Role, pathname: string) =>
  [...NAV[role].org, ...NAV[role].you].find((item) => item.href === pathname);
