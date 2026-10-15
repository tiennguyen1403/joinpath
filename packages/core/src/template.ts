import { z } from 'zod';

// Template definitions (PLAN §4.2). The schema checks each field on its own; validateTemplate
// checks the rules between fields (BR-T04–T10). A draft may be saved while it breaks those
// rules, but publishing needs zero issues (BR-T03).

// Keys never reach the UI: they only tie tasks to phases and to each other.
const keySchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
// 0 is the start date ("day 1"), -7 a week before it. Calendar days.
const offsetDaysSchema = z.int().min(-365).max(365);

// BR-T11: a template assigns work by rule, never to a named person.
export const assigneeRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NEW_HIRE') }),
  z.object({ kind: z.literal('DIRECT_MANAGER') }),
  z.object({ kind: z.literal('ROLE'), role: z.enum(['HR', 'IT']) }),
]);
export type AssigneeRule = z.infer<typeof assigneeRuleSchema>;

export const taskDefSchema = z.object({
  key: keySchema,
  phase: keySchema,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  type: z.enum(['CHECKLIST', 'DOCUMENT', 'APPROVAL']),
  assignee: assigneeRuleSchema,
  availableOffsetDays: offsetDaysSchema,
  dueOffsetDays: offsetDaysSchema,
  // The task waits for ALL of these (BR-E02).
  dependsOn: z.array(keySchema).max(100),
  // APPROVAL only: the DOCUMENT it reviews, which it also waits for (BR-T08).
  reviews: keySchema.optional(),
});
export type TaskDef = z.infer<typeof taskDefSchema>;

export const templateDefinitionSchema = z.object({
  // Display order.
  phases: z
    .array(z.object({ key: keySchema, name: z.string().trim().min(1).max(60) }))
    .max(20),
  // Order within a phase.
  tasks: z.array(taskDefSchema).max(100),
});
export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;

export type TemplateIssue = {
  rule:
    'BR-T04' | 'BR-T05' | 'BR-T06' | 'BR-T07' | 'BR-T08' | 'BR-T09' | 'BR-T10';
  // The tasks to flag; empty when the problem is the template as a whole.
  taskKeys: string[];
  // Names tasks by title, since the UI never shows keys.
  message: string;
};

const list = new Intl.ListFormat('en');

// Values that appear more than once, each listed once.
const repeated = (values: string[]) => [
  ...new Set(values.filter((value, i) => values.indexOf(value) !== i)),
];

/** Every rule the definition breaks, one issue per problem. No issues: it can be published. */
export function validateTemplate(def: TemplateDefinition): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const flag = (
    rule: TemplateIssue['rule'],
    taskKeys: string[],
    message: string,
  ) => {
    issues.push({ rule, taskKeys, message });
  };
  const tasks = new Map(def.tasks.map((task) => [task.key, task]));
  const phases = new Set(def.phases.map((phase) => phase.key));

  // BR-T04: the parts exist, are unique, and point at each other.
  if (def.phases.length === 0) flag('BR-T04', [], 'Add at least one phase.');
  if (def.tasks.length === 0) flag('BR-T04', [], 'Add at least one task.');
  for (const key of repeated(def.phases.map((phase) => phase.key))) {
    flag(
      'BR-T04',
      [],
      `Several phases use the key ${key}. Give each one its own key.`,
    );
  }
  for (const key of repeated(def.tasks.map((task) => task.key))) {
    flag(
      'BR-T04',
      [key],
      `Several tasks use the key ${key}. Give each one its own key.`,
    );
  }
  for (const title of repeated(
    def.tasks.map((task) => task.title.toLowerCase()),
  )) {
    const same = def.tasks.filter((task) => task.title.toLowerCase() === title);
    flag(
      'BR-T04',
      same.map((task) => task.key),
      `Several tasks are called ${same[0].title}. Give each one its own title.`,
    );
  }
  for (const task of def.tasks) {
    if (!phases.has(task.phase)) {
      flag(
        'BR-T04',
        [task.key],
        `${task.title} is in phase ${task.phase}, which isn't in this template.`,
      );
    }
    for (const ref of task.dependsOn) {
      if (ref === task.key) {
        flag(
          'BR-T04',
          [task.key],
          `${task.title} waits for itself. Remove that link.`,
        );
      } else if (!tasks.has(ref)) {
        flag(
          'BR-T04',
          [task.key],
          `${task.title} waits for ${ref}, which isn't a task in this template.`,
        );
      }
    }
    if (task.reviews === task.key) {
      flag('BR-T04', [task.key], `${task.title} reviews itself.`);
    } else if (task.reviews !== undefined && !tasks.has(task.reviews)) {
      flag(
        'BR-T04',
        [task.key],
        `${task.title} reviews ${task.reviews}, which isn't a task in this template.`,
      );
    }
  }

  // What each task waits for, directly or through other tasks. Links flagged above are left out.
  const prereqs = new Map(
    def.tasks.map((task) => [
      task.key,
      [...task.dependsOn, task.reviews].filter(
        (ref): ref is string =>
          ref !== undefined && ref !== task.key && tasks.has(ref),
      ),
    ]),
  );
  const waitsFor = (key: string, seen = new Set<string>()) => {
    for (const ref of prereqs.get(key) ?? []) {
      if (!seen.has(ref)) {
        seen.add(ref);
        waitsFor(ref, seen);
      }
    }
    return seen;
  };
  const nodes = def.tasks.map((task) => ({
    task,
    upstream: waitsFor(task.key),
  }));

  // BR-T05: no loops. Tasks that wait for each other are one problem.
  const looped = nodes.filter(({ task, upstream }) => upstream.has(task.key));
  const reported = new Set<TaskDef>();
  for (const a of looped) {
    if (reported.has(a.task)) continue;
    const loop = looped
      .filter((b) => a.upstream.has(b.task.key) && b.upstream.has(a.task.key))
      .map(({ task }) => task);
    loop.forEach((task) => reported.add(task));
    const [first, second] = loop.map((task) => task.title);
    flag(
      'BR-T05',
      loop.map((task) => task.key),
      loop.length === 2
        ? `${first} waits for ${second}, which already waits for ${first}. Neither could ever open. Remove one of the two links.`
        : `${list.format(loop.map((task) => task.title))} wait for each other in a loop, so none of them could ever open. Remove one of the links.`,
    );
  }

  // BR-T06
  for (const task of def.tasks) {
    if (task.availableOffsetDays > task.dueOffsetDays) {
      flag('BR-T06', [task.key], `${task.title} is due before it opens.`);
    }
  }

  // BR-T07: nothing a task waits for, directly or not, opens after the task is due.
  for (const { task, upstream } of nodes) {
    const blockers = def.tasks.filter(
      (other) =>
        other.key !== task.key &&
        upstream.has(other.key) &&
        other.availableOffsetDays > task.dueOffsetDays,
    );
    if (blockers.length === 0) continue;
    const last = blockers.reduce((a, b) =>
      b.availableOffsetDays > a.availableOffsetDays ? b : a,
    );
    flag(
      'BR-T07',
      [task.key],
      `${task.title} waits for ${last.title}, which only opens after ${task.title} is due.`,
    );
  }

  // BR-T08: an approval reviews exactly one document; a document has at most one approval.
  for (const task of def.tasks) {
    const target =
      task.reviews === undefined ? undefined : tasks.get(task.reviews);
    if (task.type !== 'APPROVAL') {
      if (task.reviews !== undefined) {
        flag(
          'BR-T08',
          [task.key],
          `${task.title} isn't an approval, so it can't review a document.`,
        );
      }
    } else if (task.reviews === undefined) {
      flag('BR-T08', [task.key], `Pick the document ${task.title} reviews.`);
    } else if (target && target !== task && target.type !== 'DOCUMENT') {
      flag(
        'BR-T08',
        [task.key],
        `${task.title} reviews ${target.title}, which isn't a document.`,
      );
    }
  }
  for (const doc of def.tasks.filter((task) => task.type === 'DOCUMENT')) {
    const approvals = def.tasks.filter(
      (task) => task.type === 'APPROVAL' && task.reviews === doc.key,
    );
    if (approvals.length > 1) {
      flag(
        'BR-T08',
        approvals.map((task) => task.key),
        `${list.format(approvals.map((task) => task.title))} review ${doc.title}, but a document gets one approval.`,
      );
    }
  }

  // BR-T09: a reviewed document has only its approval waiting for it; the rest wait for the
  // approval, since a rejection reopens the document.
  for (const task of def.tasks) {
    for (const ref of task.dependsOn) {
      const doc = tasks.get(ref);
      const approval = def.tasks.find(
        (other) => other.type === 'APPROVAL' && other.reviews === ref,
      );
      if (doc?.type === 'DOCUMENT' && approval && task.reviews !== ref) {
        flag(
          'BR-T09',
          [task.key],
          `${task.title} waits for ${doc.title}, which ${approval.title} reviews. Make it wait for ${approval.title} instead.`,
        );
      }
    }
  }

  // BR-T10
  for (const task of def.tasks) {
    if (task.type === 'APPROVAL' && task.assignee.kind === 'NEW_HIRE') {
      flag(
        'BR-T10',
        [task.key],
        `${task.title} is an approval, so it can't go to the new hire.`,
      );
    }
  }

  return issues;
}
