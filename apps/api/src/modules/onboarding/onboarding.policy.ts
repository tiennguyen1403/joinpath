import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthContext } from '../auth/session.js';

/**
 * The onboardings a user may see (PLAN §9), as a filter for every read. HR sees the whole org.
 * Anyone else sees their own and their direct reports', once activated: a draft is HR's to
 * prepare. Outside the filter an onboarding is a 404 (BR-P02).
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
    OR: [{ employeeId }, { employee: { managerId: employeeId } }],
  };
}
