import type { Task } from '@joinpath/core';
import { ArrowRight, Check, Link, Lock, Timer } from 'reicon-react';
import { AnimatedBadge } from '@/components/beui/motion/animated-badge';
import { formatMonthDay, inWords } from '@/lib/format';

/**
 * What a task still waits for: "the upload" or "the review" when that is a document or an
 * approval, the title of a checklist, else how many. `tasks` is its onboarding's.
 */
export function waitsFor(task: Task, tasks: Task[]) {
  const open = tasks.filter(
    ({ id, status }) => task.dependsOn.includes(id) && status !== 'COMPLETED',
  );
  if (open.length !== 1) return `${inWords(open.length)} tasks`;
  const [only] = open;
  return only.type === 'DOCUMENT'
    ? 'the upload'
    : only.type === 'APPROVAL'
      ? 'the review'
      : only.title;
}

/**
 * Whether a task can be worked on today (PLAN §4.4). A finished task has a badge only where
 * `done` asks for one.
 */
export function TaskBadge({
  task,
  tasks,
  size = 'sm',
  done = false,
}: {
  task: Task;
  tasks: Task[];
  size?: 'sm' | 'md';
  done?: boolean;
}) {
  const icon = size === 'sm' ? 'size-3' : 'size-3.5';
  switch (task.availability) {
    case 'READY':
      return task.status === 'IN_PROGRESS' ? (
        <AnimatedBadge
          size={size}
          status="info"
          className="text-primary-strong"
          icon={<Timer className={icon} />}
        >
          In progress
        </AnimatedBadge>
      ) : (
        <AnimatedBadge
          size={size}
          status="info"
          className="text-primary-strong"
          icon={<ArrowRight className={icon} />}
        >
          Ready
        </AnimatedBadge>
      );
    case 'LOCKED_BY_DATE':
      return (
        <AnimatedBadge
          size={size}
          status="neutral"
          icon={<Lock className={icon} />}
        >
          Opens {formatMonthDay(task.availableOn)}
        </AnimatedBadge>
      );
    case 'BLOCKED':
      return (
        <AnimatedBadge
          size={size}
          status="warning"
          className="border-warning/30 bg-warning/10 text-warning-strong"
          icon={<Link className={icon} />}
        >
          Waits for {waitsFor(task, tasks)}
        </AnimatedBadge>
      );
    case 'COMPLETED':
      return done ? (
        <AnimatedBadge
          size={size}
          status="success"
          className="border-success/30 bg-success/10 text-success-strong"
          icon={<Check className={icon} />}
        >
          Done
        </AnimatedBadge>
      ) : null;
    default:
      return null;
  }
}
