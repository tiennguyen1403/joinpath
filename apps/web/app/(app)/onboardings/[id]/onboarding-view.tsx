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
import { type ReactNode, useRef, useState } from 'react';
import { Calendar, Envelope } from 'reicon-react';
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
import { Notice } from '@/components/notice';
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
import { type Change, ChangeDialog, TaskMenu } from '../changes';
import { STATUS_BADGE } from '../onboardings-table';
import { Wizard } from '../wizard';

/**
 * An onboarding's page. A draft is still the wizard, at its review; once activated it is
 * the onboarding's header and its tasks by phase. HR changes a running one from here (PLAN §9).
 */
export function OnboardingView({
  id,
  orgName,
  timeZone,
  hr,
}: {
  id: string;
  orgName: string;
  timeZone: string;
  hr: boolean;
}) {
  const router = useRouter();
  const { toasts, showToast, dismissToast } = useAnimatedToastStack();
  const [change, setChange] = useState<Change | null>(null);
  // Where focus goes back to when the dialog closes: its button, or the task's ⋯.
  const opener = useRef<HTMLElement | null>(null);
  const openChange = (next: Change, from: Element | null) => {
    opener.current = from instanceof HTMLElement ? from : null;
    setChange(next);
  };
  const closeChange = () => {
    setChange(null);
    opener.current?.focus();
  };
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
    // HR's changes, while it runs (PLAN §9); nobody else gets the controls.
    const changing = hr && data.status === 'ACTIVE';
    const menu = (task: Task) =>
      changing &&
      (task.status === 'PENDING' || task.status === 'IN_PROGRESS') && (
        <TaskMenu
          task={task}
          newHireId={data.employee.id}
          onPick={openChange}
        />
      );
    page =
      data.status === 'DRAFT' ? (
        <Wizard
          orgName={orgName}
          today={data.today}
          timeZone={timeZone}
          draft={data}
          onActivated={activated}
          onCancel={() =>
            openChange({ kind: 'cancel' }, document.activeElement)
          }
        />
      ) : (
        <>
          <Header
            onboarding={data}
            timeZone={timeZone}
            actions={
              changing && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    aria-haspopup="dialog"
                    onClick={(event) =>
                      openChange({ kind: 'reschedule' }, event.currentTarget)
                    }
                    className="hover:bg-foreground/5 active:bg-foreground/8"
                  >
                    <Calendar aria-hidden className="size-4" />
                    Change start date
                  </Button>
                  <Button
                    variant="ghost"
                    aria-haspopup="dialog"
                    onClick={(event) =>
                      openChange({ kind: 'cancel' }, event.currentTarget)
                    }
                    className="text-danger-strong hover:bg-foreground/5 hover:text-danger-strong active:bg-foreground/8"
                  >
                    Cancel onboarding
                  </Button>
                </div>
              )
            }
          />
          {data.invitation ? (
            // HR's view: the invitation beside the tasks, as the canvas lays it out.
            <div className="flex flex-wrap items-start gap-5">
              <div className="min-w-0 flex-[999_1_560px]">
                <Phases onboarding={data} timeZone={timeZone} menu={menu} />
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
            <Phases onboarding={data} timeZone={timeZone} menu={menu} />
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
      {data && (
        <ChangeDialog
          change={change}
          onboarding={data}
          onClose={closeChange}
          showToast={showToast}
        />
      )}
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

// The canvas's header, with HR's actions while it runs; tabs come with a second view
// (Activity in M3.4, Graph in M4.3).
function Header({
  onboarding,
  timeZone,
  actions,
}: {
  onboarding: OnboardingDetail;
  timeZone: string;
  actions: ReactNode;
}) {
  const {
    employee,
    template,
    templateVersion,
    tasks,
    startDate,
    today,
    activatedAt,
    completedAt,
    canceledAt,
    cancelReason,
  } = onboarding;
  const done = tasks.filter(({ status }) => status === 'COMPLETED').length;
  const badge = STATUS_BADGE[onboarding.status];
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-5">
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
        {actions}
      </div>
      {/* HR's reason (BR-C03); nobody else gets it. */}
      {canceledAt && cancelReason && (
        <Notice
          variant="default"
          title={`Canceled on ${formatDateIn(canceledAt, timeZone)}${activatedAt ? '' : ', before it was activated'}`}
          text={cancelReason}
        />
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
        <Stat
          label="Starts"
          // A canceled one never starts.
          note={canceledAt ? undefined : formatFromToday(today, startDate)}
        >
          <span className="font-mono">{formatDate(startDate)}</span>
        </Stat>
        <Stat
          label="Template"
          note={
            activatedAt
              ? `Version ${templateVersion.version}, locked in`
              : 'Never activated'
          }
        >
          {template.name}
        </Stat>
        <Stat
          label="Progress"
          note={
            canceledAt
              ? `Canceled ${formatDateIn(canceledAt, timeZone)}`
              : completedAt
                ? `Finished ${formatDateIn(completedAt, timeZone)}`
                : undefined
          }
          bar={
            tasks.length > 0 && (
              // The words above carry the value, as in the onboardings table.
              <div
                aria-hidden
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/6"
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(done / tasks.length) * 100}%` }}
                />
              </div>
            )
          }
        >
          {tasks.length === 0 ? (
            // A draft canceled before activation.
            <span className="font-normal text-muted-foreground">
              No tasks were created
            </span>
          ) : (
            <>
              {done} of {tasks.length}{' '}
              <span className="text-[13px] font-normal text-muted-foreground">
                done
              </span>
            </>
          )}
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

// Each phase a todo list (PLAN §10.1). One whose tasks are all done starts folded. A task
// may end with HR's ⋯ (`menu`).
function Phases({
  onboarding: { tasks },
  timeZone,
  menu,
}: {
  onboarding: OnboardingDetail;
  timeZone: string;
  menu: (task: Task) => ReactNode;
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
            detail: (
              <span className="flex items-center gap-1.5">
                <TaskBadge task={task} tasks={tasks} />
                {menu(task)}
              </span>
            ),
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
  if (status === 'CANCELED') return `${assignee.fullName} · canceled`;
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
      {/* A new start date keeps it (BR-S02), and a reset puts the template's back. */}
      {task.dueOverridden && ' · set by HR'}
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
  // Canceling turns the link off too (BR-C03).
  const canceled = status === 'CANCELED';
  const first = firstName(employee.fullName);
  const badge = acceptedAt
    ? {
        label: 'Accepted',
        status: 'success' as const,
        className: 'border-success/30 bg-success/10 text-success-strong',
      }
    : canceled && revokedAt
      ? {
          label: 'Canceled',
          status: 'neutral' as const,
          className: 'bg-background',
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
      {canceled ? (
        <p className="text-[13px] leading-5 text-muted-foreground">
          {acceptedAt
            ? `${first} was signed out when the onboarding was canceled, and can sign in again once a new onboarding of theirs is activated.`
            : `The onboarding was canceled before ${first} accepted, so this link no longer works.`}
        </p>
      ) : (
        revokedAt &&
        !acceptedAt && (
          <p className="text-[13px] leading-5 text-muted-foreground">
            {first}&apos;s email is now{' '}
            <span className="font-mono text-xs text-foreground wrap-anywhere">
              {employee.email}
            </span>
            , so this link no longer works. Resend sends a new one there.
          </p>
        )
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
