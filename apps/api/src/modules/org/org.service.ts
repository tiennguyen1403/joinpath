import { Injectable } from '@nestjs/common';
import {
  type Department,
  type Employee,
  type IsoDate,
  type Role,
  today,
} from '@joinpath/core';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.js';
import type { AuthContext } from '../auth/session.js';

// An employee without their account, as an onboarding shows its new hire.
export const personSelect = {
  id: true,
  fullName: true,
  email: true,
  jobTitle: true,
  department: { select: { id: true, name: true } },
  manager: { select: { id: true, fullName: true } },
} satisfies Prisma.EmployeeSelect;

/** today(org) (PLAN §4.6): the org's business date, the only "today" a workflow uses. */
export async function orgToday(
  db: Prisma.TransactionClient,
  organizationId: string,
): Promise<IsoDate> {
  const { timezone, clockOffsetDays } = await db.organization.findUniqueOrThrow(
    {
      where: { id: organizationId },
      select: { timezone: true, clockOffsetDays: true },
    },
  );
  return today(timezone, clockOffsetDays, new Date());
}

@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService) {}

  /** `active`: only people with an active account, who alone can take a task (PLAN §4.7). */
  listEmployees(
    { organizationId }: AuthContext,
    { active, role }: { active?: true; role?: Role },
  ): Promise<Employee[]> {
    return this.prisma.employee.findMany({
      where: {
        organizationId,
        ...((active || role) && {
          user: { status: active && 'ACTIVE', role },
        }),
      },
      orderBy: { fullName: 'asc' },
      select: {
        ...personSelect,
        user: { select: { role: true, status: true } },
      },
    });
  }

  listDepartments({ organizationId }: AuthContext): Promise<Department[]> {
    return this.prisma.department.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }
}
