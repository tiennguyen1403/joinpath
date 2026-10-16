'use client';

import {
  type Employee,
  employeeSchema,
  type OnboardingDetail,
  onboardingDetailSchema,
  type Task,
} from '@joinpath/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Check, Clock, More, User, XCircle } from 'reicon-react';
import { Avatar, tintOf } from '@/components/avatar';
import { cn } from '@/components/beui/lib/utils';
import type { ToastInput } from '@/components/beui/motion/animated-toast-stack';
import { Button } from '@/components/beui/motion/button/base';
import {
  CenterMorphModal,
  CenterMorphModalContent,
} from '@/components/beui/motion/center-morph-modal';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from '@/components/beui/motion/context-menu';
import {
  DateRangePicker,
  DateRangePickerCalendar,
  DateRangePickerGrid,
  DateRangePickerHeader,
} from '@/components/beui/motion/date-range-picker';
import { Input } from '@/components/beui/motion/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/beui/motion/select';
import { Notice, TINTED_DANGER } from '@/components/notice';
import { api, ApiError, messageOf } from '@/lib/api';
import {
  daysBetween,
  firstName,
  formatDate,
  formatDateLong,
  formatFromToday,
  formatShift,
} from '@/lib/format';
import { PRIMARY } from './wizard';

/** One of HR's changes to an onboarding (PLAN §8), each in its own dialog. */
export type Change =
  { kind: 'reschedule' | 'cancel' } | { kind: 'reassign' | 'due'; task: Task };

const isOpen = ({ status }: Task) =>
  status === 'PENDING' || status === 'IN_PROGRESS';
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;
// "An", "An and Duc", "An, Duc and Huy".
const listed = (names: string[]) =>
  names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * HR's ⋯ on a task not done: hand it to someone else, or move its deadline (BR-S03, BR-S04).
 * A new hire's own task stays theirs, so it has no Reassign.
 */
export function TaskMenu({
  task,
  newHireId,
  onPick,
}: {
  task: Task;
  newHireId: string;
  // The button, for the dialog to give focus back to.
  onPick: (change: Change, opener: HTMLElement | null) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  return (
    <ContextMenu>
      <ContextMenuTrigger openOnClick>
        <button
          ref={button}
          type="button"
          aria-label={`More actions for ${task.title}`}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-primary active:bg-foreground/8 aria-expanded:bg-foreground/8 aria-expanded:text-foreground"
        >
          <More aria-hidden className="size-4" />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent ariaLabel="Task actions">
        <ContextMenuLabel className="max-w-64 truncate">
          {task.title}
        </ContextMenuLabel>
        {task.assignee.id !== newHireId && (
          <ContextMenuItem
            onSelect={() => onPick({ kind: 'reassign', task }, button.current)}
          >
            <User aria-hidden className="size-3.5" />
            Reassign…
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onSelect={() => onPick({ kind: 'due', task }, button.current)}
        >
          <Clock aria-hidden className="size-3.5" />
          Change due date…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The dialog of the change HR picked, or none. The answer replaces the onboarding everywhere
 * and a toast says what changed. A 400 stays in the dialog to fix; anything else means the
 * page is behind (409) or the API out of reach: the dialog closes on a toast and the page
 * reloads.
 */
export function ChangeDialog({
  change,
  onboarding,
  onClose,
  showToast,
}: {
  change: Change | null;
  onboarding: OnboardingDetail;
  onClose: () => void;
  showToast: (toast: ToastInput) => void;
}) {
  const queryClient = useQueryClient();
  // The modal re-runs its focus and scroll effect whenever this callback changes, so it
  // stays the same function for the life of the dialog.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  const onOpenChange = useCallback((open: boolean) => {
    if (!open) close.current();
  }, []);

  const settle: Settle = {
    done: (next, toast) => {
      queryClient.setQueryData(['onboarding', next.id], next);
      void queryClient.invalidateQueries({ queryKey: ['onboardings'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'mine'] });
      onClose();
      showToast(toast);
    },
    failed: (title, error) => {
      onClose();
      showToast({ status: 'error', title, description: messageOf(error) });
      void queryClient.invalidateQueries({
        queryKey: ['onboarding', onboarding.id],
      });
    },
    cancel: onClose,
  };

  let title = '';
  let content: ReactNode = null;
  switch (change?.kind) {
    case 'reschedule':
      title = 'Change the start date';
      content = <Reschedule onboarding={onboarding} settle={settle} />;
      break;
    case 'cancel':
      title = `Cancel ${onboarding.employee.fullName}'s onboarding?`;
      content = <Cancel onboarding={onboarding} settle={settle} />;
      break;
    case 'reassign':
      title = `Reassign ${change.task.title}`;
      content = (
        <Reassign onboarding={onboarding} task={change.task} settle={settle} />
      );
      break;
    case 'due':
      title = 'Change the due date';
      content = (
        <DueDate onboarding={onboarding} task={change.task} settle={settle} />
      );
      break;
  }

  return (
    <CenterMorphModal open={change !== null} onOpenChange={onOpenChange}>
      <CenterMorphModalContent
        ariaLabel={title}
        closeButtonLabel="Close"
        // The drawer's scrim (Foundations).
        backdropClassName="bg-black/40"
      >
        <div className="flex flex-col gap-4.5 p-6">
          <h2 className="pr-10 text-xl leading-7 font-semibold tracking-tight">
            {title}
          </h2>
          {content}
        </div>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}

type Settle = {
  done: (onboarding: OnboardingDetail, toast: ToastInput) => void;
  failed: (title: string, error: unknown) => void;
  cancel: () => void;
};

/** POSTs a change; a 400 is left for the dialog to show. */
function useChange<Body>(
  path: string,
  refused: string,
  settle: Settle,
  toastOf: (onboarding: OnboardingDetail, body: Body) => ToastInput,
) {
  const change = useMutation({
    mutationFn: (body: Body) =>
      api(path, onboardingDetailSchema, { method: 'POST', body }),
    onSuccess: (onboarding, body) =>
      settle.done(onboarding, toastOf(onboarding, body)),
    onError: (error) => {
      if (!(error instanceof ApiError && error.status === 400)) {
        settle.failed(refused, error);
      }
    },
  });
  const notice = change.error instanceof ApiError &&
    change.error.status === 400 && (
      <Notice
        variant="destructive"
        title={refused}
        text={change.error.message}
      />
    );
  return { ...change, notice };
}

const Sub = ({ children }: { children: ReactNode }) => (
  <p className="-mt-3 text-[13px] leading-5 text-muted-foreground">
    {children}
  </p>
);

const Mono = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-xs">{children}</span>
);

// The new date in full, and what it means, under the calendar.
const Picked = ({ date, note }: { date: string; note: string }) => (
  <div className="flex flex-col gap-0.5">
    <span className="font-mono text-[15px] font-medium">
      {formatDateLong(date)}
    </span>
    <span className="text-muted-foreground">{note}</span>
  </div>
);

export function Lines({
  title,
  lines,
}: {
  title?: string;
  lines: { text: string; gone?: boolean }[];
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {title && <span className="text-[13px] font-medium">{title}</span>}
      <ul className="flex flex-col gap-2 text-[13px] leading-5 text-muted-foreground">
        {lines.map(({ text, gone }) => (
          <li key={text} className="flex gap-2">
            {gone ? (
              <XCircle
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-danger-strong"
              />
            ) : (
              <Check
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-success-strong"
              />
            )}
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}

// BR-S01, BR-S02: the tasks not done move with the start date; a deadline HR set stays,
// unless its task would open after it.
function Reschedule({
  onboarding,
  settle,
}: {
  onboarding: OnboardingDetail;
  settle: Settle;
}) {
  const { id, employee, startDate, today, tasks } = onboarding;
  const [date, setDate] = useState(startDate);
  const first = firstName(employee.fullName);
  const open = tasks.filter(isOpen);
  const done = tasks.filter(({ status }) => status === 'COMPLETED').length;
  const set = open.filter(({ dueOverridden }) => dueOverridden).length;
  const shift = daysBetween(startDate, date);
  const change = useChange<{ startDate: string }>(
    `/onboardings/${id}/reschedule`,
    "Couldn't change the start date",
    settle,
    (next) => {
      const reset = next.tasks.filter(
        (task) =>
          !task.dueOverridden &&
          tasks.find(({ id }) => id === task.id)?.dueOverridden,
      ).length;
      return {
        status: 'success',
        title: 'Start date changed',
        description: `${first} starts ${formatDate(next.startDate)}. ${plural(open.length, 'open task', 'open tasks')} moved with it${
          reset === 0
            ? ''
            : reset === 1
              ? ", and the due date HR set went back to the template's"
              : `, and ${reset} due dates HR set went back to the template's`
        }.`,
      };
    },
  );

  return (
    <>
      <Sub>
        {first} starts <Mono>{formatDate(startDate)}</Mono> now. Task dates
        count from the start date.
      </Sub>
      <DateRangePicker
        single
        today={today}
        label="Start date"
        value={{ from: date, to: date }}
        onValueChange={(range) => range && setDate(range.from)}
      >
        <DateRangePickerCalendar>
          <DateRangePickerHeader />
          <DateRangePickerGrid />
        </DateRangePickerCalendar>
      </DateRangePicker>
      {shift !== 0 && (
        <>
          <Picked
            date={date}
            note={`${formatShift(shift)} · ${formatFromToday(today, date)}`}
          />
          {/* A past date is allowed, as in the wizard: the tasks start out overdue. */}
          {date < today && (
            <Notice
              variant="warning"
              title="The new date has passed"
              text="Tasks due before today start out overdue."
            />
          )}
          <Lines
            title="When you change it"
            lines={[
              {
                text: `${plural(open.length, 'open task moves', 'open tasks move')} ${formatShift(shift)}, due dates with them`,
              },
              ...(set === 0
                ? []
                : [
                    {
                      text:
                        set === 1
                          ? 'The due date HR set stays, unless its task would now open after it'
                          : 'The due dates HR set stay, unless a task would now open after its date',
                    },
                  ]),
              ...(done === 0
                ? []
                : [
                    {
                      text: `${plural(done, 'done task keeps its', 'done tasks keep their')} dates`,
                    },
                  ]),
            ]}
          />
        </>
      )}
      {change.notice}
      <Button
        size="lg"
        className={PRIMARY}
        disabled={shift === 0 || change.isPending}
        onClick={() => change.mutate({ startDate: date })}
      >
        {change.isPending ? 'Changing…' : 'Change start date'}
      </Button>
    </>
  );
}

// BR-C03: HR says why. A draft has nothing else to stop.
function Cancel({
  onboarding,
  settle,
}: {
  onboarding: OnboardingDetail;
  settle: Settle;
}) {
  const { id, employee, status, tasks, invitation } = onboarding;
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const first = firstName(employee.fullName);
  const draft = status === 'DRAFT';
  const open = tasks.filter(isOpen).length;
  const done = tasks.filter((task) => task.status === 'COMPLETED').length;
  // What HR sees of the invitation; an account from another onboarding's is locked too.
  const linkLive =
    invitation && !invitation.acceptedAt && !invitation.revokedAt;
  const signedIn = Boolean(invitation?.acceptedAt);
  const change = useChange<{ reason: string }>(
    `/onboardings/${id}/cancel`,
    "Couldn't cancel the onboarding",
    settle,
    () => ({
      status: 'success',
      title: 'Onboarding canceled',
      description: draft
        ? 'It stays in the list as Canceled.'
        : `${plural(open, 'open task was', 'open tasks were')} canceled${
            signedIn
              ? `, and ${first} was signed out`
              : linkLive
                ? `, and ${first}'s link no longer works`
                : ''
          }.`,
    }),
  );

  return (
    <>
      <Sub>
        {draft
          ? `It's still a draft: no tasks or invitation were created. It stays in the list as Canceled, and you can start a new one for ${first}.`
          : `It can't be resumed. You can start a new onboarding for ${first} later.`}
      </Sub>
      {!draft && (
        <Lines
          lines={[
            {
              text: `${plural(open, 'open task is', 'open tasks are')} canceled, and nobody can work on ${open === 1 ? 'it' : 'them'}`,
              gone: true,
            },
            ...(linkLive
              ? [
                  {
                    text: `${first}'s invitation link stops working`,
                    gone: true,
                  },
                ]
              : []),
            ...(signedIn
              ? [
                  {
                    text: `${first} is signed out and can't sign in until a new onboarding of theirs is activated`,
                    gone: true,
                  },
                ]
              : []),
            {
              text:
                done === 0
                  ? `${first}'s files and the history stay`
                  : `${plural(done, 'done task', 'done tasks')}, ${first}'s files and the history stay`,
            },
          ]}
        />
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={reasonId} className="text-[13px] font-medium">
          Why are you canceling?{' '}
          <span className="font-normal text-muted-foreground">
            · only HR sees this
          </span>
        </label>
        <Input
          id={reasonId}
          value={reason}
          onChange={(value) => {
            setReason(value);
            setMissing(false);
          }}
          placeholder={`For example, ${first} took another offer`}
          maxLength={1000}
          disabled={change.isPending}
          error={missing && "Say why you're canceling"}
          classNames={{
            field: 'h-10 rounded-xl',
            input: 'px-3 text-sm',
            errorMessage: 'text-danger-strong',
          }}
        />
      </div>
      {change.notice}
      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          className={TINTED_DANGER}
          disabled={change.isPending}
          onClick={() => {
            const why = reason.trim();
            if (why) change.mutate({ reason: why });
            else setMissing(true);
          }}
        >
          {change.isPending ? 'Canceling…' : 'Cancel onboarding'}
        </Button>
        <Button
          variant="secondary"
          className="hover:bg-foreground/5 active:bg-foreground/8"
          onClick={settle.cancel}
        >
          {draft ? 'Keep draft' : 'Keep onboarding'}
        </Button>
      </div>
    </>
  );
}

// BR-S04, BR-R01: anyone with an active account but the new hire and whoever has it now;
// never an approval to whoever uploads its document, nor the document to its approver.
function Reassign({
  onboarding: { employee: newHire, tasks },
  task,
  settle,
}: {
  onboarding: OnboardingDetail;
  task: Task;
  settle: Settle;
}) {
  const staff = useQuery({
    queryKey: ['employees', 'active'],
    queryFn: () => api('/employees?active=true', employeeSchema.array()),
  });
  const [pick, setPick] = useState<string>();
  const now = task.assignee;
  const pair =
    task.type === 'APPROVAL'
      ? tasks.find(({ id }) => id === task.reviewsTaskId)
      : tasks.find(({ reviewsTaskId }) => reviewsTaskId === task.id);
  const barred = [newHire, now, ...(pair ? [pair.assignee] : [])].filter(
    (person, i, all) => all.findIndex(({ id }) => id === person.id) === i,
  );
  const people = (staff.data ?? []).filter(
    ({ id }) => !barred.some((person) => person.id === id),
  );
  const picked = people.find(({ id }) => id === pick);
  const change = useChange<{ employeeId: string }>(
    `/tasks/${task.id}/reassign`,
    "Couldn't reassign it",
    settle,
    (next) => {
      const { fullName } = next.tasks.find(
        ({ id }) => id === task.id,
      )!.assignee;
      return {
        status: 'success',
        title: `Reassigned to ${fullName}`,
        description: `${task.title} is in ${firstName(fullName)}'s My tasks now.`,
      };
    },
  );

  return (
    <>
      <Sub>
        {task.phaseName} ·{task.status === 'IN_PROGRESS' && ' in progress ·'}{' '}
        due <Mono>{formatDate(task.dueOn)}</Mono>
      </Sub>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Now with</span>
        <Person
          person={
            staff.data?.find(({ id }) => id === now.id) ?? {
              ...now,
              jobTitle: '',
            }
          }
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium" aria-hidden>
          Give it to
        </span>
        <Select value={pick ?? ''} onValueChange={setPick}>
          <SelectTrigger className="h-10 rounded-xl border-foreground/12 py-1.5 pr-3 pl-1.5">
            <span className="sr-only">Give it to: </span>
            {picked ? (
              <span className="flex items-center gap-2 whitespace-nowrap">
                <Avatar
                  name={picked.fullName}
                  className={cn(
                    'size-5.5 text-[10px]',
                    tintOf(picked.id, picked.user?.role),
                  )}
                />
                {picked.fullName}
              </span>
            ) : (
              <span className="pl-1.5 text-muted-foreground">Pick someone</span>
            )}
          </SelectTrigger>
          {/* Inside the dialog's clip: a long list scrolls. */}
          <SelectContent className="max-h-44 overflow-auto">
            {people.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar
                    name={person.fullName}
                    className={cn(
                      'size-5.5 text-[10px]',
                      tintOf(person.id, person.user?.role),
                    )}
                  />
                  <span className="min-w-0 truncate text-foreground">
                    {person.fullName}
                  </span>
                  <span className="shrink-0 text-xs whitespace-nowrap">
                    {roleOf(person)}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs leading-4 text-muted-foreground">
          {staff.error
            ? `Couldn't load who can take it. ${messageOf(staff.error)}`
            : `Everyone with an account, but ${listed(barred.map(({ fullName }) => firstName(fullName)))}.`}
        </span>
      </div>
      <p className="text-[13px] leading-5 text-muted-foreground">
        It moves as it is
        {task.status === 'IN_PROGRESS' ? ', in progress' : ''} and due{' '}
        <Mono>{formatDate(task.dueOn)}</Mono>. {firstName(now.fullName)} no
        longer sees it in My tasks.
        {task.type === 'DOCUMENT' && ' The files uploaded so far go with it.'}
      </p>
      {change.notice}
      <Button
        size="lg"
        className={PRIMARY}
        disabled={!picked || change.isPending}
        onClick={() => picked && change.mutate({ employeeId: picked.id })}
      >
        {change.isPending ? 'Reassigning…' : 'Reassign'}
      </Button>
    </>
  );
}

// As the wizard's owner list says it: a member by their job, anyone else by their role.
const roleOf = ({
  user,
  jobTitle,
}: {
  user?: Employee['user'];
  jobTitle: string;
}) => (user?.role === 'MEMBER' || !user ? jobTitle : user.role);

function Person({
  person,
}: {
  person: Pick<Employee, 'id' | 'fullName' | 'jobTitle'> &
    Partial<Pick<Employee, 'user'>>;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar
        name={person.fullName}
        className={cn(
          'size-7 text-[11px]',
          tintOf(person.id, person.user?.role),
        )}
      />
      <div className="flex min-w-0 flex-col">
        <span>{person.fullName}</span>
        {roleOf(person) && (
          <span className="text-xs leading-4 text-muted-foreground">
            {roleOf(person)}
          </span>
        )}
      </div>
    </div>
  );
}

// BR-S03: no sooner than the task opens. A date HR set can go back to the template's.
function DueDate({
  onboarding: { today },
  task,
  settle,
}: {
  onboarding: OnboardingDetail;
  task: Task;
  settle: Settle;
}) {
  const [date, setDate] = useState(task.dueOn);
  const shift = daysBetween(task.dueOn, date);
  const change = useChange<{ dueOn: string | null }>(
    `/tasks/${task.id}/due-date`,
    "Couldn't change the due date",
    settle,
    (next, { dueOn }) => {
      const now = next.tasks.find(({ id }) => id === task.id)!.dueOn;
      return dueOn === null
        ? {
            status: 'success',
            title: 'Due date reset',
            description: `${task.title} is due ${formatDate(now)} again, as the template sets it.`,
          }
        : {
            status: 'success',
            title: 'Due date changed',
            description: `${task.title} is due ${formatDate(now)}. A new start date keeps it.`,
          };
    },
  );

  return (
    <>
      <Sub>
        {task.title} · {task.assignee.fullName} · opens{' '}
        <Mono>{formatDate(task.availableOn)}</Mono>, so it can&apos;t be due
        sooner
      </Sub>
      <DateRangePicker
        single
        today={today}
        min={task.availableOn}
        label="Due date"
        value={{ from: date, to: date }}
        onValueChange={(range) => range && setDate(range.from)}
      >
        <DateRangePickerCalendar>
          <DateRangePickerHeader />
          <DateRangePickerGrid />
        </DateRangePickerCalendar>
      </DateRangePicker>
      {(shift !== 0 || task.dueOverridden) && (
        <div className="flex flex-wrap items-end justify-between gap-2">
          {shift !== 0 ? (
            <Picked
              date={date}
              note={`${formatShift(shift)} · ${task.dueOverridden ? 'HR' : 'the template'} set ${formatDate(task.dueOn)}`}
            />
          ) : (
            <span className="text-muted-foreground">
              HR set <Mono>{formatDate(task.dueOn)}</Mono>
            </span>
          )}
          {task.dueOverridden && (
            <button
              type="button"
              disabled={change.isPending}
              onClick={() => change.mutate({ dueOn: null })}
              className="rounded-sm text-[13px] font-medium text-primary-strong outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              Use the template&apos;s date
            </button>
          )}
        </div>
      )}
      {change.notice}
      <Button
        size="lg"
        className={PRIMARY}
        disabled={shift === 0 || change.isPending}
        onClick={() => change.mutate({ dueOn: date })}
      >
        {change.isPending && change.variables?.dueOn !== null
          ? 'Changing…'
          : 'Change due date'}
      </Button>
    </>
  );
}
