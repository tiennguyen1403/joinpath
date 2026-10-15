import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthContext } from '../auth/session.js';

/**
 * The onboardings a user may see (PLAN §9), as a filter for every read. HR sees the whole org.
 * Anyone else sees, once activated, their own, their direct reports', and any where they have
 * a task, for its context: a draft is HR's to prepare. Outside the filter an onboarding is a
 * 404 (BR-P02).
 */
export function visibleOnboardings({
  organizationId,
  employeeId,
  role,
}: AuthContext): Prisma.OnboardingWhereInput {
  if (role === 'HR') return { organizationId };
  return {
    organizationId,
    status: { not: 'DRAFT' },
    OR: [
      { employeeId },
      { employee: { managerId: employeeId } },
      { tasks: { some: { assigneeEmployeeId: employeeId } } },
    ],
  };
}

/**
 * Work on a task is its assignee's, whatever their role, HR's included (PLAN §9). Anyone
 * else who sees the task gets a 403 (BR-E01, BR-P02).
 */
export function canWorkOn(
  { employeeId }: AuthContext,
  task: { assigneeEmployeeId: string },
): boolean {
  return task.assigneeEmployeeId === employeeId;
}
