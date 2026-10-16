import type { ActivityEvent } from '@joinpath/core';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthContext } from '../auth/session.js';
import { canSeeFile } from '../documents/documents.policy.js';
import type { OrgClock } from '../org/org.service.js';
import type { AuditAction } from './audit.js';

const person = { select: { id: true, fullName: true } } as const;

const eventSelect = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  data: true,
  createdAt: true,
  actor: { select: { employee: person } },
  onboarding: {
    select: {
      id: true,
      employee: person,
      templateVersion: { select: { version: true } },
      _count: { select: { tasks: true } },
    },
  },
} satisfies Prisma.AuditEventSelect;

// What recordAudit's callers write beside an event: ids and ISO dates.
type EventData = {
  taskId?: string;
  revision?: number;
  from?: string;
  to?: string;
  assignees?: Record<string, string>;
  dueReset?: { taskId: string; from: string; to: string }[];
};

/**
 * The timeline (PLAN §7): the events `where` picks, newest first, naming whoever and whatever
 * they mention, as `viewer` may hear of them.
 */
export async function readActivity(
  db: Prisma.TransactionClient,
  viewer: AuthContext,
  { at }: OrgClock,
  where: Prisma.AuditEventWhereInput,
  take?: number,
): Promise<ActivityEvent[]> {
  const { organizationId } = viewer;
  const rows = await db.auditEvent.findMany({
    where: {
      ...where,
      action: { notIn: ['file.uploaded', 'file.deleted'] },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: eventSelect,
  });
  const dataOf = (row: (typeof rows)[number]) => row.data as EventData;
  const taskIdOf = (row: (typeof rows)[number]) =>
    row.entityType === 'task' ? row.entityId : dataOf(row).taskId;

  // The tasks the events name, and every task of an onboarding activated, whose keys HR's
  // picks go by.
  const tasks = await db.task.findMany({
    where: {
      organizationId,
      OR: [
        {
          id: {
            in: rows.flatMap((row) => {
              const taskId = taskIdOf(row);
              return [
                ...(taskId ? [taskId] : []),
                ...(dataOf(row).dueReset ?? []).map((reset) => reset.taskId),
              ];
            }),
          },
        },
        {
          onboardingId: {
            in: rows
              .filter((row) => row.action === 'onboarding.activated')
              .map((row) => row.onboarding!.id),
          },
        },
      ],
    },
    orderBy: [{ phaseOrder: 'asc' }, { position: 'asc' }],
    select: {
      id: true,
      title: true,
      onboardingId: true,
      definitionKey: true,
      type: true,
      assigneeEmployeeId: true,
      reviews: { select: { assigneeEmployeeId: true } },
      reviewedBy: { select: { assigneeEmployeeId: true } },
    },
  });
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const ref = (id: string) => ({ id, title: taskById.get(id)!.title });
  const people = new Map(
    (
      await db.employee.findMany({
        where: {
          organizationId,
          id: {
            in: rows.flatMap((row) => {
              const { from, to, assignees } = dataOf(row);
              return row.action === 'task.reassigned'
                ? [from!, to!]
                : Object.values(assignees ?? {});
            }),
          },
        },
        select: { id: true, fullName: true },
      })
    ).map((employee) => [employee.id, employee]),
  );

  return rows.flatMap((row): ActivityEvent[] => {
    const { id, createdAt, actor } = row;
    const onboarding = row.onboarding!;
    const data = dataOf(row);
    const taskId = taskIdOf(row);
    const base = {
      id,
      at: at(createdAt),
      actor: actor?.employee ?? null,
      onboarding: { id: onboarding.id, employee: onboarding.employee },
      task: taskId ? ref(taskId) : null,
    };
    const action = row.action as AuditAction;
    switch (action) {
      case 'onboarding.created':
      case 'onboarding.canceled':
      case 'onboarding.completed':
      case 'task.started':
      case 'task.completed':
      case 'invitation.sent':
      case 'invitation.resent':
      case 'invitation.accepted':
        return [{ ...base, action }];
      case 'onboarding.activated':
        return [
          {
            ...base,
            action,
            version: onboarding.templateVersion!.version,
            taskCount: onboarding._count.tasks,
            // In template order. A key the template lacks was ignored (PLAN §8).
            picks: tasks
              .filter(
                (task) =>
                  task.onboardingId === onboarding.id &&
                  Object.hasOwn(data.assignees ?? {}, task.definitionKey),
              )
              .map((task) => ({
                task: { id: task.id, title: task.title },
                assignee: people.get(data.assignees![task.definitionKey])!,
              })),
          },
        ];
      case 'onboarding.rescheduled':
        return [
          {
            ...base,
            action,
            from: data.from!,
            to: data.to!,
            dueReset: (data.dueReset ?? []).map((reset) => ({
              task: ref(reset.taskId),
              from: reset.from,
              to: reset.to,
            })),
          },
        ];
      case 'task.reassigned':
        return [
          {
            ...base,
            action,
            from: people.get(data.from!)!,
            to: people.get(data.to!)!,
          },
        ];
      case 'task.due_changed':
      case 'task.due_reset':
        return [{ ...base, action, from: data.from!, to: data.to! }];
      case 'document.submitted':
      case 'document.approved':
      case 'document.rejected': {
        // Revisions and decisions go with the files (BR-P03), which whoever submitted or
        // decided this one sees, as an uploader sees their file.
        const task = taskById.get(taskId!)!;
        const [assigneeId, approverId] =
          task.type === 'DOCUMENT'
            ? [
                task.assigneeEmployeeId,
                task.reviewedBy.at(0)?.assigneeEmployeeId,
              ]
            : [task.reviews!.assigneeEmployeeId, task.assigneeEmployeeId];
        const seen = canSeeFile(viewer, {
          uploadedById: actor?.employee.id ?? '',
          assigneeId,
          approverId,
        });
        return seen ? [{ ...base, action, revision: data.revision! }] : [];
      }
      // Off the timeline: files (left out above), and what no onboarding owns.
      default:
        return [];
    }
  });
}
