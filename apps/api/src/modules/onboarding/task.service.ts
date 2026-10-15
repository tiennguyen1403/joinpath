import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  availability,
  type MyTasks,
  type OnboardingDetail,
  type TaskStatus,
} from '@joinpath/core';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.js';
import { recordAudit } from '../audit/audit.js';
import type { AuthContext } from '../auth/session.js';
import { orgToday } from '../org/org.service.js';
import { canWorkOn, visibleOnboardings } from './onboarding.policy.js';
import {
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

// Only a task's assignee works on it (PLAN §9). The commands answer, as activate does, with the
// onboarding, which a task done may ripple through: the tasks it unlocks, or the onboarding done.
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
      // Counted under the lock: of the last two tasks completed at once, only the second
      // finds none left (AT-23).
      const left = await tx.task.count({
        where: { onboardingId, status: { not: 'COMPLETED' } },
      });
      if (left === 0) {
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
      return onboardingId;
    });
    return this.onboardings.get(auth, onboardingId);
  }
}

// A checklist is started and completed, a document takes files, an approval is decided
// (PLAN §4.4): the refusal when a command meets another kind of task.
const WRONG_KIND = {
  CHECKLIST: 'Only a checklist task can be started or completed',
  DOCUMENT: 'Only a document task takes files',
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
    select: { onboardingId: true, assigneeEmployeeId: true, type: true },
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
  const { status, availableOn, dependsOn } = await tx.task.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      availableOn: true,
      dependsOn: { select: { dependsOn: { select: { status: true } } } },
    },
  });
  if (!from.includes(status)) {
    throw new ConflictException(
      status === 'IN_PROGRESS'
        ? 'Task is already started'
        : 'Task is already completed',
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
