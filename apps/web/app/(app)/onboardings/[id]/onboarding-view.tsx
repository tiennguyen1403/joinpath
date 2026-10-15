'use client';

import {
  type OnboardingDetail,
  onboardingDetailSchema,
  type Task,
  type TaskStatus,
} from '@joinpath/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Avatar, newHireTint } from '@/components/avatar';
import {
  TodoList,
  type TodoItemStatus,
} from '@/components/beui/agents/todo-list';
import { cn } from '@/components/beui/lib/utils';
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from '@/components/beui/motion/alert';
import { AnimatedBadge } from '@/components/beui/motion/animated-badge';
import {
  AnimatedToastStack,
  useAnimatedToastStack,
} from '@/components/beui/motion/animated-toast-stack';
import { EmptyState } from '@/components/empty-state';
import { TaskBadge, waitsFor } from '@/components/task-status';
import { api, ApiError } from '@/lib/api';
import {
  capitalized,
  formatDate,
  formatDateIn,
  formatFromToday,
  inWords,
} from '@/lib/format';
import { usePageCrumb } from '../../app-shell';
import { STATUS_BADGE } from '../onboardings-table';
import { Wizard } from '../wizard';

/**
 * An onboarding's page. A draft is still the wizard, at its review; once activated it is
 * the onboarding's header and its tasks by phase.
 */
export function OnboardingView({
  id,
  orgName,
  timeZone,
}: {
  id: string;
  orgName: string;
  timeZone: string;
}) {
  const { toasts, showToast, dismissToast } = useAnimatedToastStack();
  const { data, error } = useQuery({
    queryKey: ['onboarding', id],
    queryFn: () => api(`/onboardings/${id}`, onboardingDetailSchema),
  });
  usePageCrumb(
    data && data.status !== 'DRAFT' ? data.employee.fullName : undefined,
  );

  function activated(onboarding: OnboardingDetail) {
    const ready = onboarding.tasks.filter(
      ({ availability }) => availability === 'READY',
    ).length;
    // The canvas also says the invitation is on its way: from M2.1.
    showToast({
      status: 'success',
      title: 'Activated just now',
      description: `${onboarding.tasks.length} tasks were created. ${
        ready === 0
          ? 'They open on their dates.'
          : `${capitalized(inWords(ready))} ${ready === 1 ? 'task is' : 'tasks are'} open today.`
      }`,
    });
  }

  let page: ReactNode = null;
  if (data) {
    page =
      data.status === 'DRAFT' ? (
        <Wizard
          orgName={orgName}
          today={data.today}
          timeZone={timeZone}
          draft={data}
          onActivated={activated}
        />
      ) : (
        <>
          <Header onboarding={data} timeZone={timeZone} />
          <Phases onboarding={data} timeZone={timeZone} />
        </>
      );
  } else if (
    error instanceof ApiError &&
    (error.status === 404 || error.status === 400)
  ) {
    page = (
      <EmptyState
        title="Onboarding not found"
        description="It may not exist, or it isn't one you can see."
      />
    );
  } else if (error) {
    page = (
      <Alert variant="destructive" className="text-danger-strong">
        <AlertIcon />
        <AlertContent>
          <AlertTitle>Couldn&apos;t load the onboarding</AlertTitle>
          <AlertDescription>Reload the page to try again.</AlertDescription>
        </AlertContent>
      </Alert>
    );
  }

  return (
    <>
      {page}
      <AnimatedToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        fixed
        classNames={{ iconWrap: 'bg-success/10 text-success-strong' }}
      />
    </>
  );
}

// The canvas's header; Change start date and Cancel come with M3.1, tabs with a second view
// (Activity in M3.4, Graph in M4.3).
function Header({
  onboarding,
  timeZone,
}: {
  onboarding: OnboardingDetail;
  timeZone: string;
}) {
  const {
    employee,
    template,
    templateVersion,
    tasks,
    startDate,
    today,
    completedAt,
  } = onboarding;
  const done = tasks.filter(({ status }) => status === 'COMPLETED').length;
  const badge = STATUS_BADGE[onboarding.status];
  return (
    <>
      <div className="flex items-center gap-4">
        <Avatar
          name={employee.fullName}
          className={cn('size-14 text-lg', newHireTint(employee.id))}
        />
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-3xl font-semibold tracking-tight">
              {employee.fullName}
            </h1>
            <AnimatedBadge
              size="md"
              status={badge.status}
              showIcon={onboarding.status === 'COMPLETED'}
              className={badge.className}
            >
              {badge.label}
            </AnimatedBadge>
          </div>
          <span className="text-muted-foreground">
            {[
              employee.jobTitle,
              employee.department?.name,
              employee.manager && `reports to ${employee.manager.fullName}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
        <Stat label="Starts" note={formatFromToday(today, startDate)}>
          <span className="font-mono">{formatDate(startDate)}</span>
        </Stat>
        <Stat
          label="Template"
          note={`Version ${templateVersion.version}, locked in`}
        >
          {template.name}
        </Stat>
        <Stat
          label="Progress"
          note={
            completedAt
              ? `Finished ${formatDateIn(completedAt, timeZone)}`
              : undefined
          }
          bar={
            // The words above carry the value, as in the onboardings table.
            <div
              aria-hidden
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/6"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${(done / Math.max(tasks.length, 1)) * 100}%`,
                }}
              />
            </div>
          }
        >
          {done} of {tasks.length}{' '}
          <span className="text-[13px] font-normal text-muted-foreground">
            done
          </span>
        </Stat>
      </div>
    </>
  );
}

const TODO_STATUS: Record<TaskStatus, TodoItemStatus> = {
  PENDING: 'pending',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  CANCELED: 'cancelled',
};

// Each phase a todo list (PLAN §10.1). One whose tasks are all done starts folded.
function Phases({
  onboarding: { tasks },
  timeZone,
}: {
  onboarding: OnboardingDetail;
  timeZone: string;
}) {
  // The API sends the tasks by phase, then template order.
  const phases = [...Map.groupBy(tasks, (task) => task.phaseOrder).values()];
  return (
    <div className="flex flex-col gap-3">
      {phases.map((phase) => (
        <TodoList
          key={phase[0].phaseKey}
          title={phaseTitle(phase)}
          defaultOpen={phase.some(({ status }) => status !== 'COMPLETED')}
          // Taller than any phase: the page scrolls, never the list.
          maxHeight={10_000}
          items={phase.map((task) => ({
            id: task.id,
            title: (
              <span
                className={
                  task.status === 'COMPLETED' || task.status === 'CANCELED'
                    ? 'text-muted-foreground'
                    : 'text-foreground'
                }
              >
                {task.title}
              </span>
            ),
            status: TODO_STATUS[task.status],
            // A started task holds a still arc rather than beUI's endless spinner.
            progress: 50,
            meta: <TaskMeta task={task} tasks={tasks} timeZone={timeZone} />,
            detail: <TaskBadge task={task} tasks={tasks} />,
          }))}
        />
      ))}
    </div>
  );
}

// "Day 1 · Mon, Oct 26" when every task of the phase opens that day, as the canvas names it.
function phaseTitle(phase: Task[]) {
  const [{ phaseName, availableOn }] = phase;
  return phase.every((task) => task.availableOn === availableOn)
    ? `${phaseName} · ${formatDate(availableOn)}`
    : phaseName;
}

// Who does it and by when; started and done are real times, shown where the company is.
function TaskMeta({
  task,
  tasks,
  timeZone,
}: {
  task: Task;
  tasks: Task[];
  timeZone: string;
}) {
  const { assignee, status, startedAt, completedAt, overdue } = task;
  if (status === 'COMPLETED' && completedAt) {
    return (
      <>
        {assignee.fullName} · done{' '}
        <span className="font-mono">{formatDateIn(completedAt, timeZone)}</span>
      </>
    );
  }
  const waiting =
    task.availability === 'LOCKED_BY_DATE' &&
    tasks.some(
      (other) =>
        task.dependsOn.includes(other.id) && other.status !== 'COMPLETED',
    );
  return (
    <>
      {assignee.fullName} · due{' '}
      <span className={cn('font-mono', overdue && 'text-danger-strong')}>
        {formatDate(task.dueOn)}
      </span>
      {overdue && <span className="text-danger-strong"> · overdue</span>}
      {status === 'IN_PROGRESS' && startedAt && (
        <>
          {' '}
          · started{' '}
          <span className="font-mono">{formatDateIn(startedAt, timeZone)}</span>
        </>
      )}
      {waiting && ` · then waits for ${waitsFor(task, tasks)}`}
    </>
  );
}

function Stat({
  label,
  note,
  bar,
  children,
}: {
  label: string;
  note?: string;
  bar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-card px-4.5 py-4">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-[15px] font-medium">{children}</span>
      {note && (
        <span className="text-[13px] text-muted-foreground">{note}</span>
      )}
      {bar}
    </div>
  );
}
