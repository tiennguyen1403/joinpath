import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Clock } from '@joinpath/core';
import { PrismaService } from '../../prisma.js';
import type { AuthContext } from '../auth/session.js';
import { orgToday } from '../org/org.service.js';

@Injectable()
export class DemoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Moves the org's business date on (PLAN §4.6), in a sandbox only (BR-D02). An increment,
   * so calls at once all count. The tick it should run comes with M3.2 (BR-D03).
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
    return { today: await orgToday(this.prisma, organizationId) };
  }
}
