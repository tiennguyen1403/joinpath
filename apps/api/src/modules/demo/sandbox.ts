import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma.js';
import { AuthService } from '../auth/auth.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { deletePrefix } from '../documents/storage.js';
import { OnboardingService } from '../onboarding/onboarding.service.js';
import { TaskService } from '../onboarding/task.service.js';
import type { Handlers } from './scenarios.js';

const logger = new Logger('Sandbox');

/** The scenarios' handlers, built by hand: the seed script runs without Nest. */
export function handlersFor(prisma: PrismaService): Handlers {
  const onboardings = new OnboardingService(prisma);
  return {
    onboardings,
    tasks: new TaskService(prisma, onboardings),
    documents: new DocumentsService(prisma, onboardings),
    auth: new AuthService(prisma),
  };
}

/** An org and everything in it: its files, then its rows, which all cascade (PLAN §7). */
export async function purgeOrg(prisma: PrismaService, organizationId: string) {
  // Files first: if they fail, the org stays for the next purge to find.
  await deletePrefix(`orgs/${organizationId}/`);
  await prisma.organization.deleteMany({ where: { id: organizationId } });
}

/**
 * Sandboxes past their 24 hours (BR-D01), the longest expired first, `limit` at most. One
 * that fails waits for the next run.
 */
export async function purgeExpiredSandboxes(
  prisma: PrismaService,
  limit?: number,
) {
  const expired = await prisma.organization.findMany({
    where: { isSandbox: true, expiresAt: { lte: new Date() } },
    orderBy: { expiresAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  for (const { id } of expired) {
    await purgeOrg(prisma, id).catch((error: unknown) => {
      logger.warn(`Purge of org ${id} failed: ${String(error)}`);
    });
  }
}
