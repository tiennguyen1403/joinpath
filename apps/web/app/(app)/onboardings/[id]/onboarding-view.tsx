'use client';

import {
  type OnboardingDetail,
  onboardingDetailSchema,
  type OnboardingInvitation,
  type Task,
  type TaskStatus,
} from '@joinpath/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { Envelope } from 'reicon-react';
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
  type ToastInput,
  useAnimatedToastStack,
} from '@/components/beui/motion/animated-toast-stack';
import { Button, ButtonLink } from '@/components/beui/motion/button/base';
import { EmptyState } from '@/components/empty-state';
import { TaskBadge, waitsFor } from '@/components/task-status';
import { api, ApiError } from '@/lib/api';
import {
  capitalized,
  firstName,
  formatDate,
  formatDateIn,
  formatFromToday,
  formatMomentIn,
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
  const router = useRouter();
  const { toasts, showToast, dismissToast } = useAnimatedToastStack();
  const { data, error } = useQuery({
    queryKey: ['onboarding', id],
    queryFn: () => api(`/onboardings/${id}`, onboardingDetailSchema),
  });
  usePageCrumb(
    data && data.status !== 'DRAFT' ? data.employee.fullName : undefined,
  );
  const seeInvitation = {
    label: 'See the invitation',
    onClick: () => router.push('/mock-inbox'),
  };

  function activated(onboarding: OnboardingDetail) {
    const ready = onboarding.tasks.filter(
      ({ availability }) => availability === 'READY',
    ).length;
    const invited = onboarding.invitation !== null;
    showToast({
      status: 'success',
      title: 'Activated just now',
      description: `${onboarding.tasks.length} tasks were created${
        invited
          ? ` and ${firstName(onboarding.employee.fullName)}'s invitation is on its way`
          : ''
      }. ${
        ready === 0
          ? invited
            ? 'The tasks open on their dates.'
            : 'They open on their dates.'
          : `${capitalized(inWords(ready))} ${ready === 1 ? 'task is' : 'tasks are'} open today.`
      }`,
      action: invited ? seeInvitation : undefined,
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
          {data.invitation ? (
            // HR's view: the invitation beside the tasks, as the canvas lays it out.
            <div className="flex flex-wrap items-start gap-5">
              <div className="min-w-0 flex-[999_1_560px]">
                <Phases onboarding={data} timeZone={timeZone} />
              </div>
              <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
                <InvitationCard
                  onboarding={data}
                  invitation={data.invitation}
                  timeZone={timeZone}
                  showToast={showToast}
                  seeInvitation={seeInvitation}
                />
              </div>
            </div>
          ) : (
            <Phases onboarding={data} timeZone={timeZone} />
          )}
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
        // beUI's muted pill matches the toast's own surface; the canvas tints it.
        classNames={{
          action:
            'bg-foreground/6 hover:bg-foreground/11 active:bg-foreground/14',
        }}
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

const WARNING = 'border-warning/30 bg-warning/10 text-warning-strong';

/**
 * The link the new hire sets a password through (BR-A07). HR resends it until they have an
 * account; a resend or a change of email turns the old one off (BR-P05).
 */
function InvitationCard({
  onboarding: { id, employee, status },
  invitation: { email, sentAt, expiresAt, acceptedAt, revokedAt },
  timeZone,
  showToast,
  seeInvitation,
}: {
  onboarding: OnboardingDetail;
  invitation: OnboardingInvitation;
  timeZone: string;
  showToast: (toast: ToastInput) => void;
  seeInvitation: { label: string; onClick: () => void };
}) {
  const queryClient = useQueryClient();
  // Real moments, unlike business dates: expiry follows the real clock, read once here.
  const [now] = useState(Date.now);
  const resend = useMutation({
    mutationFn: () =>
      api(`/onboardings/${id}/resend-invitation`, onboardingDetailSchema, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (onboarding) => {
      queryClient.setQueryData(['onboarding', id], onboarding);
      showToast({
        status: 'success',
        title: 'Invitation sent again',
        description: 'The old link no longer works.',
        action: seeInvitation,
      });
    },
    onError: (error) => {
      showToast({
        status: 'error',
        title: "Couldn't resend the invitation",
        description:
          error instanceof ApiError
            ? error.message
            : 'Check your connection and try again.',
      });
      // Accepted or changed elsewhere meanwhile: show it as it is now.
      void queryClient.invalidateQueries({ queryKey: ['onboarding', id] });
    },
  });

  const expired = Date.parse(expiresAt) <= now;
  const badge = acceptedAt
    ? {
        label: 'Accepted',
        status: 'success' as const,
        className: 'border-success/30 bg-success/10 text-success-strong',
      }
    : revokedAt
      ? {
          label: 'Email changed',
          status: 'warning' as const,
          className: WARNING,
        }
      : expired
        ? { label: 'Expired', status: 'warning' as const, className: WARNING }
        : {
            label: 'Not accepted yet',
            status: 'neutral' as const,
            className: 'bg-background',
          };
  const last = acceptedAt
    ? ['Accepted', acceptedAt]
    : revokedAt
      ? null
      : [expired ? 'Expired' : 'Expires', expiresAt];

  return (
    <section
      aria-labelledby="invitation"
      className="flex flex-col gap-3 rounded-2xl bg-card p-4.5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="invitation"
          className="text-[15px] leading-[21px] font-semibold"
        >
          Invitation
        </h2>
        <AnimatedBadge
          status={badge.status}
          showIcon={badge.status === 'success'}
          className={badge.className}
        >
          {badge.label}
        </AnimatedBadge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-2 text-[13px] leading-5">
        <dt className="text-muted-foreground">Sent to</dt>
        <dd className="font-mono text-xs leading-5 wrap-anywhere">{email}</dd>
        <dt className="text-muted-foreground">Sent</dt>
        <dd>{formatMomentIn(sentAt, timeZone)}</dd>
        {last && (
          <>
            <dt className="text-muted-foreground">{last[0]}</dt>
            <dd>{formatMomentIn(last[1], timeZone)}</dd>
          </>
        )}
      </dl>
      {revokedAt && !acceptedAt && (
        <p className="text-[13px] leading-5 text-muted-foreground">
          {firstName(employee.fullName)}&apos;s email is now{' '}
          <span className="font-mono text-xs text-foreground wrap-anywhere">
            {employee.email}
          </span>
          , so this link no longer works. Resend sends a new one there.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <ButtonLink
          href="/mock-inbox"
          size="sm"
          className="bg-primary-strong hover:bg-primary-strong/90"
        >
          <Envelope className="size-3.5" aria-hidden />
          Open mock inbox
        </ButtonLink>
        {/* An account, or an onboarding no longer running, has nothing to resend (409). */}
        {!acceptedAt && status === 'ACTIVE' && (
          <Button
            variant="secondary"
            size="sm"
            disabled={resend.isPending}
            onClick={() => resend.mutate()}
            className="bg-background hover:bg-foreground/5 active:bg-foreground/8"
          >
            {resend.isPending ? 'Sending…' : 'Resend'}
          </Button>
        )}
      </div>
    </section>
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
