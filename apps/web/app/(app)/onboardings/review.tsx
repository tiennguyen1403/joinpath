'use client';

import {
  activationPreviewSchema,
  type AssigneeProblem,
  type Employee,
  employeeSchema,
  type IsoDate,
  type OnboardingDetail,
  onboardingDetailSchema,
  type PlannedTask,
  type Role,
  type TaskDef,
  unresolvedAssigneesSchema,
} from '@joinpath/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import {
  ArrowRight,
  Check,
  Clock,
  DocumentText,
  Eye,
  ListCheck,
} from 'reicon-react';
import { Avatar, tintOf } from '@/components/avatar';
import { cn } from '@/components/beui/lib/utils';
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  type AlertVariant,
} from '@/components/beui/motion/alert';
import { AnimatedBadge } from '@/components/beui/motion/animated-badge';
import { Button, ButtonLink } from '@/components/beui/motion/button/base';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/beui/motion/select';
import { Table, Td, Th, THead, Tr } from '@/components/table';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatMonthDay } from '@/lib/format';
import { Divider, NewHire, PRIMARY, type Step, WizardFrame } from './wizard';

// Small counts read as words, as the canvas writes them: "Two people have the IT role".
const WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];
export const inWords = (n: number) => WORDS[n] ?? String(n);
export const capitalized = (text: string) =>
  text[0].toUpperCase() + text.slice(1);
const countTasks = (n: number) => `${inWords(n)} ${n === 1 ? 'task' : 'tasks'}`;

const TYPES: Record<
  TaskDef['type'],
  { label: string; icon: typeof ListCheck }
> = {
  CHECKLIST: { label: 'Checklist', icon: ListCheck },
  DOCUMENT: { label: 'Document', icon: DocumentText },
  APPROVAL: { label: 'Approval', icon: Eye },
};

const without = <T,>(record: Record<string, T>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/**
 * Step 3: what activation creates, by phase. HR picks an owner where the template's rule
 * finds several people or none, and may hand any task but the new hire's own to someone
 * else (PLAN §4.7). The picks stay here until activate, which checks them (422).
 */
export function Review({
  draft,
  onBack,
  onActivated,
}: {
  draft: OnboardingDetail;
  onBack: (step: Step) => void;
  onActivated: (onboarding: OnboardingDetail) => void;
}) {
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['preview', draft.id],
    queryFn: () =>
      api(
        `/onboardings/${draft.id}/activation-preview`,
        activationPreviewSchema,
      ),
  });
  // Who can take a task: everyone with an active account (PLAN §4.7).
  const staff = useQuery({
    queryKey: ['employees', 'active'],
    queryFn: () => api('/employees?active=true', employeeSchema.array()),
  });
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [refused, setRefused] = useState<Record<string, AssigneeProblem>>({});
  const [newVersion, setNewVersion] = useState(false);

  const activate = useMutation({
    mutationFn: (templateVersionId: string) =>
      api(`/onboardings/${draft.id}/activate`, onboardingDetailSchema, {
        method: 'POST',
        body: { templateVersionId, assignees: picks },
      }),
    // Each try starts clean: its own answer decides what to mark.
    onMutate: () => {
      setRefused({});
      setNewVersion(false);
    },
    onSuccess: (onboarding) => {
      queryClient.setQueryData(['onboarding', draft.id], onboarding);
      queryClient.removeQueries({ queryKey: ['preview', draft.id] });
      void queryClient.invalidateQueries({ queryKey: ['onboardings'] });
      onActivated(onboarding);
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      const { code, details } = error.body;
      if (code === 'ASSIGNEE_UNRESOLVED') {
        setRefused(
          Object.fromEntries(
            unresolvedAssigneesSchema
              .parse(details)
              .map(({ taskKey, problem }) => [taskKey, problem]),
          ),
        );
      } else if (code === 'TEMPLATE_VERSION_CHANGED') {
        setNewVersion(true);
        void preview.refetch();
      } else if (code === 'INVALID_STATE') {
        // Activated or changed elsewhere meanwhile: show it as it is now.
        void queryClient.invalidateQueries({
          queryKey: ['onboarding', draft.id],
        });
      }
    },
  });

  // A pick of the rule's own choice is no pick at all.
  function pick(task: PlannedTask, employeeId: string | undefined) {
    setPicks((current) =>
      employeeId === undefined || employeeId === task.assigneeId
        ? without(current, task.key)
        : { ...current, [task.key]: employeeId },
    );
    setRefused((current) => without(current, task.key));
  }

  const plan = preview.data;
  const onboarding = plan?.onboarding ?? draft;
  const today = plan?.today ?? draft.today;
  const people = staff.data ?? [];
  const roleOf = (id: string) => people.find((e) => e.id === id)?.user?.role;
  const ownerOf = (task: PlannedTask) => picks[task.key] ?? task.assigneeId;
  const titles = new Map(plan?.tasks.map((task) => [task.key, task.title]));

  const phases = [
    ...Map.groupBy(plan?.tasks ?? [], (task) => task.phaseOrder),
  ].toSorted(([a], [b]) => a - b);

  const error =
    activate.error instanceof ApiError &&
    !['ASSIGNEE_UNRESOLVED', 'TEMPLATE_VERSION_CHANGED'].includes(
      activate.error.body.code,
    )
      ? activate.error.message
      : activate.error && !(activate.error instanceof ApiError)
        ? 'Check your connection and try again.'
        : undefined;

  return (
    <WizardFrame
      step={3}
      onBack={onBack}
      title="Review and activate"
      description="Nothing is created until you activate. Check every owner and date first."
      wide
      aside={
        <>
          <NewHire
            employee={onboarding.employee}
            role={roleOf(onboarding.employee.id)}
            template={{
              name: onboarding.template.name,
              version: onboarding.templateVersion.version,
            }}
            startDate={onboarding.startDate}
            today={today}
          />
          <Divider />
          {plan && (
            <div className="flex flex-col gap-2.5">
              <span className="text-[13px] font-medium">When you activate</span>
              <ul className="flex flex-col gap-2 text-[13px] leading-5 text-muted-foreground">
                {[
                  `${plan.tasks.length} tasks are created for ${
                    new Set(plan.tasks.map(ownerOf).filter(Boolean)).size
                  } people, all at once`,
                  opensToday(plan.tasks, today),
                  `Version ${onboarding.templateVersion.version} is locked in, even if the template changes later`,
                ].map((line) => (
                  <li key={line} className="flex gap-2">
                    <Check
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-success-strong"
                    />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              className={PRIMARY}
              disabled={!plan || activate.isPending}
              onClick={() =>
                plan && activate.mutate(plan.onboarding.templateVersion.id)
              }
            >
              Activate onboarding
            </Button>
            <ButtonLink href="/onboardings" variant="secondary">
              Save as draft
            </ButtonLink>
            {Object.keys(picks).length > 0 && (
              <p className="text-center text-xs leading-4 text-muted-foreground">
                Owner picks aren&apos;t saved with the draft.
              </p>
            )}
          </div>
        </>
      }
    >
      {preview.error && (
        <Notice
          variant="destructive"
          title="Couldn't load the review"
          text={
            preview.error instanceof ApiError
              ? preview.error.message
              : 'Reload the page to try again.'
          }
        />
      )}
      {error && (
        <Notice
          variant="destructive"
          title="Couldn't activate the onboarding"
          text={error}
        />
      )}
      {Object.keys(refused).length > 0 && (
        <Notice
          variant="destructive"
          title={`${capitalized(countTasks(Object.keys(refused).length))} still need an owner`}
          text="Pick someone for each task marked below, then activate again."
        />
      )}
      {newVersion && plan && (
        <Notice
          variant="info"
          title={`${onboarding.template.name} has a new version`}
          text={`Version ${onboarding.templateVersion.version} was published while you were reviewing. The tasks below now come from version ${onboarding.templateVersion.version}, so check them before you activate.`}
        />
      )}
      {plan && staff.data && (
        <>
          <PlanNotices
            plan={plan.tasks}
            newHire={onboarding.employee}
            startDate={onboarding.startDate}
            today={today}
          />
          {phases.map(([order, phase]) => (
            <section
              key={order}
              aria-labelledby={`phase-${order}`}
              className="flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                <h2
                  id={`phase-${order}`}
                  className="text-[15px] leading-[21px] font-semibold"
                >
                  {phase[0].phaseName}
                </h2>
                <span className="font-mono text-xs text-muted-foreground">
                  {phase.length} {phase.length === 1 ? 'task' : 'tasks'} ·{' '}
                  {phaseDates(phase, onboarding.startDate)}
                </span>
              </div>
              {/* No sideways scroll, which would cut off an owner's panel. */}
              <Table scroll={false}>
                <THead>
                  <Th>Task</Th>
                  <Th>Owner</Th>
                  <Th>Opens</Th>
                  <Th>Due</Th>
                  <Th>Waits for</Th>
                </THead>
                <tbody>
                  {phase
                    .toSorted((a, b) => a.position - b.position)
                    .map((task) => (
                      <Row
                        key={task.key}
                        task={task}
                        pick={picks[task.key]}
                        refused={refused[task.key]}
                        newHire={onboarding.employee}
                        staff={people}
                        waitsFor={task.dependsOn
                          .map((key) => titles.get(key))
                          .join(', ')}
                        today={today}
                        onPick={pick}
                      />
                    ))}
                </tbody>
              </Table>
            </section>
          ))}
        </>
      )}
    </WizardFrame>
  );
}

function Notice({
  variant,
  title,
  text,
}: {
  variant: AlertVariant;
  title: string;
  text: string;
}) {
  return (
    <Alert
      variant={variant}
      className={
        {
          default: '',
          success: '',
          info: 'bg-primary/7 text-primary-strong',
          warning: 'bg-warning/7 text-warning-strong',
          destructive: 'bg-destructive/7 text-danger-strong',
        }[variant]
      }
    >
      <AlertIcon />
      <AlertContent>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          {text}
        </AlertDescription>
      </AlertContent>
    </Alert>
  );
}

// What the plan itself asks of HR before activating: owners to pick, dates already past.
function PlanNotices({
  plan,
  newHire,
  startDate,
  today,
}: {
  plan: PlannedTask[];
  newHire: OnboardingDetail['employee'];
  startDate: IsoDate;
  today: IsoDate;
}) {
  const notices: ReactNode[] = [];
  const open = plan.filter(({ problem }) => problem);
  const others = (some: PlannedTask[]) =>
    open.length === some.length ? ' Everything else resolved on its own.' : '';

  for (const role of ['HR', 'IT'] as const) {
    const ofRole = (problem: AssigneeProblem) =>
      plan.filter(
        (task) =>
          task.problem === problem &&
          task.assignee.kind === 'ROLE' &&
          task.assignee.role === role,
      );
    const several = ofRole('PICK_NEEDED');
    if (several.length) {
      notices.push(
        <Notice
          key={`several-${role}`}
          variant="warning"
          title={`${capitalized(inWords(several[0].candidates.length))} people have the ${role} role`}
          text={`The template assigns ${countTasks(several.length)} to ${role}, so pick who does each one.${others(several)}`}
        />,
      );
    }
    const nobody = ofRole('NO_CANDIDATE');
    if (nobody.length) {
      notices.push(
        <Notice
          key={`nobody-${role}`}
          variant="warning"
          title={`Nobody else has the ${role} role`}
          text={`The template gives ${countTasks(nobody.length)} to ${role}. Pick who does each one.`}
        />,
      );
    }
  }
  const managerless = plan.filter(
    (task) =>
      task.problem === 'NO_CANDIDATE' &&
      task.assignee.kind === 'DIRECT_MANAGER',
  );
  if (managerless.length) {
    notices.push(
      <Notice
        key="manager"
        variant="warning"
        title={
          newHire.manager
            ? `${newHire.manager.fullName} has no active account`
            : `${newHire.fullName} has no manager on file`
        }
        text={`The template gives ${countTasks(managerless.length)} to the direct manager. Pick who does each one${newHire.manager ? '' : ', or add a manager in Employees first'}.`}
      />,
    );
  }
  // BR-R01: an approval never goes to whoever uploads the document it reviews.
  const own = plan.filter(({ problem }) => problem === 'SAME_AS_UPLOADER');
  if (own.length) {
    notices.push(
      <Notice
        key="own"
        variant="warning"
        title="An approval would review its owner's own upload"
        text="Pick someone else to approve it."
      />,
    );
  }
  const overdue = plan.filter((task) => task.overdue).length;
  if (overdue) {
    notices.push(
      <Notice
        key="overdue"
        variant="warning"
        title={
          startDate < today
            ? 'The start date has passed'
            : 'Some tasks are already past due'
        }
        text={`${capitalized(countTasks(overdue))} ${overdue === 1 ? 'is' : 'are'} already past due and start out overdue. To avoid that, go back and pick a later date.`}
      />,
    );
  }
  return notices;
}

function Row({
  task,
  pick,
  refused,
  newHire,
  staff,
  waitsFor,
  today,
  onPick,
}: {
  task: PlannedTask;
  pick: string | undefined;
  refused: AssigneeProblem | undefined;
  newHire: OnboardingDetail['employee'];
  staff: Employee[];
  waitsFor: string;
  today: IsoDate;
  onPick: (task: PlannedTask, employeeId: string | undefined) => void;
}) {
  const type = TYPES[task.type];
  return (
    <Tr
      className={cn(
        task.problem && 'bg-warning/4',
        refused && 'bg-destructive/4',
      )}
    >
      <Td>
        <div className="flex flex-col items-start gap-1.5">
          <span className="font-medium">{task.title}</span>
          <AnimatedBadge
            size="sm"
            status="neutral"
            icon={<type.icon className="size-3" />}
          >
            {type.label}
          </AnimatedBadge>
        </div>
      </Td>
      <Td>
        <Owner
          task={task}
          pick={pick}
          refused={refused}
          newHire={newHire}
          staff={staff}
          onPick={onPick}
        />
      </Td>
      <Td className="whitespace-nowrap">
        {task.availableOn <= today ? (
          <AnimatedBadge
            size="sm"
            status="info"
            className="text-primary-strong"
            icon={<ArrowRight className="size-3" />}
          >
            Now
          </AnimatedBadge>
        ) : (
          <span className="font-mono text-[13px]">
            {formatDate(task.availableOn)}
          </span>
        )}
      </Td>
      <Td className="whitespace-nowrap">
        <div className="flex flex-col items-start gap-1.5">
          <span
            className={cn(
              'font-mono text-[13px]',
              task.overdue && 'text-danger-strong',
            )}
          >
            {formatDate(task.dueOn)}
          </span>
          {task.overdue && (
            <AnimatedBadge
              size="sm"
              status="danger"
              className="text-danger-strong"
              icon={<Clock className="size-3" />}
            >
              Overdue
            </AnimatedBadge>
          )}
        </div>
      </Td>
      <Td className="text-muted-foreground">{waitsFor || '—'}</Td>
    </Tr>
  );
}

// The owner and how they were found. Rows the rule couldn't settle are a select from the
// start (the canvas's IT rows); the others offer Change, and Undo once changed.
function Owner({
  task,
  pick,
  refused,
  newHire,
  staff,
  onPick,
}: {
  task: PlannedTask;
  pick: string | undefined;
  refused: AssigneeProblem | undefined;
  newHire: OnboardingDetail['employee'];
  staff: Employee[];
  onPick: (task: PlannedTask, employeeId: string | undefined) => void;
}) {
  const rule = task.assignee;
  if (rule.kind === 'NEW_HIRE') {
    return (
      <Person
        id={newHire.id}
        name={newHire.fullName}
        role={staff.find(({ id }) => id === newHire.id)?.user?.role}
        note="New hire"
      />
    );
  }
  const role = rule.kind === 'ROLE' ? rule.role : undefined;
  const owner = staff.find(({ id }) => id === (pick ?? task.assigneeId));
  // The rule's people first, then everyone else who can take a task.
  const options = [
    ...task.candidates.flatMap((id) => staff.filter((e) => e.id === id)),
    ...staff.filter(
      (e) => e.id !== newHire.id && !task.candidates.includes(e.id),
    ),
  ].map((employee) => (
    <SelectItem key={employee.id} value={employee.id}>
      <span className="flex min-w-0 items-center gap-2">
        <Avatar
          name={employee.fullName}
          className={cn(
            'size-5.5 text-[10px]',
            tintOf(employee.id, employee.user?.role),
          )}
        />
        <span className="min-w-0 truncate text-foreground">
          {employee.fullName}
        </span>
        <span className="shrink-0 text-xs whitespace-nowrap">
          {employee.user?.role === 'MEMBER'
            ? employee.jobTitle
            : employee.user?.role}
        </span>
      </span>
    </SelectItem>
  ));
  const panel = (
    <SelectContent className="right-auto w-80">{options}</SelectContent>
  );

  if (task.problem || refused) {
    const why = unsettled(task.problem ?? refused!, task, newHire, role);
    return (
      <div className="flex max-w-50 flex-col gap-1">
        <Select value={pick ?? ''} onValueChange={(id) => onPick(task, id)}>
          <SelectTrigger
            className={cn(
              'border-foreground/12 py-1.5 pr-2.5 pl-1.5',
              refused && 'border-destructive ring-2 ring-destructive/25',
            )}
          >
            {owner ? (
              <span className="flex items-center gap-2 whitespace-nowrap">
                <Avatar
                  name={owner.fullName}
                  className={cn(
                    'size-5.5 text-[10px]',
                    tintOf(owner.id, owner.user?.role),
                  )}
                />
                {owner.fullName}
              </span>
            ) : (
              <span className="pl-1.5 whitespace-nowrap text-muted-foreground">
                Pick someone
              </span>
            )}
          </SelectTrigger>
          {panel}
        </Select>
        <span
          className={cn(
            'text-xs leading-4',
            refused
              ? 'text-danger-strong'
              : owner
                ? 'text-muted-foreground'
                : 'text-warning-strong',
          )}
        >
          {refused
            ? refusal(refused, task, newHire, role)
            : owner
              ? pickedNote(task.problem!, why, role)
              : why}
        </span>
      </div>
    );
  }

  return (
    <Person
      id={owner!.id}
      name={owner!.fullName}
      role={owner!.user?.role}
      note={
        pick ? (
          <>
            Changed from{' '}
            {staff.find(({ id }) => id === task.assigneeId)?.fullName} ·
            <button
              type="button"
              onClick={() => onPick(task, undefined)}
              className={LINK}
            >
              Undo
            </button>
          </>
        ) : (
          <>
            {rule.kind === 'DIRECT_MANAGER'
              ? 'Direct manager'
              : `Only person with ${role}`}{' '}
            ·
            <Select
              value={task.assigneeId ?? ''}
              onValueChange={(id) => onPick(task, id)}
              className="inline-block"
            >
              <SelectTrigger className={CHANGE}>Change</SelectTrigger>
              {panel}
            </Select>
          </>
        )
      }
    />
  );
}

const LINK =
  'rounded-sm font-medium text-primary-strong outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary';
// The select's trigger as a link; its chevron is the last child.
const CHANGE = cn(
  LINK,
  'w-auto border-0 bg-transparent p-0 text-xs [&>span:last-child]:hidden',
);

function Person({
  id,
  name,
  role,
  note,
}: {
  id: string;
  name: string;
  role: Role | undefined;
  note: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar
        name={name}
        className={cn('size-7 text-[11px]', tintOf(id, role))}
      />
      <div className="flex min-w-0 flex-col">
        <span>{name}</span>
        <div className="flex flex-wrap items-center gap-x-1 text-xs leading-4 text-muted-foreground">
          {note}
        </div>
      </div>
    </div>
  );
}

// Why the rule left a task without an owner, as a row says it before activate.
function unsettled(
  problem: AssigneeProblem,
  task: PlannedTask,
  newHire: OnboardingDetail['employee'],
  role: string | undefined,
) {
  switch (problem) {
    case 'PICK_NEEDED':
      return `${task.candidates.length} people have ${role}`;
    case 'NO_CANDIDATE':
      return role
        ? `Nobody else has ${role}`
        : newHire.manager
          ? 'Manager has no active account'
          : 'No manager on file';
    case 'SAME_AS_UPLOADER':
      return 'Also uploads the document this reviews';
    case 'PICK_INVALID':
      return "This person can't take the task";
  }
}

// Once HR picks for such a row: the canvas's "IT · you picked".
function pickedNote(
  problem: AssigneeProblem,
  why: string,
  role: string | undefined,
) {
  return problem === 'PICK_NEEDED'
    ? `${role} · you picked`
    : problem === 'NO_CANDIDATE'
      ? `${why} · you picked`
      : 'You picked';
}

// What activate's 422 says about a row.
function refusal(
  problem: AssigneeProblem,
  task: PlannedTask,
  newHire: OnboardingDetail['employee'],
  role: string | undefined,
) {
  switch (problem) {
    case 'PICK_NEEDED':
      return `${task.candidates.length} people have ${role}. Pick one.`;
    case 'NO_CANDIDATE':
      return `${unsettled(problem, task, newHire, role)}. Pick someone.`;
    case 'PICK_INVALID':
      return "This person can't take the task. Pick someone else.";
    case 'SAME_AS_UPLOADER':
      return 'They upload the document this reviews. Pick someone else.';
  }
}

// "from Oct 12" for a phase before the start date, one day as "Mon, Oct 26", else a range.
function phaseDates(phase: PlannedTask[], startDate: IsoDate) {
  const dates = phase.map(({ availableOn }) => availableOn).toSorted();
  const [first, last] = [dates[0], dates.at(-1)!];
  if (first === last) return formatDate(first);
  if (last < startDate) return `from ${formatMonthDay(first)}`;
  return first.slice(0, 7) === last.slice(0, 7)
    ? `${formatMonthDay(first)} – ${Number(last.slice(8))}`
    : `${formatMonthDay(first)} – ${formatMonthDay(last)}`;
}

// The canvas's "Two tasks open today": open now, waiting for nothing (BR-E01).
function opensToday(plan: PlannedTask[], today: IsoDate) {
  const n = plan.filter(
    (task) => task.availableOn <= today && task.dependsOn.length === 0,
  ).length;
  return n === 0
    ? 'Every task unlocks on its date'
    : `${capitalized(countTasks(n))} ${n === 1 ? 'opens' : 'open'} today; the rest unlock on their dates`;
}
