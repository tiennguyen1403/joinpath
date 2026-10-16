'use client';

import type { Me } from '@joinpath/core';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  type Dispatch,
  type MouseEvent,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useState,
} from 'react';
import { Logout, Menu } from 'reicon-react';
import { Avatar, ROLE_TINT } from '@/components/avatar';
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
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/beui/motion/breadcrumb';
import { Button } from '@/components/beui/motion/button/base';
import { DemoIsland } from '@/components/demo-island';
import { Logo } from '@/components/logo';
import { notificationsQuery } from '@/components/notifications';
import { QueryProvider } from '@/components/query-provider';
import { findNavItem, NAV, type NavItem } from '@/lib/nav';
import { myTasksQuery } from './tasks/my-tasks';

type Crumb = { label: string };
const SetCrumb = createContext<Dispatch<SetStateAction<Crumb | null>>>(
  () => {},
);

/** Names a page below a nav item in the breadcrumb, as in "Onboardings › An Vo". */
export function usePageCrumb(label: string | undefined) {
  const setCrumb = useContext(SetCrumb);
  useEffect(() => {
    if (label === undefined) return;
    const crumb = { label };
    setCrumb(crumb);
    // Clears only its own: the next page may already have set one.
    return () => setCrumb((current) => (current === crumb ? null : current));
  }, [label, setCrumb]);
}

// Beside My tasks: how many of mine are overdue, in red, else how many are open (the canvas).
function TasksToDo() {
  const { data } = useQuery(myTasksQuery);
  const overdue = data?.tasks.filter((task) => task.overdue).length;
  if (overdue) {
    return (
      <span className="text-danger-strong tabular-nums">{overdue} overdue</span>
    );
  }
  const count = data?.tasks.filter(
    ({ availability }) => availability === 'READY',
  ).length;
  return count ? <span className="tabular-nums">{count}</span> : null;
}

// Beside Notifications: how many are unread.
function Unread() {
  const { data } = useQuery(notificationsQuery);
  return data?.unread ? (
    <span className="tabular-nums">
      {data.unread}
      <span className="sr-only"> unread</span>
    </span>
  ) : null;
}

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const current = findNavItem(me.role, pathname);
  // A page below a nav item keeps that item current, as the canvas draws New onboarding.
  const section =
    current ??
    [...NAV[me.role].org, ...NAV[me.role].you].find((item) =>
      pathname.startsWith(`${item.href}/`),
    );
  const [crumb, setCrumb] = useState<Crumb | null>(null);

  // beUI renders plain <a href> (sidebar, button links). Links within the app go through the
  // Next router instead, so the shell and its sliding active pill stay mounted between pages.
  function followLink(event: MouseEvent) {
    const anchor = (event.target as Element).closest('a');
    const href = anchor?.getAttribute('href');
    if (
      !anchor ||
      !href?.startsWith('/') ||
      href.startsWith('//') ||
      href.startsWith('/api/') ||
      anchor.target ||
      anchor.hasAttribute('download') ||
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
              isActive={href === section?.href}
              icon={
                <Icon
                  className={cn(
                    'size-4',
                    href === section?.href && 'text-primary',
                  )}
                />
              }
              badge={
                href === '/tasks' ? (
                  <TasksToDo />
                ) : href === '/notifications' ? (
                  <Unread />
                ) : undefined
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
    <QueryProvider>
      <AnimatedSidebarProvider onClickCapture={followLink}>
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
              <Avatar
                name={me.employee.fullName}
                className={cn('size-9', ROLE_TINT[me.role])}
              />
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
          {me.organization.demo && (
            <DemoIsland me={me} demo={me.organization.demo} />
          )}
          <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4 md:px-8">
            <AnimatedSidebarTrigger className="-ml-2 hover:bg-foreground/5 md:hidden">
              <Menu className="size-5" />
            </AnimatedSidebarTrigger>
            <Breadcrumb>
              {/* A nav page sits under the org; a page below one, under its nav item. */}
              {current || !section ? (
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
              ) : (
                <BreadcrumbList>
                  <BreadcrumbItem key={section.href}>
                    <BreadcrumbLink
                      href={section.href}
                      className="font-normal hover:bg-foreground/5 focus-visible:ring-primary"
                    >
                      {section.label}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  {crumb && (
                    <BreadcrumbItem key="page">
                      <BreadcrumbSeparator />
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    </BreadcrumbItem>
                  )}
                </BreadcrumbList>
              )}
            </Breadcrumb>
          </header>
          <div className="px-4 pt-8 pb-16 md:px-8">
            <div className="mx-auto flex max-w-290 flex-col gap-6">
              <SetCrumb.Provider value={setCrumb}>{children}</SetCrumb.Provider>
            </div>
          </div>
        </AnimatedSidebarInset>
      </AnimatedSidebarProvider>
    </QueryProvider>
  );
}
