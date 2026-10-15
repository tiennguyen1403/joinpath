import { z } from 'zod';
import { addDays, type IsoDate } from './dates.js';
import { employeeSchema, type Role } from './org.js';
import type { AssigneeRule, TaskDef, TemplateDefinition } from './template.js';

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';
export const onboardingStatusSchema = z.enum([
  'DRAFT',
  'ACTIVE',
  'COMPLETED',
  'CANCELED',
]);
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;
// Worked out when read, never stored (PLAN §4.4).
export type Availability =
  | 'COMPLETED'
  | 'CANCELED'
  | 'INACTIVE'
  | 'LOCKED_BY_DATE'
  | 'BLOCKED'
  | 'READY';

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
export type AssigneeProblem =
  // The rule finds nobody and HR picked nobody: no manager, a manager with no active account,
  // or nobody else with the role.
  | 'NO_CANDIDATE'
  // Several people have the role and HR hasn't picked one.
  | 'PICK_NEEDED'
  // HR picked someone who can't take the task: no active account, the new hire, or anyone
  // at all for a task of the new hire's own.
  | 'PICK_INVALID'
  // The approval would go to whoever uploads the document it reviews (BR-R01).
  | 'SAME_AS_UPLOADER';

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
export type PlannedTask = {
  key: string;
  phaseKey: string;
  phaseName: string;
  phaseOrder: number;
  position: number;
  title: string;
  description?: string;
  type: TaskDef['type'];
  // The template's rule, and who it finds. With these the UI tells how the owner was found.
  assignee: AssigneeRule;
  candidates: string[];
  assigneeId: string | null;
  problem?: AssigneeProblem;
  reviews?: string;
  // Everything the task waits for: dependsOn plus the reviewed document, each once.
  dependsOn: string[];
  availableOn: IsoDate;
  dueOn: IsoDate;
  // Already past due on activation. Allowed, but the preview warns (BR-A06).
  overdue: boolean;
};

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
  employee: employeeSchema.omit({ user: true }),
  template: z.object({ id: z.uuid(), name: z.string() }),
  // The version the tasks came from. A draft has none yet, so it shows the one activating
  // now would use: the newest published (BR-A03).
  templateVersion: z.object({ id: z.uuid(), version: z.int() }),
});
export type Onboarding = z.infer<typeof onboardingSchema>;
