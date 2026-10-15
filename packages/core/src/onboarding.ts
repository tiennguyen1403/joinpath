import { z } from 'zod';
import { addDays, type IsoDate } from './dates.js';
import { employeeSchema, type Role } from './org.js';
import {
  assigneeRuleSchema,
  taskDefSchema,
  type TemplateDefinition,
} from './template.js';

export const taskStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELED',
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export const onboardingStatusSchema = z.enum([
  'DRAFT',
  'ACTIVE',
  'COMPLETED',
  'CANCELED',
]);
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;
// Worked out when read, never stored (PLAN §4.4).
export const availabilitySchema = z.enum([
  'COMPLETED',
  'CANCELED',
  'INACTIVE',
  'LOCKED_BY_DATE',
  'BLOCKED',
  'READY',
]);
export type Availability = z.infer<typeof availabilitySchema>;

/** Whether a task can be worked on today. The checks run in this order (PLAN §4.4). */
export function availability(
  task: { status: TaskStatus; availableOn: IsoDate },
  onboardingStatus: OnboardingStatus,
  prereqStatuses: TaskStatus[],
  today: IsoDate,
): Availability {
  if (task.status === 'COMPLETED' || task.status === 'CANCELED') {
    return task.status;
  }
  if (onboardingStatus !== 'ACTIVE') return 'INACTIVE';
  // Only a task nobody has started waits for its date, so a later start date never locks
  // work under way (BR-S01).
  if (task.status === 'PENDING' && today < task.availableOn) {
    return 'LOCKED_BY_DATE';
  }
  if (prereqStatuses.some((status) => status !== 'COMPLETED')) return 'BLOCKED';
  return 'READY';
}

/**
 * Not finished and past the end of its due date (BR-E06). It can go with BLOCKED, never with
 * LOCKED_BY_DATE, since a task opens on or before its due date.
 */
export function isOverdue(
  task: { status: TaskStatus; dueOn: IsoDate },
  today: IsoDate,
): boolean {
  return (
    task.status !== 'COMPLETED' &&
    task.status !== 'CANCELED' &&
    today > task.dueOn
  );
}

// Why a task has no assignee, or can't keep the one it has. Activation needs none (BR-A04).
export const assigneeProblemSchema = z.enum([
  // The rule finds nobody and HR picked nobody: no manager, a manager with no active account,
  // or nobody else with the role.
  'NO_CANDIDATE',
  // Several people have the role and HR hasn't picked one.
  'PICK_NEEDED',
  // HR picked someone who can't take the task: no active account, the new hire, or anyone
  // at all for a task of the new hire's own.
  'PICK_INVALID',
  // The approval would go to whoever uploads the document it reviews (BR-R01).
  'SAME_AS_UPLOADER',
]);
export type AssigneeProblem = z.infer<typeof assigneeProblemSchema>;

export type ActivationInput = {
  // A published version, so validateTemplate found nothing.
  definition: TemplateDefinition;
  startDate: IsoDate;
  today: IsoDate;
  newHireId: string;
  managerId: string | null;
  // Employees with an ACTIVE user. Only they can take a task that isn't the new hire's own.
  people: { employeeId: string; role: Role }[];
  // HR's picks by task key, as sent to activate. A pick may override the rule (§4.7).
  assignees: Record<string, string>;
};

// One row of `tasks` to create, keyed by template keys until the rows get ids.
export const plannedTaskSchema = z.object({
  key: z.string(),
  phaseKey: z.string(),
  phaseName: z.string(),
  phaseOrder: z.int(),
  position: z.int(),
  title: z.string(),
  description: z.string().optional(),
  type: taskDefSchema.shape.type,
  // The template's rule, and who it finds. With these the UI tells how the owner was found.
  assignee: assigneeRuleSchema,
  candidates: z.array(z.uuid()),
  assigneeId: z.uuid().nullable(),
  problem: assigneeProblemSchema.optional(),
  reviews: z.string().optional(),
  // Everything the task waits for: dependsOn plus the reviewed document, each once.
  dependsOn: z.array(z.string()),
  availableOn: z.iso.date(),
  dueOn: z.iso.date(),
  // Already past due on activation. Allowed, but the preview warns (BR-A06).
  overdue: z.boolean(),
});
export type PlannedTask = z.infer<typeof plannedTaskSchema>;

/** The tasks an activation creates: shown by the preview, inserted by activate (PLAN §4.7). */
export function planActivation(input: ActivationInput): PlannedTask[] {
  const { definition, startDate, today, newHireId, managerId, people } = input;
  // Who can take a task that isn't the new hire's own: anyone else with an active account.
  const others = new Set(
    people.map((person) => person.employeeId).filter((id) => id !== newHireId),
  );
  const planned = definition.tasks.map((task, position): PlannedTask => {
    const rule = task.assignee;
    const candidates =
      rule.kind === 'NEW_HIRE'
        ? [newHireId]
        : rule.kind === 'DIRECT_MANAGER'
          ? managerId !== null && others.has(managerId)
            ? [managerId]
            : []
          : people
              .filter(
                (person) =>
                  person.role === rule.role && others.has(person.employeeId),
              )
              .map((person) => person.employeeId);
    // hasOwn: a task key such as "constructor" must not read Object.prototype.
    const pick = Object.hasOwn(input.assignees, task.key)
      ? input.assignees[task.key]
      : undefined;
    // HR may hand any task but the new hire's own to someone else (§4.7).
    const allowed = (id: string) =>
      rule.kind === 'NEW_HIRE' ? id === newHireId : others.has(id);
    const choice =
      pick ?? (candidates.length === 1 ? candidates[0] : undefined);
    const assigneeId = choice !== undefined && allowed(choice) ? choice : null;
    const phaseOrder = definition.phases.findIndex(
      (phase) => phase.key === task.phase,
    );
    const dueOn = addDays(startDate, task.dueOffsetDays);
    return {
      key: task.key,
      phaseKey: task.phase,
      phaseName: definition.phases[phaseOrder].name,
      phaseOrder,
      position,
      title: task.title,
      description: task.description,
      type: task.type,
      assignee: rule,
      candidates,
      assigneeId,
      problem:
        assigneeId !== null
          ? undefined
          : pick !== undefined
            ? 'PICK_INVALID'
            : candidates.length === 0
              ? 'NO_CANDIDATE'
              : 'PICK_NEEDED',
      reviews: task.reviews,
      dependsOn: [
        ...new Set(
          task.reviews === undefined
            ? task.dependsOn
            : [...task.dependsOn, task.reviews],
        ),
      ],
      availableOn: addDays(startDate, task.availableOffsetDays),
      dueOn,
      overdue: isOverdue({ status: 'PENDING', dueOn }, today),
    };
  });

  // BR-R01: an approval never goes to whoever uploads the document it reviews.
  for (const approval of planned) {
    const doc = planned.find((task) => task.key === approval.reviews);
    if (
      approval.assigneeId !== null &&
      approval.assigneeId === doc?.assigneeId
    ) {
      approval.problem = 'SAME_AS_UPLOADER';
    }
  }
  return planned;
}

// Onboarding API (PLAN §8). Only HR creates or edits one, and only while it is a draft.
export const createOnboardingSchema = z.object({
  employeeId: z.uuid(),
  templateId: z.uuid(),
  startDate: z.iso.date(),
});
export type CreateOnboarding = z.infer<typeof createOnboardingSchema>;

export const updateOnboardingSchema = createOnboardingSchema
  .partial()
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    'Nothing to change',
  );
export type UpdateOnboarding = z.infer<typeof updateOnboardingSchema>;

export const onboardingSchema = z.object({
  id: z.uuid(),
  status: onboardingStatusSchema,
  startDate: z.iso.date(),
  activatedAt: z.iso.datetime().nullable(),
  // When its last task was completed (BR-C01).
  completedAt: z.iso.datetime().nullable(),
  employee: employeeSchema.omit({ user: true }),
  template: z.object({ id: z.uuid(), name: z.string() }),
  // The version the tasks came from. A draft has none yet, so it shows the one activating
  // now would use: the newest published (BR-A03).
  templateVersion: z.object({ id: z.uuid(), version: z.int() }),
});
export type Onboarding = z.infer<typeof onboardingSchema>;

// GET /onboardings: a row of the onboardings table. A draft has no tasks yet.
export const onboardingSummarySchema = onboardingSchema.extend({
  // Overdue by the org's today (BR-E06), as the detail marks each task.
  progress: z.object({
    completed: z.int(),
    total: z.int(),
    overdue: z.int(),
  }),
  // The open task due soonest, then in template order: the table's Next step. Null when no
  // task is open: a draft, or a finished onboarding.
  nextTask: z.object({ id: z.uuid(), title: z.string() }).nullable(),
});
export type OnboardingSummary = z.infer<typeof onboardingSummarySchema>;

const personSchema = z.object({ id: z.uuid(), fullName: z.string() });

// What activating the draft now would create. HR's picks stay in the wizard until activate.
export const activationPreviewSchema = z.object({
  // Its templateVersion is the one to send back to activate.
  onboarding: onboardingSchema,
  today: z.iso.date(),
  tasks: z.array(plannedTaskSchema),
  // A name for every id the plan mentions, the new hire's included.
  people: z.array(personSchema),
});
export type ActivationPreview = z.infer<typeof activationPreviewSchema>;

export const activateOnboardingSchema = z.object({
  // The version the preview showed; a newer one is refused (BR-A03).
  templateVersionId: z.uuid(),
  // HR's picks by task key (§4.7). Keys the template lacks are ignored.
  assignees: z.record(z.string(), z.uuid()).default({}),
});
export type ActivateOnboarding = z.infer<typeof activateOnboardingSchema>;

// `details` of 422 ASSIGNEE_UNRESOLVED: each task activate could not give an owner.
export const unresolvedAssigneesSchema = z.array(
  z.object({ taskKey: z.string(), problem: assigneeProblemSchema }),
);

// A task of an activated onboarding. The status is stored; availability and overdue are
// worked out from the org's today (PLAN §4.4).
export const taskSchema = z.object({
  id: z.uuid(),
  phaseKey: z.string(),
  phaseName: z.string(),
  phaseOrder: z.int(),
  position: z.int(),
  title: z.string(),
  description: z.string().nullable(),
  type: taskDefSchema.shape.type,
  assignee: personSchema,
  // APPROVAL only: the DOCUMENT it reviews.
  reviewsTaskId: z.uuid().nullable(),
  // The tasks it waits for, the reviewed document included.
  dependsOn: z.array(z.uuid()),
  availableOn: z.iso.date(),
  dueOn: z.iso.date(),
  status: taskStatusSchema,
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  availability: availabilitySchema,
  overdue: z.boolean(),
});
export type Task = z.infer<typeof taskSchema>;

export const onboardingDetailSchema = onboardingSchema.extend({
  // The org's business date (PLAN §4.6), which the tasks' availability comes from.
  today: z.iso.date(),
  // By phase, then template order. None until activation.
  tasks: z.array(taskSchema),
});
export type OnboardingDetail = z.infer<typeof onboardingDetailSchema>;

// GET /tasks/mine: a task assigned to the signed-in person, with the onboarding it is part of.
export const myTaskSchema = taskSchema.extend({ onboarding: onboardingSchema });
export type MyTask = z.infer<typeof myTaskSchema>;

export const myTasksSchema = z.object({
  // The org's business date (PLAN §4.6), which the tasks' availability comes from.
  today: z.iso.date(),
  // Every task assigned to them, by due date. Availability sorts them into the tabs of My
  // Tasks: READY to do, LOCKED_BY_DATE or BLOCKED upcoming, COMPLETED done.
  tasks: z.array(myTaskSchema),
});
export type MyTasks = z.infer<typeof myTasksSchema>;
