'use client';

import type { Me, Role } from '@joinpath/core';
import { usePathname, useRouter } from 'next/navigation';
import type { MouseEvent, ReactNode } from 'react';
import { Logout, Menu } from 'reicon-react';
import { cn } from '@/components/beui/lib/utils';
import {
  AnimatedSidebar,
  AnimatedSidebarContent,
  AnimatedSidebarFooter,
  AnimatedSidebarGroup,
  AnimatedSidebarGroupLabel,
  AnimatedSidebarHeader,
  AnimatedSidebarInset,
  AnimatedSidebarMenu,
  AnimatedSidebarMenuButton,
  AnimatedSidebarMenuItem,
  AnimatedSidebarProvider,
  AnimatedSidebarTrigger,
} from '@/components/beui/motion/animated-sidebar';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/beui/motion/breadcrumb';
import { Button } from '@/components/beui/motion/button/base';
import { Logo } from '@/components/logo';
import { findNavItem, NAV, type NavItem } from '@/lib/nav';

// Initials avatar tint per role, as on the canvas (beUI has no avatar).
const AVATAR: Record<Role, string> = {
  HR: 'bg-violet/10 text-violet-strong',
  IT: 'bg-foreground/8 text-foreground',
  MEMBER: 'bg-accent/10 text-accent-strong',
};

const initials = (name: string) =>
  name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const current = findNavItem(me.role, pathname);

  // beUI's sidebar renders plain <a href>. Nav links go through the Next router instead,
  // so the shell and its sliding active pill stay mounted between pages.
  function followNav(event: MouseEvent) {
    const href = (event.target as Element).closest('a')?.getAttribute('href');
    if (
      !href ||
      !findNavItem(me.role, href) ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    router.push(href);
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  const group = (label: string, items: NavItem[]) => (
    <AnimatedSidebarGroup>
      <AnimatedSidebarGroupLabel>{label}</AnimatedSidebarGroupLabel>
      <AnimatedSidebarMenu>
        {items.map(({ href, label, icon: Icon }) => (
          <AnimatedSidebarMenuItem key={href}>
            <AnimatedSidebarMenuButton
              href={href}
              isActive={href === pathname}
              icon={
                <Icon
                  className={cn('size-4', href === pathname && 'text-primary')}
                />
              }
              // Pressed: 3% over the 5% hover pill comes to the 8% of ADR 009.
              className="active:bg-foreground/[0.03]"
            >
              {label}
            </AnimatedSidebarMenuButton>
          </AnimatedSidebarMenuItem>
        ))}
      </AnimatedSidebarMenu>
    </AnimatedSidebarGroup>
  );

  return (
    <AnimatedSidebarProvider onClickCapture={followNav}>
      <AnimatedSidebar collapsible="none" ariaLabel="Main navigation">
        <AnimatedSidebarHeader className="h-16 justify-center border-b border-border px-5">
          <Logo />
        </AnimatedSidebarHeader>
        <AnimatedSidebarContent>
          {group(me.organization.name, NAV[me.role].org)}
          {group('You', NAV[me.role].you)}
        </AnimatedSidebarContent>
        <AnimatedSidebarFooter>
          <div className="flex items-center gap-2.5 p-1">
            <span
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                AVATAR[me.role],
              )}
            >
              {initials(me.employee.fullName)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col text-sm">
              <span className="truncate font-medium">
                {me.employee.fullName}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {me.employee.jobTitle}
              </span>
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={signOut}
              className="hover:bg-foreground/5 active:bg-foreground/8"
            >
              <Logout className="size-4" />
            </Button>
          </div>
        </AnimatedSidebarFooter>
      </AnimatedSidebar>
      <AnimatedSidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4 md:px-8">
          <AnimatedSidebarTrigger className="-ml-2 hover:bg-foreground/5 md:hidden">
            <Menu className="size-5" />
          </AnimatedSidebarTrigger>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem key="org">
                <span className="px-2 text-muted-foreground">
                  {me.organization.name}
                </span>
              </BreadcrumbItem>
              {current && (
                <BreadcrumbItem key={current.href}>
                  <BreadcrumbSeparator />
                  <BreadcrumbPage>{current.label}</BreadcrumbPage>
                </BreadcrumbItem>
              )}
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <div className="px-4 pt-8 pb-16 md:px-8">
          <div className="mx-auto flex max-w-290 flex-col gap-6">
            {children}
          </div>
        </div>
      </AnimatedSidebarInset>
    </AnimatedSidebarProvider>
  );
}
