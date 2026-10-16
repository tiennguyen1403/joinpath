import { timingSafeEqual } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { MockEmail, Notifications } from '@joinpath/core';
import { env } from '../../env.js';
import { PrismaService } from '../../prisma.js';
import type { AuthContext } from '../auth/session.js';
import { purgeExpiredSandboxes } from '../demo/sandbox.js';
import { clockOf, clockSelect, orgClock } from '../org/org.service.js';
import { tickOrg } from './tick.js';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The signed-in person's newest notifications, and how many they haven't read. */
  async list({
    employeeId,
    organizationId,
  }: AuthContext): Promise<Notifications> {
    const mine = { recipientEmployeeId: employeeId };
    const rows = await this.prisma.notification.findMany({
      where: mine,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // ponytail: the newest 50, no paging; add a cursor when someone needs older ones.
      take: 50,
      select: {
        id: true,
        kind: true,
        taskId: true,
        title: true,
        body: true,
        link: true,
        readAt: true,
        createdAt: true,
      },
    });
    const unread = await this.prisma.notification.count({
      where: { ...mine, readAt: null },
    });
    const { at } = await orgClock(this.prisma, organizationId);
    return {
      unread,
      notifications: rows.map(({ readAt, createdAt, ...row }) => ({
        ...row,
        readAt: readAt && at(readAt),
        createdAt: at(createdAt),
      })),
    };
  }

  /** Someone else's is a 404 (BR-P02); one read already stays as it was. */
  async read(auth: AuthContext, id: string): Promise<Notifications> {
    const mine = { id, recipientEmployeeId: auth.employeeId };
    const { count } = await this.prisma.notification.updateMany({
      where: { ...mine, readAt: null },
      data: { readAt: new Date() },
    });
    if (
      count === 0 &&
      !(await this.prisma.notification.count({ where: mine }))
    ) {
      throw new NotFoundException('Notification not found');
    }
    return this.list(auth);
  }

  async readAll(auth: AuthContext): Promise<Notifications> {
    await this.prisma.notification.updateMany({
      where: { recipientEmployeeId: auth.employeeId, readAt: null },
      data: { readAt: new Date() },
    });
    return this.list(auth);
  }

  /**
   * The cron's call (PLAN §6.5): Vercel Cron sends the secret as a bearer token. Sandboxes
   * past their 24 hours go (BR-D01), then every org ticks on its own business date; sessions
   * past their date go, since nothing reads them.
   */
  async tick(authorization: string | undefined) {
    const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
    const given = Buffer.from(authorization ?? '');
    if (
      !env.CRON_SECRET ||
      given.length !== expected.length ||
      !timingSafeEqual(given, expected)
    ) {
      throw new UnauthorizedException('Only the cron runs the tick');
    }
    await purgeExpiredSandboxes(this.prisma);
    const orgs = await this.prisma.organization.findMany({
      select: { id: true },
    });
    for (const { id } of orgs) await tickOrg(this.prisma, id);
    await this.prisma.session.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
  }

  /**
   * Every email of the org, newest first. HR always reads them; in a sandbox anyone does, as
   * the guest plays every part (PLAN §9).
   */
  async mockInbox({ organizationId, role }: AuthContext): Promise<MockEmail[]> {
    const { isSandbox, ...clock } =
      await this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { isSandbox: true, ...clockSelect },
      });
    if (role !== 'HR' && !isSandbox) {
      throw new ForbiddenException(
        'Outside a sandbox, only HR reads the mock inbox',
      );
    }
    const emails = await this.prisma.mockEmail.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        toEmail: true,
        toName: true,
        subject: true,
        body: true,
        link: true,
        linkLabel: true,
        footer: true,
        createdAt: true,
      },
    });
    const { at } = clockOf(clock);
    return emails.map(({ createdAt, ...email }) => ({
      ...email,
      sentAt: at(createdAt),
    }));
  }
}
