import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Clock, Me } from '@joinpath/core';
import { PrismaService } from '../../prisma.js';
import { createSession } from '../auth/auth.service.js';
import { type AuthContext, hashToken, newToken } from '../auth/session.js';
import { tickOrg } from '../notifications/tick.js';
import { orgToday } from '../org/org.service.js';
import { handlersFor, purgeExpiredSandboxes, purgeOrg } from './sandbox.js';
import type { Handlers } from './scenarios.js';
import { seedDemoOrg } from './seed.js';

const HOUR_MS = 60 * 60 * 1000;
// BR-P06: new demos per client IP an hour, and sandboxes alive at once, which bound what
// abuse can cost the database (PLAN §9).
const PER_IP_PER_HOUR = 5;
const MAX_LIVE = 200;

/** 429, with the seconds until a demo may start, which the controller sends as Retry-After. */
export class TooManyDemos extends HttpException {
  readonly retryAfter: number;

  constructor(message: string, waitMs: number) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
    this.retryAfter = Math.max(1, Math.ceil(waitMs / 1000));
  }
}

@Injectable()
export class DemoService {
  private readonly handlers: Handlers;

  constructor(private readonly prisma: PrismaService) {
    // As the seed script builds them: wiring four modules in for this one use buys nothing.
    this.handlers = handlersFor(prisma);
  }

  /**
   * Try demo (BR-D01): a company of the guest's own for 24 hours, with onboardings A, B and C,
   * and its HR signed in. A session the request carried, from an earlier demo, ends.
   */
  async createSandbox(
    ip: string,
    oldToken: string | undefined,
  ): Promise<{ token: string; me: Me }> {
    const now = Date.now();
    // Besides the daily cron, each new demo clears a few expired ones (PLAN §6.5).
    await purgeExpiredSandboxes(this.prisma, 3);

    // Counted in the database, as serverless instances share no memory (PLAN §9); a hash, so no
    // address is kept, and it goes with the org.
    // ponytail: count, then insert, so requests at once can pass a limit by a few; lock if
    // that ever matters.
    const createdIpHash = createHash('sha256').update(ip).digest('hex');
    const recent = await this.prisma.organization.findMany({
      where: { createdIpHash, createdAt: { gt: new Date(now - HOUR_MS) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (recent.length >= PER_IP_PER_HOUR) {
      throw new TooManyDemos(
        `You've started ${PER_IP_PER_HOUR} demos in the last hour. Try again later.`,
        // Once this one is an hour old, fewer than the limit remain.
        recent[PER_IP_PER_HOUR - 1].createdAt.getTime() + HOUR_MS - now,
      );
    }
    const live = await this.prisma.organization.aggregate({
      where: { isSandbox: true, expiresAt: { gt: new Date(now) } },
      _count: true,
      _min: { expiresAt: true },
    });
    if (live._count >= MAX_LIVE) {
      throw new TooManyDemos(
        'Too many demos are running. Try again later.',
        live._min.expiresAt!.getTime() - now,
      );
    }

    const slug = `demo-${randomBytes(5).toString('hex')}`;
    try {
      const { emails } = await seedDemoOrg(this.prisma, {
        slug,
        // Nobody signs in with it: the guest switches people instead (BR-D02).
        password: newToken(),
        expiresAt: new Date(now + 24 * HOUR_MS),
        createdIpHash,
        scenarios: this.handlers,
      });
      const hr = await this.prisma.user.findUniqueOrThrow({
        where: { email: emails.hr },
      });
      const token = await this.prisma.$transaction(async (tx) => {
        if (oldToken) {
          await tx.session.deleteMany({
            where: { tokenHash: hashToken(oldToken) },
          });
        }
        return createSession(tx, hr.id);
      });
      return { token, me: await this.me(hr) };
    } catch (error) {
      // Half a sandbox helps nobody: it goes, files and all.
      const org = await this.prisma.organization.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (org) await purgeOrg(this.prisma, org.id);
      throw error;
    }
  }

  /**
   * The guest plays someone else (BR-D02): anyone in the sandbox with a working account. Their
   * session replaces the caller's; playing oneself changes nothing, so no token comes back.
   */
  async switchUser(
    auth: AuthContext,
    token: string,
    employeeId: string,
  ): Promise<{ token?: string; me: Me }> {
    const { organizationId } = auth;
    const { isSandbox } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { isSandbox: true },
    });
    if (!isSandbox) {
      throw new ForbiddenException('Switching people works in a sandbox only');
    }
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      select: { fullName: true, user: true },
    });
    if (!employee) throw new NotFoundException('Person not found');
    const { fullName, user } = employee;
    // A new hire's comes with their invitation; canceling their onboarding locks it (BR-C03).
    if (!user) throw new ConflictException(`${fullName} has no account yet`);
    if (user.status !== 'ACTIVE') {
      throw new ConflictException(`${fullName}'s account is locked`);
    }
    if (user.id === auth.userId) return { me: await this.me(user) };
    const next = await this.prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { tokenHash: hashToken(token) } });
      return createSession(tx, user.id);
    });
    return { token: next, me: await this.me(user) };
  }

  /**
   * Moves the org's business date on (PLAN §4.6), in a sandbox only (BR-D02). An increment,
   * so calls at once all count. The org's tick runs at once, for the new date (BR-D03).
   */
  async advanceClock(
    { organizationId }: AuthContext,
    days: number,
  ): Promise<Clock> {
    const { count } = await this.prisma.organization.updateMany({
      where: { id: organizationId, isSandbox: true },
      data: { clockOffsetDays: { increment: days } },
    });
    if (count === 0) {
      throw new ForbiddenException('The demo clock works in a sandbox only');
    }
    await tickOrg(this.prisma, organizationId);
    return { today: await orgToday(this.prisma, organizationId) };
  }

  private me(user: {
    id: string;
    employeeId: string;
    organizationId: string;
    role: AuthContext['role'];
  }) {
    return this.handlers.auth.me({
      userId: user.id,
      employeeId: user.employeeId,
      organizationId: user.organizationId,
      role: user.role,
    });
  }
}
