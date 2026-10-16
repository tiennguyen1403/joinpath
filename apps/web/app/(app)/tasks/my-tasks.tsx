'use client';

import {
  type Availability,
  type IsoDate,
  type MyTask,
  type MyTasks as MyTasksData,
  myTasksSchema,
  type OnboardingDetail,
  onboardingDetailSchema,
  type Task,
} from '@joinpath/core';
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { Check, Eye } from 'reicon-react';
import { cn } from '@/components/beui/lib/utils';
import {
  AnimatedToastStack,
  type ToastInput,
  useAnimatedToastStack,
} from '@/components/beui/motion/animated-toast-stack';
import { Button } from '@/components/beui/motion/button/base';
import { Tabs, TabsList, TabsTrigger } from '@/components/beui/motion/tabs';
import { EmptyState } from '@/components/empty-state';
import { Notice } from '@/components/notice';
import { TaskBadge, waitsFor } from '@/components/task-status';
import { DocumentWork, InReview, type Settle } from '@/components/task-work';
import { api, ApiError } from '@/lib/api';
import {
  capitalized,
  formatDate,
  formatDateIn,
  formatFromToday,
  inWords,
} from '@/lib/format';
import { ReviewDrawer } from './review-drawer';

/** Every task assigned to the signed-in person; the sidebar counts from it too. */
export const myTasksQuery = {
  queryKey: ['tasks', 'mine'],
  queryFn: () => api('/tasks/mine', myTasksSchema),
};

type Tab = 'todo' | 'upcoming' | 'done';
// A canceled or inactive task sits in no tab.
const TAB_OF: Partial<Record<Availability, Tab>> = {
  READY: 'todo',
  LOCKED_BY_DATE: 'upcoming',
  BLOCKED: 'upcoming',
  COMPLETED: 'done',
};
const TABS: Record<
  Tab,
  { label: string; list: string; empty: { title: string; description: string } }
> = {
  todo: {
    label: 'To do',
    list: 'Tasks to do',
    empty: {
      title: 'Nothing to do right now',
      description:
        "Tasks move here on the day they open. Upcoming shows what's next.",
    },
  },
  upcoming: {
    label: 'Upcoming',
    list: 'Upcoming tasks',
    empty: {
      title: 'Nothing coming up',
      description: 'Tasks that open later, or wait for others, show up here.',
    },
  },
  done: {
    label: 'Done',
    list: 'Done tasks',
    empty: {
      title: 'Nothing done yet',
      description: 'Tasks you finish show up here.',
    },
  },
};
const DONE: Record<Task['type'], string> = {
  CHECKLIST: 'done',
  DOCUMENT: 'submitted',
  APPROVAL: 'approved',
};
const LINK =
  'rounded-sm text-[13px] font-medium text-primary-strong outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary';
const firstName = (fullName: string) => fullName.split(' ')[0];

type Action = 'start' | 'complete';

/**
 * My Tasks (PLAN §10): tabs by availability, the tasks as cards, the one picked in full. A
 * checklist starts and completes here, a document takes its files as on the portal, and an
 * approval opens the review drawer.
 */
export function MyTasks({
  employeeId,
  timeZone,
  demo,
}: {
  employeeId: string;
  timeZone: string;
  /** In a sandbox: a document says not to upload real ones. */
  demo: boolean;
}) {
  const queryClient = useQueryClient();
  const { toasts, showToast, dismissToast } = useAnimatedToastStack();
  const [tab, setTab] = useState<Tab>('todo');
  const [picked, setPicked] = useState<string>();
  // The approval under review, kept while the drawer closes so it leaves with its content.
  const [review, setReview] = useState<{ id: string; open: boolean }>();
  const mine = useQuery(myTasksQuery);
  // Each task's onboarding, for what it waits for and unlocks; the detail page shares the cache.
  const onboardings = useQueries({
    queries: [...new Set(mine.data?.tasks.map((t) => t.onboarding.id))].map(
      (id) => ({
        queryKey: ['onboarding', id],
        queryFn: () => api(`/onboardings/${id}`, onboardingDetailSchema),
      }),
    ),
  });
  const tasksOf = new Map(
    onboardings.flatMap(({ data }) => (data ? [[data.id, data.tasks]] : [])),
  );

  // Puts a command's answer on the page, with its toast; the last task's says so instead.
  const settle: Settle = (onboarding: OnboardingDetail, toast?: ToastInput) => {
    queryClient.setQueryData(['onboarding', onboarding.id], onboarding);
    // The answer moves my tasks at once; the refetch then settles the rest.
    queryClient.setQueryData<MyTasksData>(
      myTasksQuery.queryKey,
      (old) =>
        old && {
          ...old,
          tasks: old.tasks.map((t) => ({
            ...t,
            ...onboarding.tasks.find(({ id }) => id === t.id),
          })),
        },
    );
    void queryClient.invalidateQueries({ queryKey: myTasksQuery.queryKey });
    void queryClient.invalidateQueries({ queryKey: ['onboardings'] });
    if (!toast) return;
    showToast(
      onboarding.status === 'COMPLETED'
        ? {
            status: 'success',
            title: 'Onboarding complete',
            description: `That was the last of ${onboarding.employee.fullName}'s ${onboarding.tasks.length} tasks.`,
          }
        : toast,
    );
  };
  // A refusal means the page is behind: catch it up.
  const refresh = (onboardingId: string) => {
    void queryClient.invalidateQueries({ queryKey: myTasksQuery.queryKey });
    void queryClient.invalidateQueries({
      queryKey: ['onboarding', onboardingId],
    });
  };

  const work = useMutation({
    mutationFn: ({ task, action }: { task: MyTask; action: Action }) =>
      api(`/tasks/${task.id}/${action}`, onboardingDetailSchema, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (onboarding, { task, action }) =>
      settle(
        onboarding,
        action === 'start'
          ? undefined
          : {
              status: 'success',
              title: 'Marked complete',
              description: task.title,
            },
      ),
    onError: (error, { task }) => {
      // The buttons follow availability, so a 409 means the page is behind.
      if (error instanceof ApiError && error.status === 409) {
        refresh(task.onboarding.id);
      }
    },
  });

  const data = mine.data;
  const loaded = data && onboardings.every((query) => query.data);
  const failed = mine.error ?? onboardings.find((query) => query.error)?.error;
  const byTab = Map.groupBy(data?.tasks ?? [], (t) => TAB_OF[t.availability]);
  const lists: Record<Tab, MyTask[]> = {
    // By due date, as the API sends them.
    todo: byTab.get('todo') ?? [],
    upcoming: byTab.get('upcoming') ?? [],
    // The latest done first.
    done: (byTab.get('done') ?? []).toSorted((a, b) =>
      (b.completedAt ?? '').localeCompare(a.completedAt ?? ''),
    ),
  };
  const list = lists[tab];
  const selected = list.find(({ id }) => id === picked) ?? list[0];
  const reviewed = data?.tasks.find(({ id }) => id === review?.id);
  const toDo = lists.todo.length;
  const openedToday = lists.todo.filter(
    ({ availableOn }) => availableOn === data?.today,
  ).length;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">My tasks</h1>
        {loaded && toDo > 0 && (
          <p className="leading-[23px] text-muted-foreground">
            {capitalized(inWords(toDo))} to do.
            {openedToday > 0 &&
              ` ${capitalized(inWords(openedToday))} opened today.`}
          </p>
        )}
      </div>
      {failed ? (
        <Notice
          variant="destructive"
          title="Couldn't load your tasks"
          text="Reload the page to try again."
        />
      ) : (
        loaded && (
          <div className="flex flex-col gap-5">
            <Tabs
              value={tab}
              onValueChange={(value) => setTab(value as Tab)}
              variant="underline"
            >
              <TabsList aria-label="Task filters">
                {(Object.keys(TABS) as Tab[]).map((value) => (
                  <TabsTrigger key={value} value={value} className="gap-1.5">
                    {TABS[value].label}
                    <span className="text-muted-foreground">
                      {lists[value].length}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {selected ? (
              <div className="flex flex-wrap items-start gap-5">
                <ul
                  aria-label={TABS[tab].list}
                  className="flex min-w-0 flex-[1_1_380px] flex-col gap-2"
                >
                  {list.map((task) => (
                    <li key={task.id}>
                      <Card
                        task={task}
                        tasks={tasksOf.get(task.onboarding.id)!}
                        today={data.today}
                        timeZone={timeZone}
                        selected={task.id === selected.id}
                        onSelect={() => {
                          setPicked(task.id);
                          work.reset();
                        }}
                      />
                    </li>
                  ))}
                </ul>
                <Panel
                  task={selected}
                  tasks={tasksOf.get(selected.onboarding.id)!}
                  today={data.today}
                  timeZone={timeZone}
                  employeeId={employeeId}
                  demo={demo}
                  busy={work.isPending}
                  failure={
                    work.variables?.task.id === selected.id ? work.error : null
                  }
                  failedAction={work.variables?.action}
                  onAction={(action) => work.mutate({ task: selected, action })}
                  onReview={() => setReview({ id: selected.id, open: true })}
                  settle={settle}
                  refresh={() => refresh(selected.onboarding.id)}
                />
              </div>
            ) : (
              <EmptyState {...TABS[tab].empty} />
            )}
          </div>
        )
      )}
      {data && (
        <ReviewDrawer
          open={Boolean(review?.open)}
          onOpenChange={(open) => setReview((now) => now && { ...now, open })}
          approval={reviewed}
          tasks={(reviewed && tasksOf.get(reviewed.onboarding.id)) || []}
          today={data.today}
          viewerId={employeeId}
          timeZone={timeZone}
          settle={settle}
          refresh={() => reviewed && refresh(reviewed.onboarding.id)}
        />
      )}
      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} fixed />
    </>
  );
}

function Card({
  task,
  tasks,
  today,
  timeZone,
  selected,
  onSelect,
}: {
  task: MyTask;
  tasks: Task[];
  today: IsoDate;
  timeZone: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { status, completedAt, startedAt, overdue } = task;
  return (
    <button
      type="button"
      aria-current={selected || undefined}
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-1.5 rounded-2xl border p-4 text-left transition-colors outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-primary active:bg-foreground/8',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border',
      )}
    >
      <span className="flex w-full items-start justify-between gap-3">
        <span className="text-[15px] leading-[21px] font-semibold">
          {task.title}
        </span>
        <TaskBadge task={task} tasks={tasks} done />
      </span>
      <span className="text-[13px] text-muted-foreground">
        {task.onboarding.employee.fullName} ·{' '}
        {status === 'COMPLETED' && completedAt ? (
          `done ${formatDateIn(completedAt, timeZone)}`
        ) : (
          <>
            due{' '}
            <span
              className={cn(
                'font-mono text-xs',
                overdue && 'text-danger-strong',
              )}
            >
              {formatDate(task.dueOn)}
            </span>
            {overdue && <span className="text-danger-strong"> · overdue</span>}
            {status === 'IN_PROGRESS' &&
              startedAt &&
              ` · started ${formatDateIn(startedAt, timeZone)}`}
            {status === 'PENDING' &&
              task.availability === 'READY' &&
              task.availableOn === today &&
              ' · opened today'}
          </>
        )}
      </span>
    </button>
  );
}

function Panel({
  task,
  tasks,
  today,
  timeZone,
  employeeId,
  demo,
  busy,
  failure,
  failedAction,
  onAction,
  onReview,
  settle,
  refresh,
}: {
  task: MyTask;
  tasks: Task[];
  today: IsoDate;
  timeZone: string;
  employeeId: string;
  demo: boolean;
  busy: boolean;
  failure: Error | null;
  failedAction: Action | undefined;
  onAction: (action: Action) => void;
  onReview: () => void;
  settle: Settle;
  refresh: () => void;
}) {
  const { onboarding } = task;
  const hire = onboarding.employee;
  const waitedFor = tasks.filter(({ id }) => task.dependsOn.includes(id));
  const open = waitedFor.filter(({ status }) => status !== 'COMPLETED');
  const unlocks = tasks.filter(({ dependsOn }) => dependsOn.includes(task.id));
  const steps = task.description?.split('\n').filter(Boolean) ?? [];
  const ready = task.availability === 'READY';
  // Started and completed here: a checklist (PLAN §8), once it is open.
  const workable = task.type === 'CHECKLIST' && ready;
  // A document is worked as on the portal: the same block stands for "What to do".
  const review = tasks.find(({ reviewsTaskId }) => reviewsTaskId === task.id);
  const documentBlock =
    task.type !== 'DOCUMENT' ? null : ready ? (
      <DocumentWork
        key={task.id}
        task={task}
        review={review}
        viewerId={employeeId}
        timeZone={timeZone}
        settle={settle}
        refresh={refresh}
        className="p-0 sm:pl-0"
        level={3}
        demo={demo}
      />
    ) : (
      review &&
      task.status === 'COMPLETED' &&
      review.status === 'PENDING' && (
        <InReview
          task={task}
          review={review}
          viewerId={employeeId}
          timeZone={timeZone}
          className="p-0 sm:pl-0"
          level={3}
        />
      )
    );

  return (
    <section
      aria-labelledby="task-title"
      className="flex min-w-0 flex-[999_1_520px] flex-col gap-6 rounded-2xl border border-border p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id="task-title" className="text-xl font-semibold tracking-tight">
            {task.title}
          </h2>
          <span className="leading-[22px] text-muted-foreground">
            {[
              `For ${hire.fullName}`,
              hire.jobTitle,
              `${onboarding.startDate > today ? 'starts' : 'started'} ${formatDate(onboarding.startDate)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <TaskBadge task={task} tasks={tasks} size="md" done />
      </div>

      {failure && (
        <Notice
          variant="destructive"
          title={
            failedAction === 'start'
              ? "Couldn't start it"
              : "Couldn't mark it complete"
          }
          text={
            failure instanceof ApiError
              ? failure.message
              : 'Check your connection and try again.'
          }
        />
      )}
      <StatusNote
        task={task}
        tasks={tasks}
        open={open.length}
        today={today}
        timeZone={timeZone}
      />

      {documentBlock ||
        (steps.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <h3 className="text-[15px] leading-[21px] font-semibold">
              What to do
            </h3>
            {steps.length === 1 ? (
              <p>{steps[0]}</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {steps.map((step, i) => (
                  <li
                    key={step}
                    className="flex gap-3 rounded-xl bg-card px-3.5 py-3"
                  >
                    <span className="pt-px font-mono text-xs text-muted-foreground">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}

      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3">
        <dt className="text-muted-foreground">Due</dt>
        <dd className={cn(task.overdue && 'text-danger-strong')}>
          <span className="font-mono text-[13px]">
            {formatDate(task.dueOn)}
          </span>{' '}
          <span className={cn(!task.overdue && 'text-muted-foreground')}>
            · {formatFromToday(today, task.dueOn)}
          </span>
        </dd>
        {waitedFor.length > 0 && (
          <>
            <dt className="text-muted-foreground">
              {open.length ? 'Waits for' : 'Waited for'}
            </dt>
            <dd className="flex flex-col gap-1">
              {waitedFor.map((before) =>
                before.status === 'COMPLETED' ? (
                  <span key={before.id} className="flex items-center gap-2">
                    <Check
                      aria-hidden
                      className="size-3.5 shrink-0 text-success-strong"
                    />
                    {before.title}, {DONE[before.type]}
                  </span>
                ) : (
                  <span key={before.id}>
                    {before.title}{' '}
                    <span className="text-muted-foreground">
                      · {before.assignee.fullName}, due{' '}
                      {formatDate(before.dueOn)}
                    </span>
                  </span>
                ),
              )}
            </dd>
          </>
        )}
        {unlocks.length > 0 && (
          <>
            <dt className="text-muted-foreground">Unlocks</dt>
            <dd className="flex flex-col gap-1">
              {unlocks.map((next) => (
                <span key={next.id}>
                  {next.title}{' '}
                  <span className="text-muted-foreground">
                    ·{' '}
                    {next.assignee.id === employeeId
                      ? 'you'
                      : firstName(next.assignee.fullName)}
                    {next.availableOn > today &&
                      `, on ${formatDate(next.availableOn)}`}
                  </span>
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <a href={`/onboardings/${onboarding.id}`} className={LINK}>
          See where it sits in {firstName(hire.fullName)}&apos;s onboarding
        </a>
        {task.type === 'APPROVAL' && ready && (
          <Button
            // White on the strong primary (ADR 009), as Mark complete.
            className="bg-primary-strong hover:bg-primary-strong/90"
            onClick={onReview}
          >
            <Eye aria-hidden className="size-4" />
            Review documents
          </Button>
        )}
        {workable && (
          <div className="flex flex-wrap gap-2">
            {task.status === 'PENDING' && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => onAction('start')}
              >
                Start working
              </Button>
            )}
            <Button
              // White on the strong primary (ADR 009), as the wizard's Activate.
              className="bg-primary-strong hover:bg-primary-strong/90"
              disabled={busy}
              onClick={() => onAction('complete')}
            >
              <Check aria-hidden className="size-4" />
              Mark complete
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

// Why the task is where it is: done, opening later, waiting, or opened this morning.
function StatusNote({
  task,
  tasks,
  open,
  today,
  timeZone,
}: {
  task: MyTask;
  tasks: Task[];
  open: number;
  today: IsoDate;
  timeZone: string;
}) {
  if (task.status === 'COMPLETED' && task.completedAt) {
    return (
      <Notice
        variant="success"
        title={`Done on ${formatDateIn(task.completedAt, timeZone)}`}
      />
    );
  }
  switch (task.availability) {
    case 'LOCKED_BY_DATE':
      return (
        <Notice
          variant="default"
          title={`Opens ${formatDate(task.availableOn)}`}
          text={`That's ${formatFromToday(today, task.availableOn)}. You can start it then.`}
        />
      );
    case 'BLOCKED':
      return (
        <Notice
          variant="warning"
          title={`Waits for ${waitsFor(task, tasks)}`}
          text={`It opens once the ${open === 1 ? 'task below is' : 'tasks below are'} done.`}
        />
      );
    case 'READY':
      return task.availableOn === today ? (
        <Notice
          variant="info"
          title="Opened today"
          text={`Its start date arrived this morning${task.dependsOn.length ? ', and everything it waited for is done' : ''}.`}
        />
      ) : null;
    default:
      return null;
  }
}
