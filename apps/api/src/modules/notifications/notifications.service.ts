import { ForbiddenException, Injectable } from '@nestjs/common';
import type { MockEmail } from '@joinpath/core';
import { PrismaService } from '../../prisma.js';
import type { AuthContext } from '../auth/session.js';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every email of the org, newest first. HR always reads them; in a sandbox anyone does, as
   * the guest plays every part (PLAN §9).
   */
  async mockInbox({ organizationId, role }: AuthContext): Promise<MockEmail[]> {
    const { isSandbox } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { isSandbox: true },
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
    return emails.map(({ createdAt, ...email }) => ({
      ...email,
      sentAt: createdAt.toISOString(),
    }));
  }
}
