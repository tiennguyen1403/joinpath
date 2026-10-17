'use client';

import {
  addDays,
  blockersOf,
  type Dashboard as DashboardData,
  dashboardSchema,
  type OnboardingStatus,
  onboardingStatusSchema,
  onboardingSummarySchema,
} from '@joinpath/core';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import {
  ArchiveBox,
  ArrowRight,
  Check,
  Clock,
  Link as Chain,
  Lock,
  Timer,
  UserAdd,
} from 'reicon-react';
import { EventText, formatEventTime } from '@/components/activity';
import { cn } from '@/components/beui/lib/utils';
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from '@/components/beui/motion/alert';
import { AnimatedBadge } from '@/components/beui/motion/animated-badge';
import { ButtonLink } from '@/components/beui/motion/button/base';
import { api } from '@/lib/api';
import {
  capitalized,
  daysBetween,
  formatDate,
  formatDateIn,
  formatMonthDay,
  inWords,
} from '@/lib/format';
import {
  NewOnboardingButton,
  OnboardingsTable,
  STATUS_BADGE,
} from '../onboardings/onboardings-table';
import { byDepartment } from './by-department';

type Task = DashboardData['tasks'][number];
type Onboarding = DashboardData['onboardings'][number];

const LIST = new Intl.ListFormat('en-US');

// What holds others up, by its kind: "a review", "one upload".
const KIND = { APPROVAL: 'review', DOCUMENT: 'upload', CHECKLIST: 'task' };
const aKind = ({ type }: Task) =>
  type === 'DOCUMENT' ? 'an upload' : `a ${KIND[type]}`;

// "Bao Ho and An Vo"; past two, "Bao Ho, An Vo, and 2 more".
function namesOf(onboardings: Onboarding[]) {
  const names = onboardings.map(({ employee }) => employee.fullName);
  return LIST.format(
    names.length > 2
      ? [...names.slice(0, 2), `${names.length - 2} more`]
      : names,
  );
}

const overdueTasks = ({ tasks }: DashboardData) =>
  tasks.filter(({ overdue }) => overdue);
const drafts = ({ onboardings }: DashboardData) =>
  onboardings.filter(({ status }) => status === 'DRAFT');
// A draft whose template was archived can't be activated until it gets another (BR-T12).
const ready = (data: DashboardData) =>
  drafts(data).filter(({ template }) => !template.archivedAt);
const orphaned = (data: DashboardData) =>
  drafts(data).filter(({ template }) => template.archivedAt);
const dependentsOf = ({ tasks }: DashboardData, task: Task) =>
  tasks.filter(({ dependsOn }) => dependsOn.includes(task.id));

/**
 * HR's home (PLAN §10): the counts, what needs attention and what is due this week, the
 * onboardings by department, then every onboarding and the latest events. The API sends lists;
 * the counting and the words are here.
 */
export function Dashboard({
  greeting,
  employeeId,
  timeZone,
}: {
  greeting: string;
  employeeId: string;
  timeZone: string;
}) {
  const { data, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api('/dashboard', dashboardSchema),
  });
  // An onboarding is on record from its creation, so no event means no onboarding yet: the
  // table's empty state then says it all.
  const shown = data && data.activity.length > 0 ? data : null;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">{greeting}</h1>
          {shown && (
            <p className="text-sm leading-[23px] text-muted-foreground">
              {sentenceOf(shown)}
            </p>
          )}
        </div>
        <NewOnboardingButton />
      </div>
      {/* A failed refetch keeps what is shown. */}
      {!data && error ? (
        <Alert variant="destructive" className="text-danger-strong">
          <AlertIcon />
          <AlertContent>
            <AlertTitle>Couldn&apos;t load the dashboard</AlertTitle>
            <AlertDescription>Reload the page to try again.</AlertDescription>
          </AlertContent>
        </Alert>
      ) : (
        shown && (
          <>
            <Counts data={shown} />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(460px,100%),1fr))] items-start gap-3">
              <Attention data={shown} me={employeeId} timeZone={timeZone} />
              <DueSoon data={shown} />
            </div>
          </>
        )
      )}
      <ByDepartment />
      <OnboardingsTable
        heading="Onboardings"
        timeZone={timeZone}
        empty={{
          title: 'No onboardings yet',
          description:
            'Onboardings you start show up here, along with anything that needs your attention.',
        }}
      />
      {shown && <RecentActivity data={shown} timeZone={timeZone} />}
    </>
  );
}

/** The line under the greeting: the first of these that applies. */
function sentenceOf(data: DashboardData) {
  const overdue = overdueTasks(data);
  // Past due and holding others up, while nothing holds it up.
  const holding = overdue.filter(
    (task) =>
      task.availability !== 'BLOCKED' && dependentsOf(data, task).length > 0,
  );
  const stuck = new Set(holding.map(({ onboardingId }) => onboardingId)).size;
  const orphans = orphaned(data);
  const waiting = ready(data);
  if (stuck > 1) {
    return `${capitalized(inWords(stuck))} onboardings are stuck behind tasks that are past due.`;
  }
  if (stuck === 1) {
    return holding.length === 1
      ? `One onboarding is stuck behind ${aKind(holding[0])} that's past due.`
      : `One onboarding is stuck behind ${inWords(holding.length)} tasks that are past due.`;
  }
  if (overdue.length > 0) {
    return overdue.length === 1
      ? 'One task is past due.'
      : `${capitalized(inWords(overdue.length))} tasks are past due.`;
  }
  // A draft that can't go ahead comes before one that can.
  if (orphans.length > 0) {
    return orphans.length === 1
      ? `${orphans[0].employee.fullName}'s onboarding needs another template.`
      : `${capitalized(inWords(orphans.length))} onboardings need another template.`;
  }
  if (waiting.length > 0) {
    return waiting.length === 1
      ? `${waiting[0].employee.fullName}'s onboarding is ready to activate.`
      : `${capitalized(inWords(waiting.length))} onboardings are ready to activate.`;
  }
  return data.onboardings.length > 0
    ? 'Everything is on track.'
    : 'Nothing is running right now.';
}

function Counts({ data }: { data: DashboardData }) {
  const { today, onboardings, tasks } = data;
  const active = onboardings.filter(({ status }) => status === 'ACTIVE');
  const waiting = ready(data);
  const orphans = orphaned(data).length;
  const overdue = overdueTasks(data);
  const blocked = tasks.filter(
    ({ availability }) => availability === 'BLOCKED',
  );
  const late = new Set(overdue.map(({ onboardingId }) => onboardingId));
  const roots = new Set(blocked.flatMap((task) => blockersOf(task, tasks)));
  const [root] = roots;
  const nameOf = ({ onboardingId }: Task) =>
    onboardings.find(({ id }) => id === onboardingId)!.employee.fullName;
  const [first] = active;
  const [draft] = waiting;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
      <Count
        label="Active onboardings"
        count={active.length}
        note={
          active.length === 0
            ? 'None right now'
            : active.length > 1
              ? namesOf(active)
              : first.startDate <= today
                ? `${first.employee.fullName}, day ${daysBetween(first.startDate, today) + 1}`
                : `${first.employee.fullName}, starts ${formatMonthDay(first.startDate)}`
        }
      />
      <Count
        label="Drafts ready to activate"
        count={waiting.length}
        note={
          waiting.length === 0
            ? orphans > 0
              ? `${orphans} ${orphans === 1 ? 'needs' : 'need'} another template`
              : 'None waiting'
            : waiting.length > 1
              ? namesOf(waiting)
              : draft.startDate < today
                ? `${draft.employee.fullName}, start date passed`
                : `${draft.employee.fullName}, starts ${formatMonthDay(draft.startDate)}`
        }
      />
      <Count
        label="Overdue tasks"
        icon={<Clock className="size-3.5" />}
        tone="text-danger-strong"
        count={overdue.length}
        note={
          overdue.length === 0
            ? 'Nothing overdue'
            : late.size > 1
              ? `Across ${late.size} onboardings`
              : `${overdue.length === 1 ? 'In' : overdue.length === 2 ? 'Both in' : 'All in'} ${nameOf(overdue[0])}'s onboarding`
        }
      />
      <Count
        label="Blocked tasks"
        icon={<Chain className="size-3.5" />}
        tone="text-warning-strong"
        count={blocked.length}
        note={
          blocked.length === 0
            ? 'Nothing blocked'
            : roots.size > 1
              ? `Waiting on ${roots.size} tasks`
              : blocked.length === 1
                ? `Waiting on ${aKind(root)}`
                : `${blocked.length === 2 ? 'Both' : 'All'} waiting on one ${KIND[root.type]}`
        }
      />
    </div>
  );
}

function Count({
  label,
  icon,
  tone,
  count,
  note,
}: {
  label: string;
  icon?: ReactNode;
  // The label's color while there is any; at none it goes grey.
  tone?: string;
  count: number;
  note: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-card p-5">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-[13px]',
          count > 0 && tone ? tone : 'text-muted-foreground',
        )}
      >
        {icon}
        {label}
      </span>
      <span className="text-3xl font-semibold tracking-tight tabular-nums">
        {count}
      </span>
      <span className="text-[13px] text-muted-foreground">{note}</span>
    </div>
  );
}

// Names inside a sentence, set off as on the canvas: "holding up Create work accounts".
function Names({ of }: { of: Task[] }) {
  return LIST.formatToParts(of.map(({ title }) => title)).map(
    ({ type, value }, i) =>
      type === 'element' ? (
        <span key={i} className="font-medium text-foreground">
          {value}
        </span>
      ) : (
        value
      ),
  );
}

/**
 * Overdue tasks, each as what it waits on in the end (itself, unless it is blocked), oldest due
 * first; then the drafts, the soonest start first.
 */
function Attention({
  data,
  me,
  timeZone,
}: {
  data: DashboardData;
  me: string;
  timeZone: string;
}) {
  const { today, onboardings, tasks } = data;
  // Each overdue task's blockers, with the overdue tasks behind each.
  const behind = new Map<Task, Task[]>();
  for (const task of overdueTasks(data)) {
    const roots =
      task.availability === 'BLOCKED' ? blockersOf(task, tasks) : [task];
    for (const root of roots) {
      behind.set(root, [
        ...(behind.get(root) ?? []),
        ...(root === task ? [] : [task]),
      ]);
    }
  }
  const rows = [
    ...[...behind]
      .sort(([a], [b]) => a.dueOn.localeCompare(b.dueOn))
      .map(([task, late]) => {
        const hire = onboardings.find(
          ({ id }) => id === task.onboardingId,
        )!.employee;
        const dependents = dependentsOf(data, task);
        const days = daysBetween(task.dueOn, today);
        return (
          <Row
            key={task.id}
            tile={
              task.overdue ? (
                <Tile className="bg-destructive/10 text-danger-strong">
                  <Clock className="size-4.5" />
                </Tile>
              ) : (
                <Tile className="bg-warning/10 text-warning-strong">
                  <Chain className="size-4.5" />
                </Tile>
              )
            }
            title={`${task.title} for ${hire.fullName}`}
            body={
              <>
                {task.submittedAt &&
                  `Submitted ${formatDateIn(task.submittedAt, timeZone)}. `}
                {task.assignee.id !== me &&
                  `Assigned to ${task.assignee.fullName}. `}
                {task.overdue ? (
                  <>
                    It was due {formatDate(task.dueOn)}
                    {dependents.length > 0 && (
                      <>
                        , and it&apos;s holding up <Names of={dependents} />
                      </>
                    )}
                    .
                  </>
                ) : (
                  <>
                    It&apos;s due {formatDate(task.dueOn)}, and it&apos;s
                    holding up <Names of={late} />, which{' '}
                    {late.length === 1 ? 'is' : 'are'} past due.
                  </>
                )}
              </>
            }
            tag={
              task.overdue && (
                <AnimatedBadge
                  size="sm"
                  status="danger"
                  icon={<Clock className="size-3" />}
                  className="self-start text-danger-strong"
                >
                  Overdue {days} {days === 1 ? 'day' : 'days'}
                </AnimatedBadge>
              )
            }
            // My tasks has no link to one task: it opens on the list.
            action={
              task.assignee.id === me ? (
                <Action href="/tasks">
                  {task.type === 'APPROVAL' ? 'Review' : 'Open My tasks'}
                </Action>
              ) : (
                <Action href={`/onboardings/${task.onboardingId}`}>
                  Open onboarding
                </Action>
              )
            }
          />
        );
      }),
    ...drafts(data).map((draft) => {
      const { archivedAt } = draft.template;
      // It can't be activated as it is, so its owners don't matter yet (BR-T12).
      if (archivedAt) {
        return (
          <Row
            key={draft.id}
            tile={
              <Tile className="bg-warning/10 text-warning-strong">
                <ArchiveBox className="size-4.5" />
              </Tile>
            }
            title={`${draft.employee.fullName}'s onboarding needs another template`}
            body={`${draft.template.name} was archived ${formatDateIn(archivedAt, timeZone)}, so this draft can't be activated. It ${
              draft.startDate < today ? 'was to start' : 'starts'
            } ${formatDate(draft.startDate)}.`}
            action={
              <Action href={`/onboardings/${draft.id}`} primary>
                Choose template
              </Action>
            }
          />
        );
      }
      const { unassigned } = draft;
      // "Two IT tasks" when the rule left one role short, as the review of the draft says.
      const roles = new Set(
        unassigned.map(({ assignee }) =>
          assignee.kind === 'ROLE' ? assignee.role : assignee.kind,
        ),
      );
      const [rule] = unassigned.map(({ assignee }) => assignee);
      const kind =
        roles.size === 1 && rule.kind === 'ROLE' ? `${rule.role} ` : '';
      return (
        <Row
          key={draft.id}
          tile={
            <Tile className="bg-primary/10 text-primary-strong">
              <UserAdd className="size-4.5" />
            </Tile>
          }
          title={`${draft.employee.fullName}'s onboarding is ready to activate`}
          body={`${draft.template.name} v${draft.templateVersion.version} · ${
            draft.startDate < today ? 'was to start' : 'starts'
          } ${formatDate(draft.startDate)}. ${
            unassigned.length === 0
              ? 'Every task has an owner.'
              : `${capitalized(inWords(unassigned.length))} ${kind}${
                  unassigned.length === 1
                    ? 'task still needs'
                    : 'tasks still need'
                } an owner.`
          }`}
          action={
            <Action href={`/onboardings/${draft.id}`} primary>
              Review and activate
            </Action>
          }
        />
      );
    }),
  ];
  return (
    <section
      aria-labelledby="attention"
      className="flex flex-col rounded-2xl border border-border p-2"
    >
      <h2
        id="attention"
        className="px-3 pt-3 pb-2 text-[15px] leading-[21px] font-semibold"
      >
        Needs your attention
      </h2>
      {rows.length === 0 ? (
        <Row
          tile={
            <Tile className="bg-success/10 text-success-strong">
              <Check className="size-4.5" />
            </Tile>
          }
          title="Nothing needs you right now"
          body="Overdue tasks and drafts to activate show up here."
        />
      ) : (
        rows.map((row, i) => (
          <Fragment key={row.key}>
            {i > 0 && <div className="mx-3 h-px bg-border" />}
            {row}
          </Fragment>
        ))
      )}
    </section>
  );
}

function Row({
  tile,
  title,
  body,
  tag,
  action,
}: {
  tile: ReactNode;
  title: string;
  body: ReactNode;
  tag?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3.5 p-3">
      {tile}
      <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1.5">
        <span className="text-[15px] leading-[21px] font-semibold">
          {title}
        </span>
        <span className="text-sm leading-[23px] text-muted-foreground">
          {body}
        </span>
        {tag}
      </div>
      {action}
    </div>
  );
}

function Tile({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-xl',
        className,
      )}
    >
      {children}
    </span>
  );
}

function Action({
  href,
  primary = false,
  children,
}: {
  href: string;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <ButtonLink
      href={href}
      size="sm"
      variant={primary ? 'primary' : 'secondary'}
      className={
        primary
          ? 'bg-primary-strong hover:bg-primary-strong/90'
          : 'hover:bg-foreground/5 active:bg-foreground/8'
      }
    >
      {children}
    </ButtonLink>
  );
}

/** Open tasks due from today through the sixth day on; what is overdue is above. */
function DueSoon({ data }: { data: DashboardData }) {
  const { today, onboardings, tasks } = data;
  const end = addDays(today, 6);
  const soon = tasks.filter(({ dueOn }) => dueOn >= today && dueOn <= end);
  return (
    <section
      aria-labelledby="upcoming"
      className="flex flex-col rounded-2xl border border-border p-2"
    >
      <h2
        id="upcoming"
        className="px-3 pt-3 pb-2 text-[15px] leading-[21px] font-semibold"
      >
        Due in the next 7 days
      </h2>
      {soon.length === 0 ? (
        <p className="px-3 pt-1 pb-3 text-sm text-muted-foreground">
          Nothing is due in the next 7 days.
        </p>
      ) : (
        <ul className="flex flex-col">
          {soon.map((task) => {
            const hire = onboardings.find(
              ({ id }) => id === task.onboardingId,
            )!.employee;
            return (
              // The title's link stretches over the row, as in the onboardings table.
              <li
                key={task.id}
                className="relative flex items-center gap-3.5 rounded-xl px-3 py-2.5 text-sm hover:bg-foreground/5 active:bg-foreground/8"
              >
                <span className="w-13 shrink-0 font-mono text-xs text-muted-foreground">
                  {task.dueOn === today ? 'Today' : formatMonthDay(task.dueOn)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <Link
                    href={`/onboardings/${task.onboardingId}`}
                    className="font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-primary focus-visible:after:ring-inset"
                  >
                    {task.title}
                  </Link>
                  <span className="text-[13px] text-muted-foreground">
                    {hire.fullName} ·{' '}
                    {task.assignee.id === hire.id
                      ? 'new hire'
                      : task.assignee.fullName}
                  </span>
                </span>
                {/* Positioned badges would lift above the row's link. */}
                <span className="pointer-events-none">
                  <DueBadge task={task} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// Shorter than a task's own badge: the dashboard says only that it waits.
function DueBadge({ task }: { task: Task }) {
  switch (task.availability) {
    case 'READY':
      return (
        <AnimatedBadge
          size="sm"
          status="info"
          className="text-primary-strong"
          icon={
            task.status === 'IN_PROGRESS' ? (
              <Timer className="size-3" />
            ) : (
              <ArrowRight className="size-3" />
            )
          }
        >
          {task.status === 'IN_PROGRESS' ? 'In progress' : 'Ready'}
        </AnimatedBadge>
      );
    case 'LOCKED_BY_DATE':
      return (
        <AnimatedBadge
          size="sm"
          status="neutral"
          icon={<Lock className="size-3" />}
        >
          Opens {formatMonthDay(task.availableOn)}
        </AnimatedBadge>
      );
    default:
      return (
        <AnimatedBadge
          size="sm"
          status="warning"
          className="border-warning/30 bg-warning/10 text-warning-strong"
          icon={<Chain className="size-3" />}
        >
          Blocked
        </AnimatedBadge>
      );
  }
}

// A department's bar by status. A draft and a canceled one are both grey, told apart by shade.
const STATUS_BAR: Record<OnboardingStatus, string> = {
  DRAFT: 'bg-muted-foreground',
  ACTIVE: 'bg-primary',
  COMPLETED: 'bg-success',
  CANCELED: 'bg-foreground/15',
};

/**
 * Every onboarding by its new hire's department and status (FR-24), from the list the
 * Onboardings table shows: nothing while it loads, when it fails (the table says so) or is empty.
 */
function ByDepartment() {
  const { data } = useQuery({
    queryKey: ['onboardings'],
    queryFn: () => api('/onboardings', onboardingSummarySchema.array()),
  });
  if (!data?.length) return null;
  const rows = byDepartment(data);
  const most = Math.max(...rows.map(({ total }) => total));
  const shown = new Set(
    rows.flatMap(({ counts }) => counts.map(({ status }) => status)),
  );
  return (
    <section
      aria-labelledby="departments"
      className="flex flex-col rounded-2xl border border-border p-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 pt-3 pb-2">
        <h2
          id="departments"
          className="text-[15px] leading-[21px] font-semibold"
        >
          Onboardings by department
        </h2>
        <p className="text-[13px] leading-5 text-muted-foreground">
          All onboardings, by each new hire&apos;s department
        </p>
      </div>
      <ul className="flex flex-col text-sm">
        {rows.map(({ department, total, counts }) => (
          <li
            key={department?.id ?? 'none'}
            className="flex flex-col gap-2 px-3 py-2.5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <span
                className={cn(
                  'font-medium',
                  !department && 'text-muted-foreground',
                )}
              >
                {department?.name ?? 'No department'}
              </span>
              <span className="text-[13px] leading-5 text-muted-foreground tabular-nums">
                {counts
                  .map(
                    ({ status, count }) =>
                      `${count} ${STATUS_BADGE[status].label.toLowerCase()}${status === 'DRAFT' && count > 1 ? 's' : ''}`,
                  )
                  .join(' · ')}
              </span>
            </div>
            {/* As long as its share of the largest; a share too small to see keeps 8 px a piece. */}
            <div
              aria-hidden
              className="flex gap-0.5"
              style={{
                width: `${(total / most) * 100}%`,
                minWidth: counts.length * 10 - 2,
              }}
            >
              {counts.map(({ status, count }) => (
                <span
                  key={status}
                  className={cn('h-2 min-w-2 rounded-full', STATUS_BAR[status])}
                  style={{ flex: `${count} 1 0px` }}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
      {/* The words in each row say it all; the legend only names the colors. */}
      <ul
        aria-hidden
        className="flex flex-wrap gap-x-5 gap-y-2 px-3 pt-1.5 pb-2.5 text-[13px] leading-5 text-muted-foreground"
      >
        {onboardingStatusSchema.options
          .filter((status) => shown.has(status))
          .map((status) => (
            <li key={status} className="inline-flex items-center gap-2">
              <span
                className={cn('h-2 w-4 rounded-full', STATUS_BAR[status])}
              />
              {STATUS_BADGE[status].label}
            </li>
          ))}
      </ul>
    </section>
  );
}

function RecentActivity({
  data: { today, activity },
  timeZone,
}: {
  data: DashboardData;
  timeZone: string;
}) {
  return (
    <section aria-labelledby="activity" className="rounded-2xl bg-card p-2">
      <h2
        id="activity"
        className="px-3 pt-3 pb-2 text-[15px] leading-[21px] font-semibold"
      >
        Recent activity
      </h2>
      <ol className="flex flex-col px-3 pb-2 text-sm">
        {activity.map((event, i) => (
          <li
            key={event.id}
            className={cn(
              'flex flex-wrap justify-between gap-x-4 gap-y-1 py-2.5',
              i > 0 && 'border-t border-border',
            )}
          >
            <span>
              <EventText event={event} dashboard />
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {formatEventTime(event.at, today, timeZone)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
