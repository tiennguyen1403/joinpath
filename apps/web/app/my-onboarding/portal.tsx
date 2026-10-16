'use client';

import {
  type IsoDate,
  type Me,
  type OnboardingDetail,
  onboardingDetailSchema,
  type Task,
  type TaskStatus,
} from '@joinpath/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Eye, Logout, Route, Undo } from 'reicon-react';
import { Avatar, newHireTint } from '@/components/avatar';
import {
  TodoList,
  type TodoItemStatus,
} from '@/components/beui/agents/todo-list';
import { cn } from '@/components/beui/lib/utils';
import { AnimatedBadge } from '@/components/beui/motion/animated-badge';
import {
  AnimatedToastStack,
  type ToastInput,
  useAnimatedToastStack,
} from '@/components/beui/motion/animated-toast-stack';
import { Button } from '@/components/beui/motion/button/base';
import { Notice } from '@/components/notice';
import { TaskBadge, waitsFor } from '@/components/task-status';
import { ChecklistWork, DocumentWork, InReview } from '@/components/task-work';
import { api } from '@/lib/api';
import {
  firstName,
  formatDate,
  formatDateIn,
  formatDateInFull,
  formatFromToday,
} from '@/lib/format';

// The approval that reviews a document, if one does.
const reviewOf = (task: Task, tasks: Task[]) =>
  tasks.find(({ reviewsTaskId }) => reviewsTaskId === task.id);

// Submitted, but the review may still send it back: not done yet for the new hire.
const inReview = (task: Task, tasks: Task[]) =>
  task.status === 'COMPLETED' && reviewOf(task, tasks)?.status === 'PENDING';

const isDone = (task: Task, tasks: Task[]) =>
  task.status === 'COMPLETED' && !inReview(task, tasks);

// Opening later, and then still waiting for others.
const waitsAfterOpening = (task: Task, tasks: Task[]) =>
  task.availability === 'LOCKED_BY_DATE' &&
  tasks.some(
    ({ id, status }) => task.dependsOn.includes(id) && status !== 'COMPLETED',
  );

const TODO_STATUS: Record<TaskStatus, TodoItemStatus> = {
  PENDING: 'pending',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  CANCELED: 'cancelled',
};

/**
 * The new hire's portal (PLAN §10): their tasks by phase, the open ones worked right there,
 * and who else is getting things ready. Outside the app shell, for a phone first.
 */
export function Portal({ me }: { me: Me }) {
  const id = me.onboardingId!;
  const queryClient = useQueryClient();
  const { toasts, showToast, dismissToast } = useAnimatedToastStack();
  const { data, error } = useQuery({
    queryKey: ['onboarding', id],
    queryFn: () => api(`/onboardings/${id}`, onboardingDetailSchema),
  });

  function settle(onboarding: OnboardingDetail, toast?: ToastInput) {
    queryClient.setQueryData(['onboarding', id], onboarding);
    if (onboarding.status === 'COMPLETED') {
      showToast({
        status: 'success',
        title: "You're all set",
        description: 'That was the last task of your onboarding.',
      });
    } else if (toast) {
      showToast(toast);
    }
  }
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ['onboarding', id] });

  return (
    <div className="min-h-dvh text-sm">
      <Header me={me} />
      <main className="px-4 pt-6 pb-12 sm:px-5 sm:pt-8 sm:pb-18">
        <div className="mx-auto flex max-w-260 flex-col gap-6">
          {data ? (
            <Onboarding
              onboarding={data}
              me={me}
              settle={settle}
              refresh={refresh}
            />
          ) : (
            error && (
              <Notice
                variant="destructive"
                title="Couldn't load your onboarding"
                text="Reload the page to try again."
              />
            )
          )}
        </div>
      </main>
      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} fixed />
    </div>
  );
}

function Header({ me }: { me: Me }) {
  const router = useRouter();
  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }
  return (
    <header className="h-14 border-b border-border sm:h-16">
      <div className="mx-auto flex h-full max-w-260 items-center justify-between gap-3 px-4 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
            <Route size={16} aria-hidden />
          </span>
          <span className="flex flex-col">
            <span className="font-semibold">{me.organization.name}</span>
            <span className="text-xs text-muted-foreground">
              Your onboarding
            </span>
          </span>
        </div>
        <nav aria-label="Account" className="flex items-center gap-1">
          <span className="flex h-9 items-center gap-2 rounded-full sm:bg-card sm:pr-3 sm:pl-1">
            <Avatar
              name={me.employee.fullName}
              className={cn('size-7 text-[11px]', newHireTint(me.employee.id))}
            />
            <span className="sr-only sm:not-sr-only sm:font-medium">
              {me.employee.fullName}
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
        </nav>
      </div>
    </header>
  );
}

function Onboarding({
  onboarding,
  me,
  settle,
  refresh,
}: {
  onboarding: OnboardingDetail;
  me: Me;
  settle: (onboarding: OnboardingDetail, toast?: ToastInput) => void;
  refresh: () => void;
}) {
  const { tasks, today, startDate } = onboarding;
  const viewerId = me.employee.id;
  const timeZone = me.organization.timezone;
  const mine = tasks.filter(({ assignee }) => assignee.id === viewerId);
  const others = tasks.filter(({ assignee }) => assignee.id !== viewerId);
  // The API sends the tasks by phase, then template order.
  const phases = [...Map.groupBy(mine, (task) => task.phaseOrder).values()];
  const { manager } = onboarding.employee;
  const people = [
    ...(manager ? [{ person: manager, role: 'Your manager' }] : []),
    ...[
      ...Map.groupBy(
        others.filter(({ assignee }) => assignee.id !== manager?.id),
        ({ assignee }) => assignee.id,
      ).values(),
    ].map((theirs) => ({
      person: theirs[0].assignee,
      role: theirs.map(({ title }) => title).join(', '),
    })),
  ];
  // What others finish before day 1, while it is still ahead. Reviews show on the document.
  const ready =
    today < startDate
      ? others.filter(
          ({ type, dueOn }) => type !== 'APPROVAL' && dueOn < startDate,
        )
      : [];

  function body(task: Task) {
    const review = reviewOf(task, tasks);
    if (task.availability === 'READY') {
      return task.type === 'DOCUMENT' ? (
        <DocumentWork
          task={task}
          review={review}
          viewerId={viewerId}
          timeZone={timeZone}
          settle={settle}
          refresh={refresh}
        />
      ) : (
        <ChecklistWork task={task} settle={settle} refresh={refresh} />
      );
    }
    return review && inReview(task, tasks) ? (
      <InReview
        task={task}
        review={review}
        viewerId={viewerId}
        timeZone={timeZone}
      />
    ) : undefined;
  }

  return (
    <>
      <Greeting
        onboarding={onboarding}
        orgName={me.organization.name}
        timeZone={timeZone}
        done={mine.filter((task) => isDone(task, tasks)).length}
        total={mine.length}
      />
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-3">
          {phases.map((phase) => (
            <TodoList
              key={phase[0].phaseKey}
              title={phaseTitle(phase, today)}
              defaultOpen={phase.some((task) => !isDone(task, tasks))}
              // Taller than any phase: the page scrolls, never the list.
              maxHeight={10_000}
              items={phase.map((task) => {
                const done = isDone(task, tasks);
                const work = body(task);
                return {
                  id: task.id,
                  title: (
                    <span
                      className={cn(
                        // Wrapped rather than cut short beside a badge on a phone.
                        'whitespace-normal',
                        done ? 'text-muted-foreground' : 'text-foreground',
                        work && 'font-medium',
                      )}
                    >
                      {task.title}
                    </span>
                  ),
                  status: inReview(task, tasks)
                    ? 'in-progress'
                    : TODO_STATUS[task.status],
                  // A started task holds a still arc rather than beUI's endless spinner.
                  progress: 50,
                  meta: <Meta task={task} tasks={tasks} timeZone={timeZone} />,
                  detail: <Badge task={task} tasks={tasks} />,
                  body: work,
                };
              })}
            />
          ))}
        </div>
        {(people.length > 0 || ready.length > 0) && (
          <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
            {people.length > 0 && (
              <section
                aria-labelledby="people"
                className="flex flex-col gap-3.5 rounded-2xl bg-card p-4.5"
              >
                <h2
                  id="people"
                  className="text-[15px] leading-[21px] font-semibold"
                >
                  Your people
                </h2>
                <ul className="flex flex-col gap-3">
                  {people.map(({ person, role }) => (
                    <li key={person.id} className="flex items-center gap-3">
                      <Avatar
                        name={person.fullName}
                        className="size-9 bg-foreground/8 text-foreground"
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium">{person.fullName}</span>
                        <span className="text-[13px] text-muted-foreground">
                          {role}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {ready.length > 0 && (
              <section
                aria-labelledby="ready"
                className="flex flex-col gap-3 rounded-2xl border border-border p-4.5"
              >
                <h2
                  id="ready"
                  className="text-[15px] leading-[21px] font-semibold"
                >
                  Getting ready for you
                </h2>
                <ul className="flex flex-col gap-3 text-[13px] leading-5">
                  {ready.map((task) => (
                    <li
                      key={task.id}
                      className="flex items-start justify-between gap-3"
                    >
                      <span className="flex flex-col">
                        <span className="font-medium">{task.title}</span>
                        <span className="text-muted-foreground">
                          {task.assignee.fullName}
                          {waitsAfterOpening(task, tasks) &&
                            ` · then waits for ${waitsFor(task, tasks)}`}
                        </span>
                      </span>
                      <TaskBadge task={task} tasks={tasks} done />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        )}
      </div>
    </>
  );
}

function Greeting({
  onboarding: { employee, startDate, today, status, completedAt },
  orgName,
  timeZone,
  done,
  total,
}: {
  onboarding: OnboardingDetail;
  orgName: string;
  timeZone: string;
  done: number;
  total: number;
}) {
  const name = firstName(employee.fullName);
  const finished = status === 'COMPLETED' && completedAt;
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[28px] leading-[34px] font-semibold tracking-tight sm:text-[32px] sm:leading-[38px]">
          {finished
            ? `You're all set, ${name}`
            : today < startDate
              ? `Hi ${name}, you start ${formatFromToday(today, startDate)}`
              : today === startDate
                ? `Hi ${name}, today is your first day`
                : `Hi ${name}, welcome to ${orgName}`}
        </h1>
        <p className="text-[15px] leading-6 text-muted-foreground">
          {finished
            ? `You finished your onboarding on ${formatDateIn(completedAt, timeZone)}.`
            : [
                formatDateInFull(startDate),
                employee.jobTitle,
                employee.department?.name,
              ]
                .filter(Boolean)
                .join(' · ')}
        </p>
      </div>
      <div className="flex flex-[1_1_100%] flex-col gap-2 sm:flex-[0_1_280px]">
        <span className="flex justify-between text-[13px] text-muted-foreground">
          <span>Your tasks</span>
          <span className="font-mono">
            {done} of {total}
          </span>
        </span>
        {/* The words above carry the value, as on the onboarding's page. */}
        <div
          aria-hidden
          className="h-1.5 overflow-hidden rounded-full bg-foreground/6"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${(done / Math.max(total, 1)) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// "Day 1 · Mon, Oct 26" while every task of the new hire's in the phase opens that day, ahead.
function phaseTitle(phase: Task[], today: IsoDate) {
  const [{ phaseName, availableOn }] = phase;
  return availableOn > today &&
    phase.every((task) => task.availableOn === availableOn)
    ? `${phaseName} · ${formatDate(availableOn)}`
    : phaseName;
}

// By when, or when it was done; who reviews a document; what a task opening later waits for.
function Meta({
  task,
  tasks,
  timeZone,
}: {
  task: Task;
  tasks: Task[];
  timeZone: string;
}) {
  const review = reviewOf(task, tasks);
  const decision = task.submissions[0]?.decision;
  if (task.status === 'COMPLETED' && task.completedAt) {
    if (decision?.decision === 'APPROVED') {
      return (
        <>
          Approved by {decision.decidedBy.fullName} ·{' '}
          <span className="font-mono">
            {formatDateIn(decision.decidedAt, timeZone)}
          </span>
        </>
      );
    }
    return (
      <>
        {task.type === 'DOCUMENT' ? 'Submitted' : 'Done'}{' '}
        <span className="font-mono">
          {formatDateIn(task.completedAt, timeZone)}
        </span>
        {review &&
          inReview(task, tasks) &&
          ` · reviewed by ${review.assignee.fullName}`}
      </>
    );
  }
  return (
    <>
      Due{' '}
      <span className={cn('font-mono', task.overdue && 'text-danger-strong')}>
        {formatDate(task.dueOn)}
      </span>
      {task.overdue && <span className="text-danger-strong"> · overdue</span>}
      {review && ` · reviewed by ${review.assignee.fullName}`}
      {waitsAfterOpening(task, tasks) &&
        ` · then waits for ${waitsFor(task, tasks)}`}
    </>
  );
}

// A document sent back, or waiting for its review; any other task as everywhere else.
function Badge({ task, tasks }: { task: Task; tasks: Task[] }) {
  if (
    task.status === 'IN_PROGRESS' &&
    task.submissions[0]?.decision?.decision === 'REJECTED'
  ) {
    return (
      <AnimatedBadge
        size="sm"
        status="danger"
        className="text-danger-strong"
        icon={<Undo className="size-3" />}
      >
        Changes requested
      </AnimatedBadge>
    );
  }
  if (inReview(task, tasks)) {
    return (
      <AnimatedBadge
        size="sm"
        status="info"
        className="text-primary-strong"
        icon={<Eye className="size-3" />}
      >
        In review
      </AnimatedBadge>
    );
  }
  return <TaskBadge task={task} tasks={tasks} />;
}
