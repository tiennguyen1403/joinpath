import type {
  TaskDef,
  TemplateDefinition,
  TemplateIssue,
} from '@joinpath/core';
import type { GraphTask } from '@/components/graph-layout';

/** A template's task as its graph lays it out (FR-23). */
export type TemplateGraphTask = GraphTask & { def: TaskDef };

/**
 * The tasks as the graph takes them: each phase by its place in the template, and an approval
 * waiting for the document it reviews too (BR-T08), as its task does once activated. A link to
 * itself or to a task that isn't there (BR-T04) has no arrow.
 */
export function graphTasks({
  phases,
  tasks,
}: TemplateDefinition): TemplateGraphTask[] {
  const order = new Map(phases.map(({ key }, i) => [key, i]));
  const keys = new Set(tasks.map(({ key }) => key));
  return tasks.flatMap((def) => {
    const phase = order.get(def.phase);
    if (phase === undefined) return [];
    const waits = new Set([...def.dependsOn, def.reviews]);
    const dependsOn = [...waits].filter(
      (key): key is string =>
        key !== undefined && key !== def.key && keys.has(key),
    );
    return [{ id: def.key, phase, dependsOn, def }];
  });
}

/**
 * The arrows a draft has to fix, as "from>to": each between two tasks of one loop (BR-T05),
 * an approval's document included, and each wait for a document its approval reviews by any
 * other task (BR-T09). The editor marks the same links under Waits for.
 */
export function linksToFix(
  { tasks }: TemplateDefinition,
  issues: TemplateIssue[],
): Set<string> {
  const fix = new Set<string>();
  for (const { rule, taskKeys } of issues) {
    if (rule !== 'BR-T05') continue;
    for (const task of tasks) {
      if (!taskKeys.includes(task.key)) continue;
      for (const key of [...task.dependsOn, task.reviews]) {
        if (key && key !== task.key && taskKeys.includes(key)) {
          fix.add(`${key}>${task.key}`);
        }
      }
    }
  }
  for (const task of tasks) {
    for (const key of task.dependsOn) {
      const reviewed =
        tasks.find((t) => t.key === key)?.type === 'DOCUMENT' &&
        tasks.some((t) => t.type === 'APPROVAL' && t.reviews === key);
      if (reviewed && key !== task.key && key !== task.reviews) {
        fix.add(`${key}>${task.key}`);
      }
    }
  }
  return fix;
}
