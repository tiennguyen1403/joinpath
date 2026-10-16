import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  type AcceptInvitation,
  type Invitation,
  type InvitationToken,
  type Login,
  type Me,
  sandboxEmailDomain,
  today,
} from '@joinpath/core';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.js';
import { recordAudit } from '../audit/audit.js';
import { toIsoDate } from '../onboarding/onboarding.service.js';
import { invalidInvitation, usable } from './invitation.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  type AuthContext,
  hashToken,
  newToken,
  SESSION_TTL_MS,
} from './session.js';

/** Returns the new session's token, which only the cookie holds. */
export async function createSession(
  db: Prisma.TransactionClient,
  userId: string,
) {
  const token = newToken();
  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

@Injectable()
export class AuthService {
  // Checked when the email is unknown, so every failed login takes the same time.
  private readonly dummyHash = hashPassword(newToken());

  constructor(private readonly prisma: PrismaService) {}

  /** Returns the new session token. Every failure gets the same generic 401. */
  async login({ email, password }: Login): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const valid = await verifyPassword(
      password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user || !valid || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid email or password');
    }
    return createSession(this.prisma, user.id);
  }

  async logout(token: string | undefined) {
    if (token)
      await this.prisma.session.deleteMany({
        where: { tokenHash: hashToken(token) },
      });
  }

  async me({ userId }: AuthContext): Promise<Me> {
    const {
      organization,
      employee: {
        onboardings: [own],
        ...employee
      },
      ...user
    } = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        employee: {
          select: {
            id: true,
            fullName: true,
            jobTitle: true,
            // One is open at most (BR-A01), and it is the latest activated: the running one,
            // else the last finished.
            onboardings: {
              where: { status: { in: ['ACTIVE', 'COMPLETED'] } },
              orderBy: { activatedAt: 'desc' },
              take: 1,
              select: { id: true },
            },
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
            timezone: true,
            clockOffsetDays: true,
            slug: true,
            isSandbox: true,
          },
        },
      },
    });
    const { clockOffsetDays, slug, isSandbox, ...org } = organization;
    return {
      ...user,
      employee,
      onboardingId: own?.id ?? null,
      organization: {
        ...org,
        today: today(org.timezone, clockOffsetDays, new Date()),
        emailDomain: isSandbox ? sandboxEmailDomain(slug) : null,
      },
    };
  }

  /** What the accept page shows before the password is set. 410 once the link no longer works. */
  async lookupInvitation({ token }: InvitationToken): Promise<Invitation> {
    const invitation = await this.prisma.invitation.findFirst({
      where: { tokenHash: hashToken(token), ...usable(new Date()) },
      select: {
        expiresAt: true,
        organization: {
          select: { name: true, timezone: true, clockOffsetDays: true },
        },
        onboarding: {
          select: {
            startDate: true,
            employee: {
              select: {
                id: true,
                fullName: true,
                email: true,
                manager: { select: { fullName: true } },
              },
            },
            tasks: {
              orderBy: [
                { availableOn: 'asc' },
                { phaseOrder: 'asc' },
                { position: 'asc' },
              ],
              select: {
                title: true,
                description: true,
                availableOn: true,
                dueOn: true,
                assigneeEmployeeId: true,
              },
            },
          },
        },
      },
    });
    if (!invitation) throw invalidInvitation();
    const { timezone, clockOffsetDays, name } = invitation.organization;
    const { startDate, employee, tasks } = invitation.onboarding;
    const { id, manager, ...person } = employee;
    return {
      organization: { name, timezone },
      employee: person,
      manager,
      startDate: toIsoDate(startDate),
      today: today(timezone, clockOffsetDays, new Date()),
      expiresAt: invitation.expiresAt.toISOString(),
      tasks: tasks
        .filter((task) => task.assigneeEmployeeId === id)
        .map(({ title, description, availableOn, dueOn }) => ({
          title,
          description,
          availableOn: toIsoDate(availableOn),
          dueOn: toIsoDate(dueOn),
        })),
    };
  }

  /**
   * Creates the new hire's account with the password they chose, and signs them in (FR-02).
   * Returns the session token.
   */
  async acceptInvitation({
    token,
    password,
  }: AcceptInvitation): Promise<string> {
    // Hashed before the transaction, which then holds its locks only briefly.
    const passwordHash = await hashPassword(password);
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      // Compare-and-set: of two acceptances at once, the second finds the link used (BR-P05).
      const [invitation] = await tx.invitation.updateManyAndReturn({
        where: { tokenHash: hashToken(token), ...usable(now) },
        data: { acceptedAt: now },
        select: { id: true, organizationId: true, onboardingId: true },
      });
      if (!invitation) throw invalidInvitation();
      const { organizationId, onboardingId } = invitation;
      const { employee } = await tx.onboarding.findUniqueOrThrow({
        where: { id: onboardingId },
        select: { employee: { select: { id: true, email: true } } },
      });
      // The email they were invited at: changing it revokes the link (BR-P05). A second
      // account for them breaks unique(employee_id), a 409.
      const user = await tx.user.create({
        data: {
          organizationId,
          employeeId: employee.id,
          email: employee.email,
          role: 'MEMBER',
          passwordHash,
        },
        select: { id: true },
      });
      await recordAudit(
        tx,
        {
          userId: user.id,
          employeeId: employee.id,
          organizationId,
          role: 'MEMBER',
        },
        {
          action: 'invitation.accepted',
          entityType: 'invitation',
          entityId: invitation.id,
          onboardingId,
        },
      );
      return createSession(tx, user.id);
    });
  }
}
