import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreateEmployee,
  type Department,
  type DepartmentName,
  type Employee,
  type IsoDate,
  type Role,
  sandboxEmailDomain,
  today,
  type UpdateEmployee,
} from '@joinpath/core';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.js';
import { recordAudit } from '../audit/audit.js';
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

// An employee as HR's records show them, with their sign-in account.
const employeeSelect = {
  ...personSelect,
  user: { select: { role: true, status: true } },
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
      select: employeeSelect,
    });
  }

  async getEmployee(
    { organizationId }: AuthContext,
    id: string,
  ): Promise<Employee> {
    const employee = await this.prisma.employee.findFirst({
      where: { id, organizationId },
      select: employeeSelect,
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  // Writes, then reads back outside the transaction, as onboardings do: Prisma reads an
  // employee's relations in parallel, and pg deprecates parallel queries on the one
  // connection a transaction holds.
  async createEmployee(
    auth: AuthContext,
    body: CreateEmployee,
  ): Promise<Employee> {
    const { id } = await this.prisma.$transaction(async (tx) => {
      await checkRecord(tx, auth, undefined, body);
      const employee = await tx.employee.create({
        data: { organizationId: auth.organizationId, ...body },
        select: { id: true },
      });
      await recordAudit(tx, auth, {
        action: 'employee.created',
        entityType: 'employee',
        entityId: employee.id,
        data: { fullName: body.fullName },
      });
      return employee;
    });
    return this.getEmployee(auth, id);
  }

  async updateEmployee(
    auth: AuthContext,
    id: string,
    patch: UpdateEmployee,
  ): Promise<Employee> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.employee.findFirst({
        where: { id, organizationId: auth.organizationId },
        select: {
          fullName: true,
          email: true,
          jobTitle: true,
          departmentId: true,
          managerId: true,
        },
      });
      if (!current) throw new NotFoundException('Employee not found');
      // Only what differs is checked, written and audited.
      const changes = Object.fromEntries(
        Object.entries(patch).filter(
          ([field, value]) =>
            value !== undefined &&
            value !== current[field as keyof UpdateEmployee],
        ),
      ) as UpdateEmployee;
      if (changes.email !== undefined) {
        // An invitation went to the old address, so it stops working; HR resends (BR-P05).
        // Revoked first: that waits for an acceptance under way, so the count below sees it.
        await tx.invitation.updateMany({
          where: {
            onboarding: { employeeId: id },
            acceptedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
        // Their sign-in: changing it is account management, which HR has no screen for (PLAN §3).
        if (await tx.user.count({ where: { employeeId: id } })) {
          throw new ConflictException(
            `${current.fullName} signs in with this email, so it can't be changed here`,
          );
        }
      }
      if (Object.keys(changes).length === 0) return;
      await checkRecord(tx, auth, { id, fullName: current.fullName }, changes);
      await tx.employee.update({ where: { id }, data: changes });
      await recordAudit(tx, auth, {
        action: 'employee.updated',
        entityType: 'employee',
        entityId: id,
        data: changes,
      });
    });
    return this.getEmployee(auth, id);
  }

  listDepartments({ organizationId }: AuthContext): Promise<Department[]> {
    return this.prisma.department.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  createDepartment(
    auth: AuthContext,
    { name }: DepartmentName,
  ): Promise<Department> {
    return this.prisma.$transaction(async (tx) => {
      await checkDepartmentName(tx, auth, name);
      const department = await tx.department.create({
        data: { organizationId: auth.organizationId, name },
        select: { id: true, name: true },
      });
      await recordAudit(tx, auth, {
        action: 'department.created',
        entityType: 'department',
        entityId: department.id,
        data: { name },
      });
      return department;
    });
  }

  renameDepartment(
    auth: AuthContext,
    id: string,
    { name }: DepartmentName,
  ): Promise<Department> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.department.findFirst({
        where: { id, organizationId: auth.organizationId },
        select: { name: true },
      });
      if (!current) throw new NotFoundException('Department not found');
      if (name !== current.name) {
        await checkDepartmentName(tx, auth, name, id);
        await tx.department.update({ where: { id }, data: { name } });
        await recordAudit(tx, auth, {
          action: 'department.renamed',
          entityType: 'department',
          entityId: id,
          data: { from: current.name, to: name },
        });
      }
      return { id, name };
    });
  }
}

/**
 * What a record must pass before it's written: its department and manager are the org's
 * (BR-P02), its manager doesn't report to it, and its email has the sandbox's domain
 * (BR-D04) and is no one else's. `employee` is the one being edited, if any.
 */
async function checkRecord(
  tx: Prisma.TransactionClient,
  { organizationId }: AuthContext,
  employee: { id: string; fullName: string } | undefined,
  { email, departmentId, managerId }: UpdateEmployee,
) {
  if (
    departmentId &&
    !(await tx.department.count({
      where: { id: departmentId, organizationId },
    }))
  ) {
    throw new NotFoundException('Department not found');
  }
  if (managerId) {
    const manager = await tx.employee.findFirst({
      where: { id: managerId, organizationId },
      select: { fullName: true },
    });
    if (!manager) throw new NotFoundException('Manager not found');
    if (employee?.id === managerId) {
      throw new BadRequestException(
        `${employee.fullName} can't be their own manager`,
      );
    }
    // Up the chain from the new manager: reaching the employee would close a loop. `seen`
    // stops at a loop already in the data, which this check exists to prevent.
    const seen = new Set<string>();
    for (let above: string | null = managerId; employee && above;) {
      if (above === employee.id) {
        throw new BadRequestException(
          `${manager.fullName} reports to ${employee.fullName}, so ${manager.fullName} can't be ${employee.fullName}'s manager`,
        );
      }
      if (seen.has(above)) break;
      seen.add(above);
      const next: { managerId: string | null } =
        await tx.employee.findUniqueOrThrow({
          where: { id: above },
          select: { managerId: true },
        });
      above = next.managerId;
    }
  }
  if (email !== undefined) {
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { slug: true, isSandbox: true },
    });
    const domain = sandboxEmailDomain(org.slug);
    if (org.isSandbox && !email.endsWith(`@${domain}`)) {
      throw new BadRequestException(`Use an @${domain} email`);
    }
    // unique(org, email) backs this up in a race (P2002 → 409).
    const holder = await tx.employee.findFirst({
      where: { organizationId, email },
      select: { fullName: true },
    });
    if (holder) {
      throw new ConflictException(`${holder.fullName} already has this email`);
    }
  }
}

// unique(org, name) tells "IT" from "it"; HR wouldn't.
async function checkDepartmentName(
  tx: Prisma.TransactionClient,
  { organizationId }: AuthContext,
  name: string,
  renaming?: string,
) {
  const taken = await tx.department.findFirst({
    where: {
      organizationId,
      name: { equals: name, mode: 'insensitive' },
      ...(renaming && { NOT: { id: renaming } }),
    },
    select: { name: true },
  });
  if (taken) {
    throw new ConflictException(
      `There's already a department called ${taken.name}`,
    );
  }
}
