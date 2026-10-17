import type {
  AssigneeRule,
  TaskDef,
  TemplateDefinition,
  TemplateIssue,
} from '@joinpath/core';
import {
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useMemo,
} from 'react';
import { XCircle } from 'reicon-react';
import { cn } from '@/components/beui/lib/utils';
import { AnimatedBadge } from '@/components/beui/motion/animated-badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/beui/motion/tabs';
import {
  ArrowLine,
  type ArrowTone,
  DependencyGraph,
  GraphSection,
} from '@/components/dependency-graph';
import { TASK_TYPES } from '@/components/task-status';
import { graphTasks, linksToFix, type TemplateGraphTask } from './graph';

/** Who a template gives a task to (BR-T11), keyed for a select. */
export const ASSIGNEES = {
  NEW_HIRE: 'New hire',
  DIRECT_MANAGER: 'Direct manager',
  HR: 'HR',
  IT: 'IT',
} as const;
export type AssigneeKey = keyof typeof ASSIGNEES;

export const assigneeKey = (rule: AssigneeRule): AssigneeKey =>
  rule.kind === 'ROLE' ? rule.role : rule.kind;

export const assigneeRule = (key: AssigneeKey): AssigneeRule =>
  key === 'HR' || key === 'IT' ? { kind: 'ROLE', role: key } : { kind: key };

/** An offset from the start date as the canvas writes it: "+2", "0", "−14" (a real minus). */
export const signed = (days: number) =>
  days > 0 ? `+${days}` : days < 0 ? `−${-days}` : '0';

/** "day 3", or "4 days before day 1": the canvas counts from day 1, the start date. */
export const dayOf = (offset: number) =>
  offset >= 0
    ? `day ${offset + 1}`
    : `${-offset} ${offset === -1 ? 'day' : 'days'} before day 1`;

/** What the editor and the lists call a task with no title yet. */
export const titleOf = (task: TaskDef) => task.title.trim() || 'Untitled task';

/** The template's phases in order, each with its tasks in order (PLAN §4.2). */
export function Phases({
  definition,
  row,
}: {
  definition: TemplateDefinition;
  row: (task: TaskDef) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      {definition.phases.map((phase) => {
        const tasks = definition.tasks.filter(
          (task) => task.phase === phase.key,
        );
        return (
          <section
            key={phase.key}
            aria-labelledby={`phase-${phase.key}`}
            className="rounded-[20px] bg-card p-2"
          >
            <div className="flex items-center justify-between gap-2 px-2.5 py-2">
              <h2
                id={`phase-${phase.key}`}
                className="text-[15px] leading-[21px] font-semibold"
              >
                {phase.name}
              </h2>
              <span className="text-xs text-muted-foreground">
                {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
              </span>
            </div>
            <ul
              aria-label={`${phase.name} tasks`}
              className="flex flex-col gap-2"
            >
              {tasks.map((task) => (
                <li key={task.key}>{row(task)}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** A task's line: its kind, who does it, and from which day to which (the canvas). */
export function TaskSummary({
  task,
  selected = false,
}: {
  task: TaskDef;
  selected?: boolean;
}) {
  const { label, icon: Icon } = TASK_TYPES[task.type];
  return (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-card">
        <Icon aria-hidden className="size-4.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            selected ? 'font-semibold' : 'font-medium',
            !task.title.trim() && 'text-muted-foreground',
          )}
        >
          {titleOf(task)}
        </span>
        <span className="mt-0.5 text-xs leading-4 text-muted-foreground">
          {label} · {ASSIGNEES[assigneeKey(task.assignee)]} ·{' '}
          <span className="font-mono">
            {signed(task.availableOffsetDays)}d → {signed(task.dueOffsetDays)}d
          </span>
        </span>
      </span>
    </>
  );
}

/** How a version shows: its phases, or what waits for what (M4.3b). */
export type View = 'phases' | 'graph';

/** Phases | Graph, under the version tabs; `id` ties each tab to the panel of `tabPanel`. */
export function ViewTabs({
  id,
  value,
  onChange,
}: {
  id: string;
  value: View;
  onChange: (view: View) => void;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(view) => onChange(view as View)}
      className="max-w-full self-start"
    >
      <TabsList aria-label="Template views">
        {(['phases', 'graph'] as const).map((view) => (
          <TabsTrigger
            key={view}
            value={view}
            id={`${id}-${view}`}
            aria-controls={`${id}-panel`}
            // White on the stronger blue (ADR 009).
            indicatorClassName="bg-primary-strong"
          >
            {view === 'phases' ? 'Phases' : 'Graph'}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** The panel that `ViewTabs` shows, on `view`. */
export const tabPanel = (id: string, view: View) => ({
  role: 'tabpanel',
  id: `${id}-panel`,
  'aria-labelledby': `${id}-${view}`,
});

// Four rows, so taller than an onboarding's card: the title, its type and who does it, its days,
// its problems.
const CARD = { width: 168, height: 132 };

/**
 * What waits for what in a version (FR-23): each phase a band, each task a card, an arrow from
 * each prerequisite. A draft's `issues` give each card its problem count and draw the links to
 * fix in red; a version read only gets neither, as its list doesn't.
 */
export function TemplateGraph({
  definition,
  issues,
  panel,
}: {
  definition: TemplateDefinition;
  issues?: TemplateIssue[];
  panel: HTMLAttributes<HTMLElement>;
}) {
  const tasks = useMemo(() => graphTasks(definition), [definition]);
  const fix = useMemo(
    () => (issues ? linksToFix(definition, issues) : new Set<string>()),
    [definition, issues],
  );
  const card = useCallback(
    ({ def }: TemplateGraphTask) => (
      <GraphCard
        task={def}
        problems={
          issues?.filter(({ taskKeys }) => taskKeys.includes(def.key)).length ??
          0
        }
      />
    ),
    [issues],
  );
  const arrow = useCallback(
    (from: TemplateGraphTask, to: TemplateGraphTask): ArrowTone =>
      fix.has(`${from.id}>${to.id}`) ? 'problem' : 'plain',
    [fix],
  );
  return (
    <GraphSection
      panel={panel}
      list="Phases"
      legend={
        <>
          <li className="flex items-center gap-2">
            <ArrowLine tone="plain" />
            Waits for
          </li>
          {fix.size > 0 && (
            <li className="flex items-center gap-2">
              <ArrowLine tone="problem" />
              Link to fix
            </li>
          )}
        </>
      }
    >
      <DependencyGraph
        tasks={tasks}
        label={(phase) => definition.phases[phase].name}
        card={card}
        arrow={arrow}
        size={CARD}
      />
    </GraphSection>
  );
}

/** A task on the graph: what its row says, in four rows, 10 px in so the longest pair fits. */
function GraphCard({ task, problems }: { task: TaskDef; problems: number }) {
  return (
    <div className="flex size-full flex-col justify-center gap-1 rounded-xl border border-border bg-background px-2.5 py-3 text-[13px] leading-[17px]">
      <span
        className={cn(
          'line-clamp-2 font-semibold',
          !task.title.trim() && 'text-muted-foreground',
        )}
      >
        {titleOf(task)}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {TASK_TYPES[task.type].label} · {ASSIGNEES[assigneeKey(task.assignee)]}
      </span>
      <span className="truncate font-mono text-xs text-muted-foreground">
        {signed(task.availableOffsetDays)}d → {signed(task.dueOffsetDays)}d
      </span>
      {problems > 0 && (
        <span className="mt-1 flex">
          <AnimatedBadge
            size="sm"
            status="danger"
            icon={<XCircle className="size-3" />}
            className="text-danger-strong"
          >
            {problems} {problems === 1 ? 'problem' : 'problems'}
          </AnimatedBadge>
        </span>
      )}
    </div>
  );
}
