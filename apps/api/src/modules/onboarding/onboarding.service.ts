import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type ActivateOnboarding,
  type ActivationPreview,
  availability,
  type CancelOnboarding,
  type CreateOnboarding,
  type DocumentMimeType,
  type IsoDate,
  isOverdue,
  type Onboarding,
  type OnboardingDetail,
  type OnboardingStatus,
  type OnboardingSummary,
  planActivation,
  planReschedule,
  type RescheduleOnboarding,
  type Task,
  type TaskStatus,
  type TemplateDefinition,
  type UpdateOnboarding,
} from '@joinpath/core';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.js';
import { recordAudit } from '../audit/audit.js';
import { sendInvitation } from '../auth/invitation.js';
import type { AuthContext } from '../auth/session.js';
import { canSeeFile } from '../documents/documents.policy.js';
import { orgToday, personSelect } from '../org/org.service.js';
import { visibleOnboardings } from './onboarding.policy.js';

// DATE columns travel as midnight UTC; the API speaks 'YYYY-MM-DD' (PLAN §4.6).
export const toIsoDate = (date: Date): IsoDate =>
  date.toISOString().slice(0, 10);
export const fromIsoDate = (date: IsoDate) => new Date(`${date}T00:00:00Z`);

export const onboardingSelect = {
  id: true,
  status: true,
  startDate: true,
  activatedAt: true,
  completedAt: true,
  employee: { select: personSelect },
  template: {
    select: {
      id: true,
      name: true,
      versions: {
        where: { status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true, version: true },
      },
    },
  },
  templateVersion: { select: { id: true, version: true } },
} satisfies Prisma.OnboardingSelect;

const fileSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  uploadedById: true,
  // Never sent: shared by a file and its copies (PLAN §4.5), it tells a carried-over file.
  storageKey: true,
  createdAt: true,
} satisfies Prisma.DocumentFileSelect;
const filesInOrder = [
  { createdAt: 'asc' },
  { id: 'asc' },
] satisfies Prisma.DocumentFileOrderByWithRelationInput[];

export const taskSelect = {
  id: true,
  phaseKey: true,
  phaseName: true,
  phaseOrder: true,
  position: true,
  title: true,
  description: true,
  type: true,
  assignee: { select: { id: true, fullName: true } },
  reviewsTaskId: true,
  dependsOn: {
    orderBy: { dependsOn: { position: 'asc' } },
    select: { dependsOnTaskId: true },
  },
  availableOn: true,
  dueOn: true,
  dueOverridden: true,
  status: true,
  startedAt: true,
  completedAt: true,
  // A document's files not yet submitted, and its revisions, which only some may see
  // (BR-P03): its uploader, the assignee of the approval reviewing it, and HR.
  files: {
    where: { submissionId: null },
    orderBy: filesInOrder,
    select: fileSelect,
  },
  submissions: {
    orderBy: { revision: 'desc' },
    select: {
      id: true,
      revision: true,
      submittedBy: { select: { id: true, fullName: true } },
      submittedAt: true,
      files: { orderBy: filesInOrder, select: fileSelect },
      // One at most (BR-R03).
      decisions: {
        select: {
          decision: true,
          reason: true,
          decidedBy: { select: { id: true, fullName: true } },
          decidedAt: true,
        },
      },
    },
  },
  reviewedBy: { select: { assigneeEmployeeId: true } },
} satisfies Prisma.TaskSelect;

const detailSelect = {
  ...onboardingSelect,
  tasks: {
    orderBy: [{ phaseOrder: 'asc' }, { position: 'asc' }],
    select: taskSelect,
  },
  invitations: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      email: true,
      createdAt: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
    },
  },
} satisfies Prisma.OnboardingSelect;

const summarySelect = {
  ...onboardingSelect,
  tasks: {
    // The next task first: due soonest, then in template order, since many share a date.
    orderBy: [{ dueOn: 'asc' }, { phaseOrder: 'asc' }, { position: 'asc' }],
    select: { id: true, title: true, status: true, dueOn: true },
  },
} satisfies Prisma.OnboardingSelect;

type OnboardingRow = Prisma.OnboardingGetPayload<{
  select: typeof onboardingSelect;
}>;
type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;
type FileRow = TaskRow['files'][number];
type DetailRow = Prisma.OnboardingGetPayload<{ select: typeof detailSelect }>;

export function toOnboarding({
  id,
  status,
  startDate,
  activatedAt,
  completedAt,
  employee,
  template: { versions, ...template },
  templateVersion,
}: OnboardingRow): Onboarding {
  // A draft's template always has a published version: create and update refuse one
  // without, and published versions are never deleted.
  const version = templateVersion ?? versions.at(0);
  if (!version) throw new Error(`Onboarding ${id} has no template version`);
  return {
    id,
    status,
    startDate: toIsoDate(startDate),
    activatedAt: activatedAt?.toISOString() ?? null,
    completedAt: completedAt?.toISOString() ?? null,
    employee,
    template,
    templateVersion: version,
  };
}

// Availability and overdue are worked out on each read, from the org's today (PLAN §4.4).
export function toTask(
  {
    dependsOn,
    availableOn,
    dueOn,
    startedAt,
    completedAt,
    files,
    submissions,
    reviewedBy,
    ...task
  }: TaskRow,
  onboardingStatus: OnboardingStatus,
  prereqStatuses: TaskStatus[],
  today: IsoDate,
  viewer: AuthContext,
): Task {
  const dates = {
    availableOn: toIsoDate(availableOn),
    dueOn: toIsoDate(dueOn),
  };
  const approverId = reviewedBy.at(0)?.assigneeEmployeeId;
  const sees = (uploadedById: string) =>
    canSeeFile(viewer, {
      uploadedById,
      assigneeId: task.assignee.id,
      approverId,
    });
  // `before`: the files of the revision before, from which a rejection carried some over.
  const toFiles = (list: FileRow[], before: FileRow[] = []) => {
    const carried = new Set(before.map((file) => file.storageKey));
    return list
      .filter((file) => sees(file.uploadedById))
      .map((file) => ({
        id: file.id,
        fileName: file.fileName,
        // Only ever written from sniffMimeType (BR-P04).
        mimeType: file.mimeType as DocumentMimeType,
        sizeBytes: file.sizeBytes,
        uploadedAt: file.createdAt.toISOString(),
        carriedOver: carried.has(file.storageKey),
      }));
  };
  return {
    ...task,
    ...dates,
    dependsOn: dependsOn.map((dep) => dep.dependsOnTaskId),
    startedAt: startedAt?.toISOString() ?? null,
    completedAt: completedAt?.toISOString() ?? null,
    availability: availability(
      { status: task.status, ...dates },
      onboardingStatus,
      prereqStatuses,
      today,
    ),
    overdue: isOverdue({ status: task.status, ...dates }, today),
    files: toFiles(files, submissions.at(0)?.files),
    // Newest first, so the one before each is the next one along.
    submissions: submissions.flatMap((submission, i) => {
      if (!sees(submission.submittedBy.id)) return [];
      const decision = submission.decisions.at(0);
      return {
        id: submission.id,
        revision: submission.revision,
        submittedBy: submission.submittedBy,
        submittedAt: submission.submittedAt.toISOString(),
        files: toFiles(submission.files, submissions.at(i + 1)?.files),
        decision: decision
          ? { ...decision, decidedAt: decision.decidedAt.toISOString() }
          : null,
      };
    }),
  };
}

function toDetail(
  { invitations, ...row }: DetailRow,
  today: IsoDate,
  viewer: AuthContext,
): OnboardingDetail {
  const statusById = new Map(row.tasks.map((task) => [task.id, task.status]));
  const invitation = invitations.at(0);
  return {
    ...toOnboarding(row),
    today,
    tasks: row.tasks.map((task) =>
      toTask(
        task,
        row.status,
        task.dependsOn.map((dep) => statusById.get(dep.dependsOnTaskId)!),
        today,
        viewer,
      ),
    ),
    // Only HR resends it, so only HR sees it.
    invitation:
      viewer.role === 'HR' && invitation
        ? {
            email: invitation.email,
            sentAt: invitation.createdAt.toISOString(),
            expiresAt: invitation.expiresAt.toISOString(),
            acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
            revokedAt: invitation.revokedAt?.toISOString() ?? null,
          }
        : null,
  };
}

// Only HR writes (PLAN §9). Each command checks what it refers to, then changes state only
// through compare-and-set (PLAN §6.4).
@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(auth: AuthContext): Promise<OnboardingSummary[]> {
    const onboardings = await this.prisma.onboarding.findMany({
      where: visibleOnboardings(auth),
      // The newest first among those starting the same day, so reloads keep the order.
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      select: summarySelect,
    });
    const today = await orgToday(this.prisma, auth.organizationId);
    return onboardings.map(({ tasks, ...row }) => {
      const next = tasks.find(
        (task) => task.status === 'PENDING' || task.status === 'IN_PROGRESS',
      );
      return {
        ...toOnboarding(row),
        progress: {
          completed: tasks.filter((task) => task.status === 'COMPLETED').length,
          total: tasks.length,
          overdue: tasks.filter((task) =>
            isOverdue(
              { status: task.status, dueOn: toIsoDate(task.dueOn) },
              today,
            ),
          ).length,
        },
        nextTask: next ? { id: next.id, title: next.title } : null,
      };
    });
  }

  async get(auth: AuthContext, id: string): Promise<OnboardingDetail> {
    const onboarding = await this.prisma.onboarding.findFirst({
      where: { id, ...visibleOnboardings(auth) },
      select: detailSelect,
    });
    if (!onboarding) throw new NotFoundException('Onboarding not found');
    return toDetail(
      onboarding,
      await orgToday(this.prisma, auth.organizationId),
      auth,
    );
  }

  /** What activating the draft now would create, before HR's picks (PLAN §4.7). */
  async preview(auth: AuthContext, id: string): Promise<ActivationPreview> {
    const { organizationId } = auth;
    const row = await this.prisma.onboarding.findFirst({
      where: { id, ...visibleOnboardings(auth) },
      select: onboardingSelect,
    });
    if (!row) throw new NotFoundException('Onboarding not found');
    const onboarding = toOnboarding(row);
    if (onboarding.status !== 'DRAFT') {
      throw new ConflictException('Only a draft can be activated');
    }
    await checkTemplate(this.prisma, organizationId, onboarding.template.id);
    // The version shown is the one planned, even if a newer one lands meanwhile: activate
    // then refuses it (BR-A03).
    const plan = await planFor(
      this.prisma,
      organizationId,
      {
        employeeId: onboarding.employee.id,
        templateVersionId: onboarding.templateVersion.id,
        startDate: onboarding.startDate,
      },
      {},
    );
    return { onboarding, ...plan };
  }

  // Commands answer with a read after the commit: inside a transaction, Prisma loads the
  // relations of onboardingSelect concurrently on one connection, which pg deprecates.

  /** A draft: nothing else exists until activation (PLAN §4.3). */
  async create(
    auth: AuthContext,
    input: CreateOnboarding,
  ): Promise<OnboardingDetail> {
    const { organizationId } = auth;
    const { employeeId, templateId, startDate } = input;
    const { id } = await this.prisma.$transaction(async (tx) => {
      await checkEmployee(tx, organizationId, employeeId);
      await checkTemplate(tx, organizationId, templateId);
      const onboarding = await tx.onboarding.create({
        data: {
          organizationId,
          employeeId,
          templateId,
          startDate: fromIsoDate(startDate),
        },
        select: { id: true },
      });
      await recordAudit(tx, auth, {
        action: 'onboarding.created',
        entityType: 'onboarding',
        entityId: onboarding.id,
        onboardingId: onboarding.id,
        data: input,
      });
      return onboarding;
    });
    return this.get(auth, id);
  }

  /** Not audited: like a template draft, a draft is still being prepared. */
  async update(
    auth: AuthContext,
    id: string,
    { employeeId, templateId, startDate }: UpdateOnboarding,
  ): Promise<OnboardingDetail> {
    const { organizationId } = auth;
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.onboarding.count({
        where: { id, organizationId },
      });
      if (!found) throw new NotFoundException('Onboarding not found');
      if (employeeId) await checkEmployee(tx, organizationId, employeeId, id);
      if (templateId) await checkTemplate(tx, organizationId, templateId);
      const { count } = await tx.onboarding.updateMany({
        where: { id, organizationId, status: 'DRAFT' },
        data: {
          employeeId,
          templateId,
          startDate: startDate && fromIsoDate(startDate),
        },
      });
      if (count === 0) throw new ConflictException('Only a draft can change');
    });
    return this.get(auth, id);
  }

  /**
   * DRAFT → ACTIVE with every task and dependency, in one transaction (BR-A05). Any refusal
   * rolls the status back too, so a failed activation creates nothing (BR-A04).
   */
  async activate(
    auth: AuthContext,
    id: string,
    input: ActivateOnboarding,
  ): Promise<OnboardingDetail> {
    const { organizationId } = auth;
    const { templateVersionId, assignees } = input;
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.onboarding.count({
        where: { id, organizationId },
      });
      if (!found) throw new NotFoundException('Onboarding not found');
      // Compare-and-set first: it locks the row, so a second activate waits here and then
      // finds no draft (AT-08), and no PATCH can change what is read below.
      const [draft] = await tx.onboarding.updateManyAndReturn({
        where: { id, organizationId, status: 'DRAFT' },
        data: { status: 'ACTIVE', activatedAt: new Date() },
        select: { employeeId: true, templateId: true, startDate: true },
      });
      if (!draft) throw new ConflictException('Only a draft can be activated');
      const newest = await checkTemplate(tx, organizationId, draft.templateId);
      // BR-A03: HR activates what the preview showed, or nothing.
      if (newest.id !== templateVersionId) {
        throw new ConflictException({
          code: 'TEMPLATE_VERSION_CHANGED',
          message: 'The template has a newer version: preview again',
        });
      }
      const { tasks, sendsInvitation } = await planFor(
        tx,
        organizationId,
        {
          employeeId: draft.employeeId,
          templateVersionId,
          startDate: toIsoDate(draft.startDate),
        },
        assignees,
      );
      const unresolved = tasks.filter((task) => task.problem !== undefined);
      if (unresolved.length > 0) {
        throw new UnprocessableEntityException({
          code: 'ASSIGNEE_UNRESOLVED',
          message: `Fix the owner of ${unresolved.length} task${unresolved.length === 1 ? '' : 's'} to activate`,
          details: unresolved.map(({ key, problem }) => ({
            taskKey: key,
            problem,
          })),
        });
      }

      // An approval points at the document it reviews, and never at another approval
      // (BR-T08), so the tasks that review nothing go in first.
      const idOf = new Map<string, string>();
      for (const batch of [
        tasks.filter((task) => task.reviews === undefined),
        tasks.filter((task) => task.reviews !== undefined),
      ]) {
        const created = await tx.task.createManyAndReturn({
          data: batch.map((task) => ({
            organizationId,
            onboardingId: id,
            definitionKey: task.key,
            phaseKey: task.phaseKey,
            phaseName: task.phaseName,
            phaseOrder: task.phaseOrder,
            position: task.position,
            title: task.title,
            description: task.description,
            type: task.type,
            assigneeEmployeeId: task.assigneeId!,
            reviewsTaskId: task.reviews && idOf.get(task.reviews),
            availableOn: fromIsoDate(task.availableOn),
            dueOn: fromIsoDate(task.dueOn),
          })),
          select: { id: true, definitionKey: true },
        });
        for (const task of created) idOf.set(task.definitionKey, task.id);
      }
      await tx.taskDependency.createMany({
        data: tasks.flatMap((task) =>
          task.dependsOn.map((prereq) => ({
            organizationId,
            taskId: idOf.get(task.key)!,
            dependsOnTaskId: idOf.get(prereq)!,
          })),
        ),
      });
      await tx.onboarding.update({
        where: { id },
        data: { templateVersionId },
      });
      // A new hire whose account a canceled onboarding locked gets back in, with the password
      // they had (BR-C03); nothing else locks one.
      await tx.user.updateMany({
        where: { employeeId: draft.employeeId, status: 'DISABLED' },
        data: { status: 'ACTIVE' },
      });
      // HR's picks go on record with the activation: the version is immutable, so they
      // still say which tasks they were for.
      await recordAudit(tx, auth, {
        action: 'onboarding.activated',
        entityType: 'onboarding',
        entityId: id,
        onboardingId: id,
        data: input,
      });
      // BR-A07: a new hire with no account sets a password through the link.
      if (sendsInvitation) {
        await sendInvitation(tx, auth, id, 'invitation.sent');
      }
    });
    return this.get(auth, id);
  }

  /**
   * A new start date. A draft only takes it; an active onboarding's open tasks are dated again
   * from it, and a deadline HR set may give way (BR-S01, BR-S02).
   */
  async reschedule(
    auth: AuthContext,
    id: string,
    { startDate }: RescheduleOnboarding,
  ): Promise<OnboardingDetail> {
    const { organizationId } = auth;
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.onboarding.count({
        where: { id, organizationId },
      });
      if (!found) throw new NotFoundException('Onboarding not found');
      // Compare-and-set, which locks the row: no activation or task command crosses it, and
      // the tasks below are read under the lock (PLAN §6.4).
      const [onboarding] = await tx.onboarding.updateManyAndReturn({
        where: { id, organizationId, status: { in: ['DRAFT', 'ACTIVE'] } },
        data: { version: { increment: 1 } },
        select: { status: true, startDate: true, templateVersionId: true },
      });
      if (!onboarding) {
        throw new ConflictException('A finished onboarding keeps its dates');
      }
      const from = toIsoDate(onboarding.startDate);
      if (from === startDate) return;
      await tx.onboarding.update({
        where: { id },
        data: { startDate: fromIsoDate(startDate) },
      });
      // A draft has no tasks yet, and is still being prepared: like PATCH, not audited.
      if (onboarding.status === 'DRAFT') return;

      const version = await tx.templateVersion.findUniqueOrThrow({
        where: { id: onboarding.templateVersionId! },
        select: { definition: true },
      });
      const tasks = (
        await tx.task.findMany({
          where: { onboardingId: id },
          select: {
            id: true,
            definitionKey: true,
            status: true,
            dueOn: true,
            dueOverridden: true,
          },
        })
      ).map((task) => ({ ...task, dueOn: toIsoDate(task.dueOn) }));
      const plan = planReschedule({
        definition: version.definition as TemplateDefinition,
        startDate,
        tasks,
      });
      for (const task of plan) {
        await tx.task.update({
          where: { id: task.id },
          data: {
            availableOn: fromIsoDate(task.availableOn),
            dueOn: fromIsoDate(task.dueOn),
            dueOverridden: task.dueOverridden,
          },
        });
      }
      await recordAudit(tx, auth, {
        action: 'onboarding.rescheduled',
        entityType: 'onboarding',
        entityId: id,
        onboardingId: id,
        // The deadlines HR set that gave way go on record with it (BR-S02).
        data: {
          from,
          to: startDate,
          dueReset: plan
            .filter((task) => task.overrideReset)
            .map((task) => ({
              taskId: task.id,
              from: tasks.find((each) => each.id === task.id)!.dueOn,
              to: task.dueOn,
            })),
        },
      });
    });
    return this.get(auth, id);
  }

  /**
   * DRAFT or ACTIVE → CANCELED, with HR's reason (BR-C03). Open tasks are canceled; what was
   * done stays: tasks completed, files, the audit trail. The invitation stops working, and an
   * account the new hire got through an invitation is locked and signed out.
   */
  async cancel(
    auth: AuthContext,
    id: string,
    { reason }: CancelOnboarding,
  ): Promise<OnboardingDetail> {
    const { organizationId } = auth;
    await this.prisma.$transaction(async (tx) => {
      const onboarding = await tx.onboarding.findFirst({
        where: { id, organizationId },
        select: { employeeId: true },
      });
      if (!onboarding) throw new NotFoundException('Onboarding not found');
      const { employeeId } = onboarding;
      const canceledAt = new Date();
      // Compare-and-set, which locks the row: a task command waits, then finds the onboarding
      // no longer active (PLAN §6.4).
      const { count } = await tx.onboarding.updateMany({
        where: { id, organizationId, status: { in: ['DRAFT', 'ACTIVE'] } },
        data: { status: 'CANCELED', canceledAt, cancelReason: reason },
      });
      if (count === 0) {
        throw new ConflictException('This onboarding is already finished');
      }
      await tx.task.updateMany({
        where: { onboardingId: id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        data: { status: 'CANCELED' },
      });
      // Revoked first: that waits for an acceptance under way, so the count below sees it.
      await tx.invitation.updateMany({
        where: { onboardingId: id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: canceledAt },
      });
      // Only an account that came through an invitation: whoever had one before, such as HR
      // or IT onboarded by mistake, keeps it.
      const invited = await tx.invitation.count({
        where: { onboarding: { employeeId }, acceptedAt: { not: null } },
      });
      if (invited > 0) {
        await tx.user.updateMany({
          where: { employeeId },
          data: { status: 'DISABLED' },
        });
        await tx.session.deleteMany({ where: { user: { employeeId } } });
      }
      // The reason stays on the onboarding.
      await recordAudit(tx, auth, {
        action: 'onboarding.canceled',
        entityType: 'onboarding',
        entityId: id,
        onboardingId: id,
      });
    });
    return this.get(auth, id);
  }

  /** A new link for a new hire who hasn't accepted yet; the old one stops working (BR-P05). */
  async resendInvitation(
    auth: AuthContext,
    id: string,
  ): Promise<OnboardingDetail> {
    const { organizationId } = auth;
    await this.prisma.$transaction(async (tx) => {
      const onboarding = await tx.onboarding.findFirst({
        where: { id, organizationId },
        select: { status: true, employeeId: true },
      });
      if (!onboarding) throw new NotFoundException('Onboarding not found');
      if (onboarding.status !== 'ACTIVE') {
        throw new ConflictException(
          'Only an active onboarding has an invitation to resend',
        );
      }
      // So a cancel and a resend never cross (PLAN §6.4).
      await lockOnboarding(tx, organizationId, id);
      // Revoked first: that waits for an acceptance under way, so the count below sees the
      // account it made.
      await tx.invitation.updateMany({
        where: { onboardingId: id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const accounts = await tx.user.count({
        where: { employeeId: onboarding.employeeId },
      });
      if (accounts > 0) {
        throw new ConflictException('The new hire already has an account');
      }
      await sendInvitation(tx, auth, id, 'invitation.resent');
    });
    return this.get(auth, id);
  }
}

/**
 * Every command on an onboarding's tasks bumps its version first (PLAN §6.4). That locks the
 * row, so the commands on one onboarding run one at a time, and only while it is ACTIVE.
 */
export async function lockOnboarding(
  tx: Prisma.TransactionClient,
  organizationId: string,
  id: string,
) {
  const { count } = await tx.onboarding.updateMany({
    where: { id, organizationId, status: 'ACTIVE' },
    data: { version: { increment: 1 } },
  });
  if (count === 0) {
    throw new ConflictException('This onboarding is no longer active');
  }
}

// BR-P02: an employee or template of another org is a 404, as if it did not exist.
async function checkEmployee(
  tx: Prisma.TransactionClient,
  organizationId: string,
  employeeId: string,
  // The onboarding being edited, which may keep its own employee.
  editing?: string,
) {
  const employee = await tx.employee.findFirst({
    where: { id: employeeId, organizationId },
    select: {
      onboardings: {
        where: { status: { in: ['DRAFT', 'ACTIVE'] }, id: { not: editing } },
        select: { id: true },
      },
    },
  });
  if (!employee) throw new NotFoundException('Employee not found');
  // BR-A01. Two requests at once both pass here: the partial unique index lets one write.
  if (employee.onboardings.length > 0) {
    throw new ConflictException('Employee already has an open onboarding');
  }
}

/** Returns the version an activation would copy: the newest published (BR-A03). */
async function checkTemplate(
  db: Prisma.TransactionClient,
  organizationId: string,
  templateId: string,
) {
  const template = await db.template.findFirst({
    where: { id: templateId, organizationId },
    select: {
      archivedAt: true,
      versions: {
        where: { status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!template) throw new NotFoundException('Template not found');
  // BR-T12: no new onboarding, and no activation, on an archived template.
  if (template.archivedAt) throw new ConflictException('Template is archived');
  const [newest] = template.versions;
  if (!newest) {
    throw new ConflictException('Template has no published version');
  }
  return newest;
}

/** Reads planActivation's inputs. Preview and activate plan alike (PLAN §4.7). */
async function planFor(
  db: Prisma.TransactionClient,
  organizationId: string,
  {
    employeeId,
    templateVersionId,
    startDate,
  }: { employeeId: string; templateVersionId: string; startDate: IsoDate },
  assignees: Record<string, string>,
) {
  const version = await db.templateVersion.findFirstOrThrow({
    where: { id: templateVersionId, organizationId },
    select: { definition: true },
  });
  const newHire = await db.employee.findFirstOrThrow({
    where: { id: employeeId, organizationId },
    select: { fullName: true, managerId: true, user: { select: { id: true } } },
  });
  // Only people with an active account take work that isn't the new hire's own.
  const people = await db.employee.findMany({
    where: { organizationId, user: { status: 'ACTIVE' } },
    select: { id: true, fullName: true, user: { select: { role: true } } },
  });
  const today = await orgToday(db, organizationId);
  const tasks = planActivation({
    // Published, so it passed the schema and every rule (BR-T03).
    definition: version.definition as TemplateDefinition,
    startDate,
    today,
    newHireId: employeeId,
    managerId: newHire.managerId,
    people: people.map(({ id, user }) => ({
      employeeId: id,
      role: user!.role,
    })),
    assignees,
  });
  // Without picks every assignee is a candidate, so candidates name everyone.
  const names = new Map(people.map(({ id, fullName }) => [id, fullName]));
  names.set(employeeId, newHire.fullName);
  const named = new Set(tasks.flatMap((task) => task.candidates));
  return {
    today,
    tasks,
    people: [...named].map((id) => ({ id, fullName: names.get(id)! })),
    sendsInvitation: !newHire.user,
  };
}
