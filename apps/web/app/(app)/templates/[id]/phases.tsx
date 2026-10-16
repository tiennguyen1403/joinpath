import type { AssigneeRule, TaskDef, TemplateDefinition } from '@joinpath/core';
import type { ReactNode } from 'react';
import { cn } from '@/components/beui/lib/utils';
import { TASK_TYPES } from '@/components/task-status';

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
