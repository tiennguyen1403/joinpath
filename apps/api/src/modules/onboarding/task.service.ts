import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  addDays,
  type ApproveSubmission,
  availability,
  type ChangeDueDate,
  type MyTasks,
  type OnboardingDetail,
  type ReassignTask,
  type RejectSubmission,
  type TaskStatus,
  type TemplateDefinition,
} from '@joinpath/core';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.js';
import { recordAudit } from '../audit/audit.js';
import type { AuthContext } from '../auth/session.js';
import { orgToday } from '../org/org.service.js';
import { canWorkOn, visibleOnboardings } from './onboarding.policy.js';
import {
  fromIsoDate,
  lockOnboarding,
  onboardingSelect,
  OnboardingService,
  taskSelect,
  toIsoDate,
  toOnboarding,
  toTask,
} from './onboarding.service.js';

const myTaskSelect = {
  ...taskSelect,
  // Each prerequisite's status, which availability needs, as the onboarding isn't read whole.
  dependsOn: {
    ...taskSelect.dependsOn,
    select: { dependsOnTaskId: true, dependsOn: { select: { status: true } } },
  },
  onboarding: { select: onboardingSelect },
} satisfies Prisma.TaskSelect;

// Only a task's assignee works on it, and only HR hands it on or moves its deadline (PLAN §9).
// The commands answer, as activate does, with the onboarding, which a task done may ripple
// through: the tasks it unlocks, or the onboarding done.
@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardings: OnboardingService,
  ) {}

  /** Every task assigned to the signed-in person, whatever its state. */
  async mine(auth: AuthContext): Promise<MyTasks> {
    const { organizationId, employeeId } = auth;
    const today = await orgToday(this.prisma, organizationId);
    const tasks = await this.prisma.task.findMany({
      where: { organizationId, assigneeEmployeeId: employeeId },
      // What is due first; on one day, each onboarding's tasks together, in template order.
      orderBy: [
        { dueOn: 'asc' },
        { onboardingId: 'asc' },
        { phaseOrder: 'asc' },
        { position: 'asc' },
      ],
      select: myTaskSelect,
    });
    return {
      today,
      tasks: tasks.map(({ onboarding, ...task }) => ({
        ...toTask(
          task,
          onboarding.status,
          task.dependsOn.map((dep) => dep.dependsOn.status),
          today,
          auth,
        ),
        onboarding: toOnboarding(onboarding),
      })),
    };
  }

  /** PENDING → IN_PROGRESS. Optional: a checklist completes from either (BR-E03). */
  async start(auth: AuthContext, id: string): Promise<OnboardingDetail> {
    const onboardingId = await this.prisma.$transaction(async (tx) => {
      const { onboardingId } = await checkTask(tx, auth, id, 'CHECKLIST', [
        'PENDING',
      ]);
      await tx.task.update({
        where: { id },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
      await recordAudit(tx, auth, {
        action: 'task.started',
        entityType: 'task',
        entityId: id,
        onboardingId,
      });
      return onboardingId;
    });
    return this.onboardings.get(auth, onboardingId);
  }

  /** The last task completed completes its onboarding, in the same transaction (BR-C01). */
  async complete(auth: AuthContext, id: string): Promise<OnboardingDetail> {
    const onboardingId = await this.prisma.$transaction(async (tx) => {
      const { onboardingId } = await checkTask(tx, auth, id, 'CHECKLIST', [
        'PENDING',
        'IN_PROGRESS',
      ]);
      const completedAt = new Date();
      await tx.task.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt },
      });
      await recordAudit(tx, auth, {
        action: 'task.completed',
        entityType: 'task',
        entityId: id,
        onboardingId,
      });
      await completeIfLast(tx, auth, onboardingId, completedAt);
      return onboardingId;
    });
    return this.onboardings.get(auth, onboardingId);
  }

  /** BR-R05: the review is done, which may finish the onboarding (BR-C01). */
  async approve(
    auth: AuthContext,
    id: string,
    { submissionId }: ApproveSubmission,
  ): Promise<OnboardingDetail> {
    const onboardingId = await this.prisma.$transaction(async (tx) => {
      const { onboardingId, revision } = await checkDecision(
        tx,
        auth,
        id,
        submissionId,
      );
      const decidedAt = new Date();
      const decision = await tx.approvalDecision.create({
        data: {
          organizationId: auth.organizationId,
          approvalTaskId: id,
          submissionId,
          decision: 'APPROVED',
          decidedById: auth.employeeId,
          decidedAt,
        },
        select: { id: true },
      });
      await tx.task.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: decidedAt },
      });
      await recordAudit(tx, auth, {
        action: 'document.approved',
        entityType: 'approval_decision',
        entityId: decision.id,
        onboardingId,
        data: { taskId: id, revision },
      });
      await completeIfLast(tx, auth, onboardingId, decidedAt);
      return onboardingId;
    });
    return this.onboardings.get(auth, onboardingId);
  }

  /**
   * BR-R06: the document goes back to the new hire, and the approval waits for the next
   * revision, which starts from this one's files (PLAN §4.5).
   */
  async reject(
    auth: AuthContext,
    id: string,
    { submissionId, reason }: RejectSubmission,
  ): Promise<OnboardingDetail> {
    const { organizationId } = auth;
    const onboardingId = await this.prisma.$transaction(async (tx) => {
      const { onboardingId, documentId, revision } = await checkDecision(
        tx,
        auth,
        id,
        submissionId,
      );
      const decision = await tx.approvalDecision.create({
        data: {
          organizationId,
          approvalTaskId: id,
          submissionId,
          decision: 'REJECTED',
          reason,
          decidedById: auth.employeeId,
          decidedAt: new Date(),
        },
        select: { id: true },
      });
      await tx.task.update({
        where: { id: documentId },
        data: { status: 'IN_PROGRESS', completedAt: null },
      });
      // New rows over the same objects, upload times and all, so the revision keeps its own
      // (BR-R07). The new hire drops or adds files, then submits again.
      const files = await tx.documentFile.findMany({
        where: { submissionId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          storageKey: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          uploadedById: true,
          createdAt: true,
        },
      });
      await tx.documentFile.createMany({
        data: files.map((file) => ({
          organizationId,
          taskId: documentId,
          ...file,
        })),
      });
      await recordAudit(tx, auth, {
        action: 'document.rejected',
        entityType: 'approval_decision',
        entityId: decision.id,
        onboardingId,
        data: { taskId: id, revision },
      });
      return onboardingId;
    });
    return this.onboardings.get(auth, onboardingId);
  }

  /**
   * HR hands a task not done to someone else with an active account (BR-S04), never an
   * approval to whoever uploads the document it reviews, nor that document to its approver
   * (BR-R01).
   */
  async reassign(
    auth: AuthContext,
    id: string,
    { employeeId }: ReassignTask,
  ): Promise<OnboardingDetail> {
    const { organizationId } = auth;
    const onboardingId = await this.prisma.$transaction(async (tx) => {
      const task = await openTask(
        tx,
        organizationId,
        id,
        'A task done stays with whoever did it',
      );
      const { onboardingId, assigneeEmployeeId: from } = task;
      const { employeeId: newHireId } = await tx.onboarding.findUniqueOrThrow({
        where: { id: onboardingId },
        select: { employeeId: true },
      });
      // Only a task of the new hire's own goes to them (PLAN §4.7), so theirs is one.
      if (from === newHireId) {
        throw new ConflictException("A new hire's own task stays theirs");
      }
      if (employeeId === from) return onboardingId;
      const person = await tx.employee.findFirst({
        where: { id: employeeId, organizationId },
        select: { user: { select: { status: true } } },
      });
      if (!person) throw new NotFoundException('Employee not found');
      if (employeeId === newHireId) {
        throw new BadRequestException(
          'The new hire only takes their own tasks',
        );
      }
      if (person.user?.status !== 'ACTIVE') {
        throw new BadRequestException('Pick someone with an active account');
      }
      // The approval and the document it reviews: whichever this task is not, if any.
      const pair = await tx.task.findFirst({
        where:
          task.type === 'APPROVAL'
            ? { id: task.reviewsTaskId! }
            : { reviewsTaskId: id },
        select: { assigneeEmployeeId: true },
      });
      if (pair?.assigneeEmployeeId === employeeId) {
        throw new BadRequestException(
          task.type === 'APPROVAL'
            ? 'The approver cannot be whoever uploads the document'
            : 'Whoever uploads the document cannot be its approver',
        );
      }
      await tx.task.update({
        where: { id },
        data: { assigneeEmployeeId: employeeId },
      });
      await recordAudit(tx, auth, {
        action: 'task.reassigned',
        entityType: 'task',
        entityId: id,
        onboardingId,
        data: { from, to: employeeId },
      });
      return onboardingId;
    });
    return this.onboardings.get(auth, onboardingId);
  }

  /**
   * HR moves the deadline of a task not done, no sooner than it opens, or with null puts the
   * template's back (BR-S03). A deadline set so stays when the start date moves (BR-S02).
   */
  async changeDueDate(
    auth: AuthContext,
    id: string,
    { dueOn }: ChangeDueDate,
  ): Promise<OnboardingDetail> {
    const { organizationId } = auth;
    const onboardingId = await this.prisma.$transaction(async (tx) => {
      const task = await openTask(
        tx,
        organizationId,
        id,
        'A task done keeps its deadline',
      );
      const { onboardingId } = task;
      let to = dueOn;
      if (to === null) {
        // Dated from the start date, as on activation, by the version it was copied from.
        const { startDate, templateVersion } =
          await tx.onboarding.findUniqueOrThrow({
            where: { id: onboardingId },
            select: {
              startDate: true,
              templateVersion: { select: { definition: true } },
            },
          });
        const definition = templateVersion!.definition as TemplateDefinition;
        const def = definition.tasks.find(
          (each) => each.key === task.definitionKey,
        )!;
        to = addDays(toIsoDate(startDate), def.dueOffsetDays);
      }
      // The template's never comes sooner (BR-T06).
      const opensOn = toIsoDate(task.availableOn);
      if (to < opensOn) {
        throw new BadRequestException(
          `Pick ${opensOn} or later: the task opens then`,
        );
      }
      const from = toIsoDate(task.dueOn);
      const overridden = dueOn !== null;
      if (to === from && overridden === task.dueOverridden) {
        return onboardingId;
      }
      await tx.task.update({
        where: { id },
        data: { dueOn: fromIsoDate(to), dueOverridden: overridden },
      });
      await recordAudit(tx, auth, {
        action: overridden ? 'task.due_changed' : 'task.due_reset',
        entityType: 'task',
        entityId: id,
        onboardingId,
        data: { from, to },
      });
      return onboardingId;
    });
    return this.onboardings.get(auth, onboardingId);
  }
}

/**
 * The task an HR command changes: in the org, its onboarding locked and active, and the task
 * not done (BR-S03, BR-S04), read under the lock (PLAN §6.4). `done`: the refusal otherwise.
 */
async function openTask(
  tx: Prisma.TransactionClient,
  organizationId: string,
  id: string,
  done: string,
) {
  const found = await tx.task.findFirst({
    where: { id, organizationId },
    select: { onboardingId: true },
  });
  if (!found) throw new NotFoundException('Task not found');
  await lockOnboarding(tx, organizationId, found.onboardingId);
  const task = await tx.task.findUniqueOrThrow({
    where: { id },
    select: {
      onboardingId: true,
      definitionKey: true,
      type: true,
      status: true,
      assigneeEmployeeId: true,
      reviewsTaskId: true,
      availableOn: true,
      dueOn: true,
      dueOverridden: true,
    },
  });
  if (task.status !== 'PENDING' && task.status !== 'IN_PROGRESS') {
    throw new ConflictException(done);
  }
  return task;
}

/** After a task completes: the last one completes its onboarding, in that transaction (BR-C01). */
export async function completeIfLast(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  onboardingId: string,
  completedAt: Date,
) {
  // Counted under the lock: of the last two tasks completed at once, only the second finds
  // none left (AT-23).
  const left = await tx.task.count({
    where: { onboardingId, status: { not: 'COMPLETED' } },
  });
  if (left > 0) return;
  await tx.onboarding.update({
    where: { id: onboardingId },
    data: { status: 'COMPLETED', completedAt },
  });
  await recordAudit(tx, auth, {
    action: 'onboarding.completed',
    entityType: 'onboarding',
    entityId: onboardingId,
    onboardingId,
  });
}

/**
 * A decision is on the newest revision of the document the approval reviews (BR-R02). Until
 * that document is submitted, checkTask refuses: it is the approval's prerequisite.
 */
async function checkDecision(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  id: string,
  submissionId: string,
) {
  const { onboardingId, reviewsTaskId } = await checkTask(
    tx,
    auth,
    id,
    'APPROVAL',
    ['PENDING'],
  );
  // Every approval reviews a document (BR-T08).
  const documentId = reviewsTaskId!;
  const submission = await tx.documentSubmission.findFirst({
    where: { id: submissionId, taskId: documentId },
    select: { revision: true },
  });
  if (!submission) throw new NotFoundException('Submission not found');
  // Revisions count up from 1 and are never deleted (BR-R07).
  const newest = await tx.documentSubmission.count({
    where: { taskId: documentId },
  });
  if (submission.revision !== newest) {
    throw new ConflictException({
      code: 'STALE_SUBMISSION',
      message: `Revision ${newest} replaced this one`,
    });
  }
  return { onboardingId, documentId, revision: submission.revision };
}

// A checklist is started and completed, a document takes files and is submitted, an approval
// is decided (PLAN §4.4): the refusal when a command meets another kind of task.
const WRONG_KIND = {
  CHECKLIST: 'Only a checklist task can be started or completed',
  DOCUMENT: 'Only a document task takes files',
  APPROVAL: 'Only an approval task is approved or rejected',
};

// The refusal when a command meets a task already done.
const DONE = {
  CHECKLIST: 'Task is already completed',
  // No file comes or goes until a rejection reopens it (BR-E04).
  DOCUMENT: 'The document is already submitted',
  APPROVAL: 'The document is already approved',
};

/** Who may work on the task, then whether the command fits its kind: 404, 403, 409 (PLAN §8). */
export async function findTask(
  db: Prisma.TransactionClient,
  auth: AuthContext,
  id: string,
  type: keyof typeof WRONG_KIND,
) {
  const task = await db.task.findFirst({
    where: {
      id,
      organizationId: auth.organizationId,
      onboarding: visibleOnboardings(auth),
    },
    select: {
      onboardingId: true,
      assigneeEmployeeId: true,
      type: true,
      reviewsTaskId: true,
    },
  });
  if (!task) throw new NotFoundException('Task not found');
  if (!canWorkOn(auth, task)) {
    throw new ForbiddenException('This task is assigned to someone else');
  }
  if (task.type !== type) throw new ConflictException(WRONG_KIND[type]);
  return task;
}

/**
 * BR-E01, checked in the order PLAN §8 gives: who may, which kind of task, then whether it
 * can move now. The task's status and prerequisites are read under the lock (PLAN §6.4).
 */
export async function checkTask(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  id: string,
  type: keyof typeof WRONG_KIND,
  // The statuses the command moves a task from.
  from: TaskStatus[],
) {
  const { organizationId } = auth;
  const task = await findTask(tx, auth, id, type);
  await lockOnboarding(tx, organizationId, task.onboardingId);
  const { assigneeEmployeeId, status, availableOn, dependsOn } =
    await tx.task.findUniqueOrThrow({
      where: { id },
      select: {
        assigneeEmployeeId: true,
        status: true,
        availableOn: true,
        dependsOn: { select: { dependsOn: { select: { status: true } } } },
      },
    });
  // Again under the lock: HR may have just handed the task to someone else (BR-S04).
  if (!canWorkOn(auth, { assigneeEmployeeId })) {
    throw new ForbiddenException('This task is assigned to someone else');
  }
  if (!from.includes(status)) {
    throw new ConflictException(
      status === 'IN_PROGRESS' ? 'Task is already started' : DONE[type],
    );
  }
  const opensOn = toIsoDate(availableOn);
  const now = availability(
    { status, availableOn: opensOn },
    // The lock holds only on an ACTIVE onboarding.
    'ACTIVE',
    dependsOn.map((dep) => dep.dependsOn.status),
    await orgToday(tx, organizationId),
  );
  if (now === 'LOCKED_BY_DATE') {
    throw new ConflictException({
      code: 'TASK_NOT_ELIGIBLE',
      message: `This task opens on ${opensOn}`,
    });
  }
  if (now === 'BLOCKED') {
    throw new ConflictException({
      code: 'TASK_NOT_ELIGIBLE',
      message: 'This task waits for other tasks to be done',
    });
  }
  return { ...task, status };
}
