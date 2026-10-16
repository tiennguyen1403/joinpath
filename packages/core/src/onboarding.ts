import { z } from 'zod';
import { addDays, type IsoDate } from './dates.js';
import { documentFileSchema, documentSubmissionSchema } from './documents.js';
import { employeeSchema, personSchema, type Role } from './org.js';
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

export type RescheduleInput = {
  // The version the tasks were copied from, which keeps their offsets.
  definition: TemplateDefinition;
  startDate: IsoDate;
  tasks: {
    id: string;
    definitionKey: string;
    status: TaskStatus;
    dueOn: IsoDate;
    dueOverridden: boolean;
  }[];
};

/**
 * The new dates of the tasks a new start date moves: every task not finished, one in progress
 * included, both dates worked out from the template again (BR-S01). A deadline HR set stays,
 * unless the task would open after it: then it goes back to the template's (BR-S02).
 */
export function planReschedule({
  definition,
  startDate,
  tasks,
}: RescheduleInput) {
  return tasks
    .filter(
      (task) => task.status === 'PENDING' || task.status === 'IN_PROGRESS',
    )
    .map((task) => {
      // Copied from this version on activation, so its key is there (BR-A08).
      const def = definition.tasks.find(
        (each) => each.key === task.definitionKey,
      )!;
      const availableOn = addDays(startDate, def.availableOffsetDays);
      const keeps = task.dueOverridden && task.dueOn >= availableOn;
      return {
        id: task.id,
        availableOn,
        dueOn: keeps ? task.dueOn : addDays(startDate, def.dueOffsetDays),
        dueOverridden: keeps,
        // HR's deadline gave way, which goes on record (BR-S02).
        overrideReset: task.dueOverridden && !keeps,
      };
    });
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
  // When HR canceled it (BR-C03).
  canceledAt: z.iso.datetime().nullable(),
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

// What activating the draft now would create. HR's picks stay in the wizard until activate.
export const activationPreviewSchema = z.object({
  // Its templateVersion is the one to send back to activate.
  onboarding: onboardingSchema,
  today: z.iso.date(),
  tasks: z.array(plannedTaskSchema),
  // A name for every id the plan mentions, the new hire's included.
  people: z.array(personSchema),
  // The new hire has no account yet, so activating emails them an invitation (BR-A07).
  sendsInvitation: z.boolean(),
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

// POST /onboardings/:id/reschedule: a draft takes the date, an active onboarding's open tasks
// are dated again from it (BR-S01, BR-S02).
export const rescheduleOnboardingSchema = z.object({ startDate: z.iso.date() });
export type RescheduleOnboarding = z.infer<typeof rescheduleOnboardingSchema>;

// POST /onboardings/:id/cancel: HR says why (BR-C03).
export const cancelOnboardingSchema = z.object({
  reason: z.string().trim().min(1, 'Say why').max(1000),
});
export type CancelOnboarding = z.infer<typeof cancelOnboardingSchema>;

// POST /tasks/:id/reassign: someone else with an active account (BR-S04).
export const reassignTaskSchema = z.object({ employeeId: z.uuid() });
export type ReassignTask = z.infer<typeof reassignTaskSchema>;

// POST /tasks/:id/due-date: a day no sooner than the task opens, or null to put the template's
// back (BR-S03).
export const changeDueDateSchema = z.object({
  dueOn: z.iso.date().nullable(),
});
export type ChangeDueDate = z.infer<typeof changeDueDateSchema>;

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
  // HR set dueOn by hand (BR-S03), and a new start date keeps it (BR-S02).
  dueOverridden: z.boolean(),
  status: taskStatusSchema,
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  availability: availabilitySchema,
  overdue: z.boolean(),
  // DOCUMENT only: the files not yet submitted, oldest first, of those the viewer may see
  // (BR-P03). Empty for any other task.
  files: z.array(documentFileSchema),
  // DOCUMENT only: its revisions, newest first, each with the decision on it, for those who
  // may see its files (BR-P03). Empty for any other task.
  submissions: z.array(documentSubmissionSchema),
});
export type Task = z.infer<typeof taskSchema>;

// The link a new hire with no account sets their password through (BR-A07, BR-P05).
export const onboardingInvitationSchema = z.object({
  // Where it went: the new hire's email then.
  email: z.email(),
  sentAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  // A resend replaced it, or the new hire's email changed.
  revokedAt: z.iso.datetime().nullable(),
});
export type OnboardingInvitation = z.infer<typeof onboardingInvitationSchema>;

export const onboardingDetailSchema = onboardingSchema.extend({
  // The org's business date (PLAN §4.6), which the tasks' availability comes from.
  today: z.iso.date(),
  // By phase, then template order. None until activation.
  tasks: z.array(taskSchema),
  // The newest invitation, for HR only, who resends it; null for anyone else, and when the
  // new hire already had an account on activation.
  invitation: onboardingInvitationSchema.nullable(),
  // Why HR canceled it (BR-C03), for HR only, as the reason may be private; null for anyone
  // else.
  cancelReason: z.string().nullable(),
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

const taskRefSchema = z.object({ id: z.uuid(), title: z.string() });
const activityBaseSchema = z.object({
  id: z.uuid(),
  // By the business day it happened on (BR-D05).
  at: z.iso.datetime(),
  // Null if the system did it, which nothing on a timeline records yet.
  actor: personSchema.nullable(),
  onboarding: z.object({ id: z.uuid(), employee: personSchema }),
  // The task it is about, if one.
  task: taskRefSchema.nullable(),
});

/**
 * Something that happened to an onboarding, from its audit trail (PLAN §7). Uploading and
 * removing files stays off it: the submission says what counts. Only those who see a
 * document's files hear of its revisions and decisions (BR-P03).
 */
export const activityEventSchema = z.discriminatedUnion('action', [
  activityBaseSchema.extend({
    action: z.enum([
      'onboarding.created',
      'onboarding.canceled',
      'onboarding.completed',
      'task.started',
      'task.completed',
      'invitation.sent',
      'invitation.resent',
      'invitation.accepted',
    ]),
  }),
  activityBaseSchema.extend({
    action: z.literal('onboarding.activated'),
    version: z.int(),
    taskCount: z.int(),
    // HR's picks (§4.7): who took the tasks the template could not settle.
    picks: z.array(z.object({ task: taskRefSchema, assignee: personSchema })),
  }),
  activityBaseSchema.extend({
    action: z.literal('onboarding.rescheduled'),
    from: z.iso.date(),
    to: z.iso.date(),
    // HR's deadlines that went back to the template's (BR-S02).
    dueReset: z.array(
      z.object({ task: taskRefSchema, from: z.iso.date(), to: z.iso.date() }),
    ),
  }),
  activityBaseSchema.extend({
    action: z.literal('task.reassigned'),
    from: personSchema,
    to: personSchema,
  }),
  activityBaseSchema.extend({
    action: z.enum(['task.due_changed', 'task.due_reset']),
    from: z.iso.date(),
    to: z.iso.date(),
  }),
  activityBaseSchema.extend({
    // `task`: the DOCUMENT submitted, or the APPROVAL that decided.
    action: z.enum([
      'document.submitted',
      'document.approved',
      'document.rejected',
    ]),
    revision: z.int(),
  }),
]);
export type ActivityEvent = z.infer<typeof activityEventSchema>;

// GET /dashboard, HR's home (PLAN §10). The web counts and words what needs attention.
export const dashboardSchema = z.object({
  today: z.iso.date(),
  // The running onboardings and the drafts, the soonest start first. A draft names the tasks
  // activating it now would leave without an owner, as its review does (§4.7).
  onboardings: z.array(
    onboardingSchema.extend({
      unassigned: z.array(
        plannedTaskSchema.pick({ title: true, assignee: true }),
      ),
    }),
  ),
  // The open tasks of the running onboardings, by due date.
  tasks: z.array(
    taskSchema
      .pick({
        id: true,
        title: true,
        type: true,
        assignee: true,
        reviewsTaskId: true,
        dependsOn: true,
        availableOn: true,
        dueOn: true,
        status: true,
        availability: true,
        overdue: true,
      })
      .extend({
        onboardingId: z.uuid(),
        // APPROVAL only: when the newest revision of its document came in; null before one,
        // and for any other task.
        submittedAt: z.iso.datetime().nullable(),
      }),
  ),
  // The org's newest events, on any onboarding.
  activity: z.array(activityEventSchema),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
