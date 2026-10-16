'use client';

import {
  type Notification as NotificationItem,
  type NotificationKind,
  type Notifications,
  notificationsSchema,
} from '@joinpath/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type RefObject, useRef, useState } from 'react';
import {
  ArrowRight,
  Bell,
  Calendar,
  CalendarEdit,
  CheckRead,
  CloseCircle,
  Clock,
  Flag,
  TickCircle,
  Undo,
  UserAdd,
  UserMinus,
} from 'reicon-react';
import { cn } from '@/components/beui/lib/utils';
import {
  AnimatedToastStack,
  type ToastInput,
  useAnimatedToastStack,
} from '@/components/beui/motion/animated-toast-stack';
import { Button } from '@/components/beui/motion/button/base';
import {
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
} from '@/components/beui/motion/popover-morph';
import { EmptyState } from '@/components/empty-state';
import { Notice } from '@/components/notice';
import { api, ApiError, messageOf } from '@/lib/api';
import { capitalized, formatShortMomentIn, inWords } from '@/lib/format';

/** The signed-in person's newest notifications, and how many wait unread (PLAN §8). */
export const notificationsQuery = {
  queryKey: ['notifications'],
  queryFn: () => api('/notifications', notificationsSchema),
};

// An icon per kind, red only for a request for changes and an overdue task (the M3.2b canvas).
const ICON: Record<NotificationKind, typeof Bell> = {
  ASSIGNED: UserAdd,
  UNASSIGNED: UserMinus,
  READY: ArrowRight,
  APPROVED: TickCircle,
  REJECTED: Undo,
  DUE_CHANGED: CalendarEdit,
  RESCHEDULED: Calendar,
  COMPLETED: Flag,
  CANCELED: CloseCircle,
  DUE_SOON: Clock,
  OVERDUE: Clock,
};
const RED = new Set<NotificationKind>(['REJECTED', 'OVERDUE']);

// Read the moment it is clicked; the refetch after every change settles it (QueryProvider).
// If the API refuses, the row is unread again and no one is told.
function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/notifications/${id}/read`, notificationsSchema, { method: 'POST' }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({
        queryKey: notificationsQuery.queryKey,
      });
      queryClient.setQueryData<Notifications>(
        notificationsQuery.queryKey,
        (old) =>
          old && {
            unread: old.unread - 1,
            notifications: old.notifications.map((note) =>
              note.id === id
                ? { ...note, readAt: new Date().toISOString() }
                : note,
            ),
          },
      );
    },
    onError: () =>
      void queryClient.invalidateQueries({
        queryKey: notificationsQuery.queryKey,
      }),
  });
}

// The button goes once nothing is unread, so the focus it held moves to the list's first row.
function useMarkAllRead(
  showToast: (toast: ToastInput) => void,
  list: RefObject<HTMLElement | null>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api('/notifications/read-all', notificationsSchema, { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.setQueryData(notificationsQuery.queryKey, data);
      list.current?.querySelector<HTMLElement>('a, button')?.focus();
    },
    onError: (error) =>
      showToast({
        status: 'error',
        title: "Couldn't mark them as read",
        description: messageOf(error),
      }),
  });
}

const ROW =
  'flex w-full items-start gap-3 rounded-xl text-left transition-colors outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-primary active:bg-foreground/8';

// A blue dot while unread, the kind's icon, the title, the body and when it came. The time is a
// real moment, never "today": a sandbox's business date may run ahead (PLAN §4.6).
function Row({
  note,
  timeZone,
  compact,
}: {
  note: NotificationItem;
  timeZone: string;
  compact: boolean;
}) {
  const Icon = ICON[note.kind];
  const unread = !note.readAt;
  const time = (
    <time
      dateTime={note.createdAt}
      className="shrink-0 font-mono text-xs text-muted-foreground"
    >
      {formatShortMomentIn(note.createdAt, timeZone)}
    </time>
  );
  return (
    <>
      <span
        aria-hidden
        className={cn(
          'mt-3 size-2 shrink-0 rounded-full',
          unread && 'bg-primary',
        )}
      />
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full',
          RED.has(note.kind)
            ? 'bg-destructive/10 text-danger-strong'
            : 'bg-card text-muted-foreground',
        )}
      >
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* In the narrow panel the time takes a line of its own. */}
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className={unread ? 'font-semibold' : 'text-foreground/80'}>
            {unread && <span className="sr-only">Unread: </span>}
            {note.title}
          </span>
          {!compact && time}
        </span>
        <span className="text-[13px] text-muted-foreground">{note.body}</span>
        {compact && time}
      </span>
    </>
  );
}

function List({
  notes,
  timeZone,
  compact = false,
  onPick,
}: {
  notes: NotificationItem[];
  timeZone: string;
  compact?: boolean;
  onPick: (note: NotificationItem) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5 text-sm">
      {notes.map((note) => (
        <li key={note.id}>
          {compact ? (
            <button
              type="button"
              onClick={() => onPick(note)}
              className={cn(ROW, 'px-3 py-2.5')}
            >
              <Row note={note} timeZone={timeZone} compact />
            </button>
          ) : (
            <Link
              href={note.link}
              onClick={() => onPick(note)}
              className={cn(ROW, 'px-3.5 py-3')}
            >
              <Row note={note} timeZone={timeZone} compact={false} />
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

const loadError = (error: Error, then: string) => (
  <Notice
    variant="destructive"
    title="Couldn't load your notifications"
    text={
      error instanceof ApiError
        ? error.message
        : `Check your connection, ${then}.`
    }
  />
);

/**
 * The Notifications page of the app shell (PLAN §10), newest first. A click reads one and
 * follows its link; Mark all as read shows while anything is unread.
 */
export function NotificationsView({ timeZone }: { timeZone: string }) {
  const { toasts, showToast, dismissToast } = useAnimatedToastStack();
  const { data, error } = useQuery(notificationsQuery);
  const markRead = useMarkRead();
  const list = useRef<HTMLElement>(null);
  const markAll = useMarkAllRead(showToast, list);
  return (
    <div className="flex max-w-190 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">
            Notifications
          </h1>
          {data && data.notifications.length > 0 && (
            <p className="leading-[23px] text-muted-foreground">
              {data.unread
                ? `${capitalized(inWords(data.unread))} unread.`
                : "You're all caught up."}
            </p>
          )}
        </div>
        {data && data.unread > 0 && (
          <Button
            variant="secondary"
            disabled={markAll.isPending}
            onClick={() => markAll.mutate()}
            className="hover:bg-foreground/5 active:bg-foreground/8"
          >
            <CheckRead aria-hidden className="size-4" />
            {markAll.isPending ? 'Marking all as read…' : 'Mark all as read'}
          </Button>
        )}
      </div>
      {error ? (
        loadError(error, 'then reload the page')
      ) : data?.notifications.length === 0 ? (
        <EmptyState
          title="No notifications yet"
          description="When a task opens for you, a document waits on your review or a date moves, you'll hear about it here."
        />
      ) : (
        data && (
          <section
            ref={list}
            aria-label="Notifications, newest first"
            className="rounded-2xl border border-border p-2"
          >
            <List
              notes={data.notifications}
              timeZone={timeZone}
              onPick={(note) => {
                if (!note.readAt) markRead.mutate(note.id);
              }}
            />
          </section>
        )
      )}
      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} fixed />
    </div>
  );
}

/**
 * The portal's bell (PLAN §10): a dot while anything is unread, the list in a popover at every
 * width. A click reads one and closes the list; the new hire's own all point at the portal.
 */
export function NotificationBell({
  timeZone,
  showToast,
}: {
  timeZone: string;
  showToast: (toast: ToastInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const bell = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { data, error } = useQuery(notificationsQuery);
  const markRead = useMarkRead();
  const list = useRef<HTMLDivElement>(null);
  const markAll = useMarkAllRead(showToast, list);
  const unread = data?.unread ?? 0;

  function pick(note: NotificationItem) {
    if (!note.readAt) markRead.mutate(note.id);
    setOpen(false);
    bell.current?.focus();
    if (note.link !== pathname) router.push(note.link);
  }

  return (
    <MorphPopover open={open} onOpenChange={setOpen}>
      <MorphPopoverTrigger>
        <Button
          ref={bell}
          variant="ghost"
          size="icon"
          aria-label={
            unread ? `Notifications, ${unread} unread` : 'Notifications'
          }
          className="relative hover:bg-foreground/5 active:bg-foreground/8 aria-expanded:bg-foreground/8 aria-expanded:text-foreground"
        >
          <Bell aria-hidden className="size-[18px]" />
          {unread > 0 && (
            <span className="absolute top-[5px] right-1.5 size-2 rounded-full bg-destructive ring-2 ring-background" />
          )}
        </Button>
      </MorphPopoverTrigger>
      <MorphPopoverContent
        className="w-[min(380px,calc(100vw-24px))]"
        onOpenAutoFocus={(panel) =>
          panel.querySelector<HTMLElement>('button')?.focus()
        }
      >
        <div className="flex min-h-12 items-center justify-between gap-3 py-2 pr-2 pl-4">
          <h2 className="text-[15px] leading-[21px] font-semibold">
            Notifications
          </h2>
          {unread > 0 && (
            <button
              type="button"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate()}
              className="h-8 rounded-full px-2.5 text-[13px] font-medium text-primary-strong transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary active:bg-foreground/8 disabled:opacity-50"
            >
              {markAll.isPending ? 'Marking all as read…' : 'Mark all as read'}
            </button>
          )}
        </div>
        <div
          ref={list}
          className="scrollbar-hide max-h-115 overflow-y-auto px-2 pb-2"
        >
          {error ? (
            loadError(error, 'then try again')
          ) : data?.notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 rounded-xl bg-card px-5 py-8 text-center">
              <span className="font-semibold">Nothing new yet</span>
              <span className="text-[13px] text-muted-foreground">
                You&apos;ll hear here when a task opens or your documents are
                reviewed.
              </span>
            </div>
          ) : (
            data && (
              <List
                notes={data.notifications}
                timeZone={timeZone}
                compact
                onPick={pick}
              />
            )
          )}
        </div>
      </MorphPopoverContent>
    </MorphPopover>
  );
}
